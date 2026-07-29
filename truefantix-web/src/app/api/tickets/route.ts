export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireSellerApproved } from "@/lib/auth/guards";
import { autoVerifyTicketById } from "@/lib/tickets/verification";
import { verifyWithProvider } from "@/lib/tickets/provider";
import { applyRateLimit } from "@/lib/rate-limit";
import { schemas, validateRequest } from "@/lib/validation";
import { getTicketImage } from "@/lib/imageSearch";
import { getEventType } from "@/lib/ticketsView";
import { searchProviderCatalog } from "@/lib/catalog/provider-catalog";
import { fetchOfficialSnapshot } from "@/lib/officialPricing";
import { validateListingPriceAgainstOfficial } from "@/lib/tickets/listingValidation";
import { analyzeReceiptProof } from "@/lib/tickets/receiptOcr";
import { withdrawExpiredAvailableTickets } from "@/lib/tickets/expireListings";

function safeInt(v: unknown, fallback = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function centsToDollars(cents: number) {
  return Number((cents / 100).toFixed(2));
}

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: "VALIDATION_ERROR", message }, { status: 400 });
}

function normalizeCurrency(value: unknown): "CAD" | "USD" {
  return String(value || "CAD").trim().toUpperCase() === "USD" ? "USD" : "CAD";
}

function normalizeListingText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function catalogProviderId(type: string, value: string) {
  const slug = `${type}:${value}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `${type.toLowerCase()}-receipt-event`;
}

function normalizeVenueKey(value: unknown) {
  return normalizeListingText(value);
}

function parseAliases(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);

  const raw = String(value).trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
  } catch {
    // Some legacy rows store aliases as a plain delimited string.
  }

  return raw.split(/[|,;]/).map((item) => item.trim()).filter(Boolean);
}

type VenueLocation = {
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
};

function venueCoordinatesFromMetadata(metadata: unknown) {
  try {
    const parsed = typeof metadata === "string" ? JSON.parse(metadata) : metadata;
    const latitude = Number(parsed?.latitude ?? parsed?.lat);
    const longitude = Number(parsed?.longitude ?? parsed?.lon ?? parsed?.lng);
    return {
      latitude: Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : null,
      longitude: Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? longitude : null,
    };
  } catch {
    return { latitude: null, longitude: null };
  }
}

function venueLocationScore(location: VenueLocation) {
  const coordinateScore = location.latitude != null && location.longitude != null ? 2 : 0;
  return [location.address, location.city, location.region, location.country].filter((part) => String(part ?? "").trim()).length + coordinateScore;
}

function hasUsableVenueLocation(location: VenueLocation | undefined) {
  return venueLocationScore(location ?? {
    address: null,
    city: null,
    region: null,
    country: null,
    latitude: null,
    longitude: null,
  }) >= 2;
}

async function loadVenueLocations(venues: string[]) {
  const uniqueVenues = Array.from(new Set(venues.map((venue) => venue.trim()).filter(Boolean)));
  if (!uniqueVenues.length) return new Map<string, VenueLocation>();

  const entities = await prisma.catalogEntity.findMany({
    where: {
      type: "VENUE",
      OR: uniqueVenues.flatMap((venue) => [
        { canonicalName: { equals: venue, mode: "insensitive" as const } },
        { aliases: { contains: venue, mode: "insensitive" as const } },
      ]),
    },
    select: {
      canonicalName: true,
      aliases: true,
      address: true,
      city: true,
      region: true,
      country: true,
      metadata: true,
      popularity: true,
      lastSeenAt: true,
    },
    orderBy: [{ popularity: "desc" }, { lastSeenAt: "desc" }],
    take: Math.max(uniqueVenues.length * 3, 25),
  });

  const byVenue = new Map<string, VenueLocation>();
  const wanted = new Set(uniqueVenues.map(normalizeVenueKey));

  for (const entity of entities) {
    const coordinates = venueCoordinatesFromMetadata(entity.metadata);
    const location = {
      address: entity.address,
      city: entity.city,
      region: entity.region,
      country: entity.country,
      ...coordinates,
    };
    const names = [entity.canonicalName, ...parseAliases(entity.aliases)];

    for (const name of names) {
      const key = normalizeVenueKey(name);
      if (!key || !wanted.has(key)) continue;
      const existing = byVenue.get(key);
      if (existing && venueLocationScore(existing) >= venueLocationScore(location)) continue;
      byVenue.set(key, location);
    }
  }

  const missingVenues = uniqueVenues.filter((venue) => !hasUsableVenueLocation(byVenue.get(normalizeVenueKey(venue))));

  for (const venue of missingVenues) {
    const suggestions = await searchProviderCatalog({
      query: venue,
      type: "VENUE",
      limit: 10,
      includeProviders: false,
    });
    const exact = suggestions.find((suggestion) => normalizeVenueKey(suggestion.canonicalName || suggestion.label) === normalizeVenueKey(venue));
    const best = exact ?? suggestions[0];
    if (!best) continue;

    const location = {
      address: best.address ?? null,
      city: best.city ?? null,
      region: best.region ?? null,
      country: best.country ?? null,
      ...venueCoordinatesFromMetadata(best.metadata),
    };
    if (hasUsableVenueLocation(location)) {
      byVenue.set(normalizeVenueKey(venue), location);
    }
  }

  return byVenue;
}

async function cacheReceiptConfirmedEventTitle({
  type,
  sellerTitle,
  receiptTitle,
  venue,
  date,
}: {
  type: string | null | undefined;
  sellerTitle: string;
  receiptTitle: string | null | undefined;
  venue: string;
  date: string;
}) {
  const allowed = new Set(["ARTIST", "TEAM", "SPORT", "SHOW", "OTHER"]);
  const requestedType = String(type || "SHOW").trim().toUpperCase();
  const catalogType = allowed.has(requestedType) ? requestedType : "SHOW";
  const canonicalName = String(receiptTitle || "").trim();
  if (!canonicalName || normalizeListingText(canonicalName) !== normalizeListingText(sellerTitle)) return null;

  return prisma.catalogEntity.upsert({
    where: {
      provider_providerId_type: {
        provider: "seller-receipt",
        providerId: catalogProviderId(catalogType, canonicalName),
        type: catalogType,
      },
    },
    create: {
      type: catalogType,
      canonicalName,
      provider: "seller-receipt",
      providerId: catalogProviderId(catalogType, canonicalName),
      aliases: null,
      subtitle: "Receipt-confirmed event",
      address: null,
      city: null,
      region: null,
      country: null,
      sourceUrl: null,
      metadata: JSON.stringify({ venue, date, source: "listing-receipt" }),
      lastSeenAt: new Date(),
    },
    update: {
      canonicalName,
      subtitle: "Receipt-confirmed event",
      metadata: JSON.stringify({ venue, date, source: "listing-receipt" }),
      lastSeenAt: new Date(),
    },
  });
}

function inferEvidenceEventType(title: string, parsedEvidence: any): string | null {
  const manualEventType = typeof parsedEvidence?.manualEventType === "string" ? parsedEvidence.manualEventType.trim().toLowerCase() : "";
  if (manualEventType) return manualEventType;

  const storedInferred = typeof parsedEvidence?.inferredEventType === "string" ? parsedEvidence.inferredEventType.trim().toLowerCase() : "";
  if (storedInferred && storedInferred !== "other") return storedInferred;

  const receiptOcr = parsedEvidence?.receiptProof?.ocr ?? null;
  const officialSync = parsedEvidence?.officialPricingSync ?? null;
  const evidenceText = [
    title,
    receiptOcr?.eventTitle,
    receiptOcr?.artistOrTeam,
    receiptOcr?.rawTextSummary,
    officialSync?.sourceUrl,
  ]
    .filter(Boolean)
    .join(" ");

  const inferred = getEventType(evidenceText).type;
  return inferred === "other" ? null : inferred;
}

function hasActionableValidationMismatch(ticket: any, officialSync: any) {
  const verificationStatus = String(ticket?.verificationStatus ?? "").toUpperCase();
  if (verificationStatus === "REJECTED" || verificationStatus === "NEEDS_REVIEW") return true;

  if (officialSync?.validationMismatch === true || officialSync?.hasValidationMismatch === true) return true;
  if (Array.isArray(officialSync?.sourceIssues) && officialSync.sourceIssues.length > 0) return true;

  return false;
}

function receiptShowsResaleOnly(receiptReview: any) {
  const text = [
    receiptReview?.rawTextSummary,
    receiptReview?.reason,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /\b(verified resale|resale tickets?|fan-to-fan|secondary market)\b/.test(text);
}

function officialWithReceiptSelloutSignal<T extends { soldOut: boolean | null; soldOutSource?: string | null }>(official: T, receiptReview: any): T {
  if (typeof official.soldOut === "boolean") return official;
  if (!receiptShowsResaleOnly(receiptReview)) return official;

  return {
    ...official,
    soldOut: true,
    soldOutSource: "receipt-resale-signal",
  };
}

async function findDuplicateSeatListing(params: {
  sellerId: string;
  title: string;
  date: string;
  section: string | null;
  row: string | null;
  seat: string | null;
  eventId?: string | null;
}) {
  const normalizedTitle = normalizeListingText(params.title);
  const normalizedSection = normalizeListingText(params.section);
  const normalizedRow = normalizeListingText(params.row);
  const normalizedSeat = normalizeListingText(params.seat);
  const submittedParts = [normalizedSection, normalizedRow, normalizedSeat].filter(Boolean);

  if (!normalizedTitle || !params.date || submittedParts.length < 2) return null;

  const candidates = await prisma.ticket.findMany({
    where: {
      sellerId: params.sellerId,
      status: { in: ["AVAILABLE", "RESERVED", "SOLD"] },
      AND: [
        { OR: [{ section: { not: null } }, { row: { not: null } }, { seat: { not: null } }] },
        {
          OR: [
            ...(params.eventId ? [{ eventId: params.eventId }] : []),
            { date: params.date },
          ],
        },
      ],
    },
    select: {
      id: true,
      title: true,
      date: true,
      section: true,
      row: true,
      seat: true,
      status: true,
      eventId: true,
    },
    take: 100,
  });

  return candidates.find((ticket) => {
    const sameEvent = params.eventId && ticket.eventId === params.eventId;
    const sameDateAndTitle = ticket.date === params.date && normalizeListingText(ticket.title) === normalizedTitle;
    return (
      (sameEvent || sameDateAndTitle) &&
      normalizeListingText(ticket.section) === normalizedSection &&
      normalizeListingText(ticket.row) === normalizedRow &&
      normalizeListingText(ticket.seat) === normalizedSeat
    );
  }) ?? null;
}

export async function GET(req: Request) {
  const rlResult = await applyRateLimit(req, "DEFAULT_UNAUTH_READ");
  if (!rlResult.ok) return rlResult.response;

  try {
    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";

    // Optional filters
    const status = url.searchParams.get("status"); // AVAILABLE|SOLD|WITHDRAWN
    const sellerId = url.searchParams.get("sellerId") || undefined;
    const verificationStatus = url.searchParams.get("verificationStatus"); // PENDING|VERIFIED|REJECTED|NEEDS_REVIEW

    // Optional: allow skipping event join if ever needed
    const includeEvent = url.searchParams.get("includeEvent") !== "0";

    const take = Math.min(Math.max(Number(url.searchParams.get("take") || 50), 1), 500);
    const cursor = url.searchParams.get("cursor") || undefined;

    if (status !== "SOLD" && status !== "WITHDRAWN") {
      await withdrawExpiredAvailableTickets();
    }

    const where: any = {};
    if (sellerId) where.sellerId = sellerId;

    // Default behavior: exclude withdrawn tickets unless explicitly requested
    if (status === "AVAILABLE" || status === "SOLD" || status === "WITHDRAWN") {
      where.status = status as "AVAILABLE" | "SOLD" | "WITHDRAWN";
    } else {
      where.status = { in: ["AVAILABLE", "SOLD"] };
    }

    // Marketplace safety: public listing returns only VERIFIED tickets by default.
    // Seller-specific views can see all verification states unless explicitly filtered.
    if (
      verificationStatus === "PENDING" ||
      verificationStatus === "VERIFIED" ||
      verificationStatus === "REJECTED" ||
      verificationStatus === "NEEDS_REVIEW"
    ) {
      where.verificationStatus = verificationStatus as "PENDING" | "VERIFIED" | "REJECTED" | "NEEDS_REVIEW";
    } else if (!sellerId) {
      where.verificationStatus = "VERIFIED";
    }

    const tickets = await prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: take + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        title: true,
        priceCents: true,
        faceValueCents: true,
        adminFeePaidCents: true,
        currency: true,
        image: true,
        venue: true,
        section: true,
        row: true,
        seat: true,
        date: true,
        status: true,
        soldAt: true,
        withdrawnAt: true,
        verificationStatus: true,
        verificationScore: true,
        verificationReason: true,
        verificationProvider: true,
        verificationEvidence: true,
        verifiedAt: true,
        viewCount: true,
        lastViewedAt: true,
        createdAt: true,
        updatedAt: true,
        sellerId: true,
        seller: {
          select: {
            id: true,
            name: true,
            rating: true,
            reviews: true,
            badges: {
              select: {
                name: true,
              },
            },
          },
        },
        ...(includeEvent
          ? {
              event: {
                select: {
                  id: true,
                  title: true,
                  venue: true,
                  date: true,
                  selloutStatus: true,
                },
              },
            }
          : {}),
      },
    });

    const hasNext = tickets.length > take;
    const page = hasNext ? tickets.slice(0, take) : tickets;
    const nextCursor = hasNext ? page[page.length - 1]?.id ?? null : null;
    const venueLocations = await loadVenueLocations(page.map((ticket) => String(ticket.venue || "")));

    const normalized = page.map((t: any) => {
      const priceCents = safeInt((t as any).priceCents);
      const faceValueCents =
        (t as any).faceValueCents == null ? null : safeInt((t as any).faceValueCents);
      const adminFeePaidCents = safeInt((t as any).adminFeePaidCents);
      const currency = normalizeCurrency((t as any).currency);

      const sellerAccessTokenBalance =
        t.seller ? safeInt((t.seller as any).accessTokenBalance) : 0;

      const eventAny: any = (t as any).event;

      let parsedEvidence: any = {};
      try {
        parsedEvidence = (t as any).verificationEvidence ? JSON.parse((t as any).verificationEvidence) : {};
      } catch {
        parsedEvidence = {};
      }

      const officialSync = parsedEvidence?.officialPricingSync ?? null;
      const eventTypeOverride = inferEvidenceEventType(t.title, parsedEvidence);
      const confirmedFaceValueCents =
        typeof officialSync?.officialFaceValueCents === "number" ? officialSync.officialFaceValueCents : null;
      const receiptConfirmedFaceValueCents =
        officialSync?.faceValueSource === "receipt" && faceValueCents != null ? faceValueCents : null;
      const displayedConfirmedFaceValueCents = confirmedFaceValueCents ?? receiptConfirmedFaceValueCents;
      const confirmedMaxListPriceCents =
        displayedConfirmedFaceValueCents == null ? null : displayedConfirmedFaceValueCents + Math.max(0, adminFeePaidCents);
      const officialOriginalFairValueCents = confirmedFaceValueCents;
      const sellerMarkupPaidCents =
        officialOriginalFairValueCents != null && faceValueCents != null
          ? Math.max(0, faceValueCents - officialOriginalFairValueCents)
          : null;
      const sellerTotalPaidCents = faceValueCents != null ? faceValueCents + adminFeePaidCents : null;
      const isAboveConfirmedFaceValue =
        confirmedMaxListPriceCents != null ? priceCents > confirmedMaxListPriceCents : false;
      const isPriceUnconfirmed = displayedConfirmedFaceValueCents == null;
      const isValidationMismatch = hasActionableValidationMismatch(t, officialSync);
      const eventPayload = includeEvent && eventAny
        ? {
            id: eventAny.id,
            title: eventAny.title,
            venue: eventAny.venue,
            date: eventAny.date,
            selloutStatus: eventAny.selloutStatus,
          }
        : includeEvent && officialSync?.soldOut === true
          ? {
              id: null,
              title: t.title,
              venue: t.venue,
              date: t.date,
              selloutStatus: "SOLD_OUT",
            }
          : null;
      const venueLocation = venueLocations.get(normalizeVenueKey(t.venue)) ?? null;

      return {
        id: t.id,
        title: t.title,

        priceCents,
        faceValueCents,
        adminFeePaidCents,
        currency,
        confirmedMaxListPriceCents,
        officialOriginalFairValueCents,
        sellerFaceValuePaidCents: faceValueCents,
        sellerMarkupPaidCents,
        sellerFeesPaidCents: adminFeePaidCents,
        sellerTotalPaidCents,

        price: centsToDollars(priceCents),
        faceValue: faceValueCents != null ? centsToDollars(faceValueCents) : null,
        adminFeePaid: centsToDollars(adminFeePaidCents),
        eventTypeOverride,
        isAboveConfirmedFaceValue,
        isPriceUnconfirmed,
        isValidationMismatch,
        confirmationLog: {
          title: { confirmed: !!officialSync?.found, source: officialSync?.sourceUrl ?? null, note: !!officialSync?.found ? "Matched via official provider event lookup" : "Not confirmed yet" },
          date: { confirmed: !!officialSync?.found, source: officialSync?.sourceUrl ?? null, note: !!officialSync?.found ? "Matched via official provider event lookup" : "Not confirmed yet" },
          location: { confirmed: !!officialSync?.found, source: officialSync?.sourceUrl ?? null, note: !!officialSync?.found ? "Matched via official provider event lookup" : "Not confirmed yet" },
          seat: { confirmed: false, source: null, note: "Primary-market public API does not reliably expose seat/row-level confirmation" },
          price: {
            confirmed: displayedConfirmedFaceValueCents != null,
            source: confirmedFaceValueCents != null ? officialSync?.sourceUrl ?? null : receiptConfirmedFaceValueCents != null ? "receipt-ocr" : null,
            note:
              confirmedFaceValueCents != null
                ? "Confirmed against official primary-market event price range"
                : receiptConfirmedFaceValueCents != null
                  ? "Confirmed via receipt OCR"
                  : "No face value confirmed",
          },
          serviceFees: {
            confirmed: typeof officialSync?.verifiedServiceFeesCents === "number",
            source: officialSync?.officialServiceFeeSource ?? (typeof officialSync?.verifiedServiceFeesCents === "number" ? "receipt-ocr" : null),
            note:
              typeof officialSync?.officialServiceFeesCents === "number"
                ? "Confirmed via official source service fees"
                : typeof officialSync?.verifiedServiceFeesCents === "number"
                  ? "Confirmed via receipt OCR"
                  : "Official source did not provide service fees",
          },
          soldOut: { confirmed: typeof officialSync?.soldOut === "boolean", source: officialSync?.sourceUrl ?? null, note: typeof officialSync?.soldOut === "boolean" ? `Confirmed via official event status${officialSync?.officialStatusCode ? ` (${officialSync.officialStatusCode})` : ""}` : "No official sold-out status confirmed" },
          provider: officialSync?.vendor ?? null,
          syncedAt: officialSync?.syncedAt ?? null,
        },

        image: t.image,
        venue: t.venue,
        venueLocation,
        date: t.date,
        section: (t as any).section ?? null,
        row: (t as any).row ?? null,
        seat: (t as any).seat ?? null,
        status: t.status,

        // Helpful timestamps (safe even if null)
        soldAt: (t as any).soldAt ?? null,
        withdrawnAt: (t as any).withdrawnAt ?? null,

        verificationStatus: (t as any).verificationStatus ?? "PENDING",
        verificationScore: (t as any).verificationScore ?? null,
        verificationReason: (t as any).verificationReason ?? null,
        verificationProvider: (t as any).verificationProvider ?? null,
        verificationEvidence: (t as any).verificationEvidence ?? null,
        verifiedAt: (t as any).verifiedAt ?? null,

        barcodeType: (t as any).barcodeType ?? null,
        barcodeLast4: (t as any).barcodeLast4 ?? null,

        event: eventPayload,

        createdAt: t.createdAt,
        updatedAt: t.updatedAt,

        viewCount: (t as any).viewCount ?? 0,
        lastViewedAt: (t as any).lastViewedAt ?? null,

        sellerId: t.sellerId,
        seller: t.seller
          ? {
              id: t.seller.id,
              name: t.seller.name,
              rating: t.seller.rating,
              reviews: t.seller.reviews,

              accessTokenBalance: sellerAccessTokenBalance,

              badges: t.seller.badges.map((b: any) => b.name),
            }
          : null,
      };
    });

    if (!debug) {
      return NextResponse.json({
        ok: true,
        take,
        nextCursor,
        tickets: normalized,
      });
    }

    return NextResponse.json({
      ok: true,
      tips: {
        purchaseFormat:
          "/api/tickets/<TICKET_ID>/purchase?buyerSellerId=<BUYER_SELLER_ID> + header Idempotency-Key: <uuid>",
        note: "buyerSellerId is REQUIRED for all purchases. Idempotency-Key is REQUIRED to prevent double-charges.",
        filters: "Optional: ?status=AVAILABLE|SOLD|WITHDRAWN&verificationStatus=PENDING|VERIFIED|REJECTED|NEEDS_REVIEW&sellerId=<id>&take=50&cursor=<ticketId>",
        includeEvent: "Optional: ?includeEvent=0 to skip joining event data",
      },
      take,
      nextCursor,
      tickets: normalized.map((t: any) => ({
        ...t,
        ticketId: t.id,
        purchaseUrlTemplate: `/api/tickets/${t.id}/purchase?buyerSellerId=<BUYER_SELLER_ID>`,
        idempotencyHeader: "Idempotency-Key: <uuid>",
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: "Tickets fetch failed", details: message },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const rlResult = await applyRateLimit(req, "tickets:create");
  if (!rlResult.ok) return rlResult.response;

  // ✅ Seller-approved gate (logged in + verified + not banned + canSell + seller.status APPROVED)
  const gate = await requireSellerApproved(req);
  if (!gate.ok) return gate.res;

  const validation = await validateRequest(schemas.ticketCreateApi)(req);
  if (!validation.success) return validation.response;

  const body = validation.data;

  const title = body.title;
  const requestedImage = (body.image ?? "").trim();
  const venue = body.venue;
  const date = body.date;
  const section = (body.section ?? "").trim() || null;
  const row = (body.row ?? "").trim() || null;
  const seat = (body.seat ?? "").trim() || null;

  // New fields from process flow
  const primaryVendor = body.primaryVendor ?? null;
  const transferMethod = body.transferMethod ?? null;
  const barcodeText = body.barcodeText ?? null;
  const verificationImage = body.verificationImage ?? null;
  const receiptFileName = body.receiptFileName ?? null;
  const sellerConfirmedReceiptValues = body.sellerConfirmedReceiptValues === true;
  const purchaseQuantity = body.purchaseQuantity ?? 1;
  const eventTypeOverride = (body.eventTypeOverride ?? "").trim().toLowerCase() || null;
  const catalogRequestType = body.catalogRequestType ?? null;

  // We store cents.
  const priceCentsRaw = body.priceCents;
  const faceValueCents: number | null = body.faceValueCents ?? null;
  const adminFeePaidCents = body.adminFeePaidCents ?? 0;
  const currency = normalizeCurrency((body as any).currency);

  // Image is now auto-fetched server-side for consistency/relevance.
  // Optional client-provided image can be used only as fallback if auto-fetch fails.

  const allowed = new Set([
    "concert", "theatre", "comedy", "conference", "festival", "gala", "opera", "workshop", "other",
    "sports-basketball", "sports-hockey", "sports-baseball", "sports-football", "sports-soccer", "sports-lacrosse", "sports-other",
  ]);
  if (!eventTypeOverride || !allowed.has(eventTypeOverride)) {
    return badRequest("Choose a valid ticket category.");
  }

  const seatingParts = [section, row, seat].filter(Boolean);
  const isGeneralAdmission = [section, row, seat].some((part) => normalizeListingText(part) === "general admission");
  if (!isGeneralAdmission && seatingParts.length < 2) {
    return badRequest("Enter at least two seating details: section, row, or seat.");
  }

  // Optional: event linking
  const eventId = body.eventId ?? null;

  // Optional: barcode payload evidence (raw data is not persisted)
  const barcodeDataRaw = (body.barcodeData ?? "").toString().trim();
  const barcodeType = (body.barcodeType ?? "").toString().trim() || null;

  let barcodeHash: string | null = null;
  if (barcodeDataRaw) {
    if (barcodeDataRaw.length < 8) return badRequest("Barcode data is too short.");
    if (barcodeDataRaw.length > 8192) return badRequest("Barcode data is too long.");

    barcodeHash = createHash("sha256").update(barcodeDataRaw).digest("hex");
  }

  // ✅ Prevent impersonation: the sellerId must come from the logged-in user
  const sellerId = gate.user.sellerId;
  if (!sellerId) {
    // Should not happen if requireSellerApproved() is correct, but keep it bulletproof.
    return NextResponse.json(
      { ok: false, error: "SELLER_LINK_MISSING", message: "Seller profile is missing." },
      { status: 409 }
    );
  }

  try {
    if (barcodeHash) {
      const duplicate = await prisma.ticket.findFirst({
        where: {
          barcodeHash,
          status: { in: ["AVAILABLE", "SOLD"] },
          verificationStatus: { in: ["PENDING", "VERIFIED", "NEEDS_REVIEW"] },
          ...(eventId ? { eventId } : {}),
        },
        select: { id: true },
      });

      if (duplicate) {
        return NextResponse.json(
          {
            ok: false,
            error: "DUPLICATE_BARCODE",
            message: "This barcode appears to already be listed or used. Please contact support if this is incorrect.",
          },
          { status: 409 }
        );
      }
    }

    const duplicateSeat = await findDuplicateSeatListing({
      sellerId,
      title,
      date,
      section,
      row,
      seat,
      eventId,
    });

    if (duplicateSeat) {
      return NextResponse.json(
        {
          ok: false,
          error: "DUPLICATE_ACTIVE_SEAT",
          message:
            "This seat is already listed by you for this event. Withdraw the existing listing before listing the same seat again.",
          duplicateTicketId: duplicateSeat.id,
          duplicateStatus: duplicateSeat.status,
        },
        { status: 409 }
      );
    }

    const providerCheck = await verifyWithProvider({
      eventId,
      title,
      venue,
      date,
      barcodeHash,
      barcodeType,
    });

    let official = await fetchOfficialSnapshot({
      title,
      date,
      venue,
      primaryVendor,
    });

    const receiptReview = await analyzeReceiptProof({
      receiptDataUrl: verificationImage,
      receiptFileName,
      expectedEventTitle: title,
      expectedVenue: venue,
      expectedEventDate: date,
    });

    official = officialWithReceiptSelloutSignal(official, receiptReview);

    const listingCheck = validateListingPriceAgainstOfficial({
      official,
      sellerTitle: title,
      sellerDate: date,
      sellerVenue: venue,
      sellerSection: section,
      sellerRow: row,
      sellerSeat: seat,
      purchaseQuantity,
      priceCents: priceCentsRaw,
      sellerCurrency: currency,
      sellerFaceValueCents: faceValueCents,
      adminFeePaidCents,
      hasReceiptProof: !!verificationImage,
      sellerConfirmedReceiptValues,
      receiptReview,
      action: "list",
    });

    if (!listingCheck.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: listingCheck.error,
          message: listingCheck.message,
          official,
          pricingConfirmation: listingCheck.details ?? null,
        },
        { status: 422 }
      );
    }

    const receiptCatalogEntity = await cacheReceiptConfirmedEventTitle({
      type: catalogRequestType,
      sellerTitle: title,
      receiptTitle: receiptReview?.eventTitle,
      venue,
      date,
    });

    // Auto image pipeline: always attempt event-relevant fetch server-side.
    const evidenceEventType = inferEvidenceEventType(title, {
      manualEventType: eventTypeOverride,
      receiptProof: { ocr: receiptReview },
    });
    const inferredEventType = evidenceEventType ?? getEventType(title).type;
    let imageSource: "brave" | "client-fallback" | "placeholder" = "placeholder";
    let imageReason = "no-usable-auto-image";

    let resolvedImage = await getTicketImage(title, inferredEventType);

    if (resolvedImage && !resolvedImage.startsWith("/")) {
      imageSource = "brave";
      imageReason = "auto-image-selected";
    }

    // Fallback to client-provided image only if auto-fetch failed to get non-placeholder.
    if ((!resolvedImage || resolvedImage.startsWith("/")) && requestedImage) {
      resolvedImage = requestedImage;
      imageSource = "client-fallback";
      imageReason = "auto-returned-placeholder-used-client-image";
    }

    if (!resolvedImage) {
      resolvedImage = "/default.jpg";
      imageSource = "placeholder";
      imageReason = "empty-image-fallback-default";
    }

    const created = await prisma.ticket.create({
      data: {
        title,
        priceCents: priceCentsRaw,
        faceValueCents,
        adminFeePaidCents,
        currency,
        image: resolvedImage,
        venue,
        date,
        section,
        row,
        seat,
        primaryVendor,
        transferMethod,
        barcodeText,
        verificationImage,
        status: "AVAILABLE",
        verificationStatus: "PENDING",
        verificationEvidence: JSON.stringify({
          barcodeProvided: !!barcodeHash,
          provider: providerCheck.provider,
          providerConfirmed: providerCheck.confirmed,
          providerReason: providerCheck.reason,
          manualEventType: eventTypeOverride,
          inferredEventType,
          receiptProof: {
            provided: !!verificationImage,
            fileName: receiptFileName,
            sellerConfirmedReceiptValues,
            confirmedAt: sellerConfirmedReceiptValues ? new Date().toISOString() : null,
            ocr: receiptReview,
          },
          receiptConfirmedCatalogEntityId: receiptCatalogEntity?.id ?? null,
        }),
        barcodeHash,
        sellerId,
        ...(eventId ? { eventId } : {}),
      },
      include: {
        event: true,
        seller: { include: { badges: true } },
      },
    });

    let linkedEventId = created.eventId;
    let shouldBackfillSiblingTickets = false;

    if (typeof official.soldOut === "boolean") {
      const selloutStatus = official.soldOut ? "SOLD_OUT" : "NOT_SOLD_OUT";

      if (linkedEventId) {
        await prisma.event.update({
          where: { id: linkedEventId },
          data: { selloutStatus },
        });
        shouldBackfillSiblingTickets = true;
      } else {
        const existingEvent = await prisma.event.findFirst({
          where: { title, date, venue },
          select: { id: true },
        });

        if (existingEvent) {
          linkedEventId = existingEvent.id;
          await prisma.event.update({
            where: { id: existingEvent.id },
            data: { selloutStatus, venue },
          });
          shouldBackfillSiblingTickets = true;
        } else {
          const ev = await prisma.event.create({
            data: { title, date, venue, selloutStatus },
            select: { id: true },
          });
          linkedEventId = ev.id;
          shouldBackfillSiblingTickets = true;
        }
      }
    } else if (!linkedEventId) {
      const existingEvent = await prisma.event.findFirst({
        where: { title, date, venue },
        select: { id: true },
      });

      if (existingEvent) {
        linkedEventId = existingEvent.id;
      }
    }

    const syncedFaceValueCents = listingCheck.faceValueCents;
    const syncedPriceCents = priceCentsRaw;

    let existingEvidence: any = {};
    try {
      existingEvidence = created.verificationEvidence ? JSON.parse(created.verificationEvidence as any) : {};
    } catch {
      existingEvidence = {};
    }

    await prisma.ticket.update({
      where: { id: created.id },
      data: {
        priceCents: syncedPriceCents,
        faceValueCents: syncedFaceValueCents,
        adminFeePaidCents,
        currency,
        ...(linkedEventId ? { eventId: linkedEventId } : {}),
        verificationEvidence: JSON.stringify({
          ...existingEvidence,
          officialPricingSync: {
            syncedAt: new Date().toISOString(),
            vendor: official.vendor,
            sourceUrl: official.sourceUrl,
            found: official.found,
            officialVenueName: official.officialVenueName ?? null,
            officialPriceRangeMinCents: official.officialPriceRangeMinCents ?? null,
            officialPriceRangeMaxCents: official.officialPriceRangeMaxCents ?? null,
            officialFaceValueCents: official.officialFaceValueCents,
            officialServiceFeesCents: official.officialServiceFeesCents ?? null,
            officialServiceFeeSource: official.officialServiceFeeSource ?? null,
            faceValueSource: listingCheck.faceValueSource,
            adminFeePaidCents,
            verifiedServiceFeesCents: listingCheck.maxListPriceCents - listingCheck.faceValueCents,
            maxListPriceCents: listingCheck.maxListPriceCents,
            officialStatusCode: official.officialStatusCode ?? null,
            soldOut: official.soldOut,
            soldOutSource: official.soldOutSource ?? null,
            reason: official.reason ?? null,
          },
        }),
      },
    });

    if (linkedEventId && shouldBackfillSiblingTickets) {
      await prisma.ticket.updateMany({
        where: {
          title,
          date,
          venue,
          eventId: null,
        },
        data: { eventId: linkedEventId },
      });
    }

    const verified = await autoVerifyTicketById(prisma, created.id);

    const finalTicket = await prisma.ticket.findUnique({
      where: { id: created.id },
      include: { event: true },
    });

    return NextResponse.json(
      {
        ok: true,
        ticket: {
          id: finalTicket?.id ?? created.id,
          title: finalTicket?.title ?? created.title,
          priceCents: finalTicket?.priceCents ?? created.priceCents,
          faceValueCents: finalTicket?.faceValueCents ?? created.faceValueCents,
          adminFeePaidCents: (finalTicket as any)?.adminFeePaidCents ?? (created as any).adminFeePaidCents ?? 0,
          currency: normalizeCurrency((finalTicket as any)?.currency ?? (created as any).currency),
          price: centsToDollars(finalTicket?.priceCents ?? created.priceCents),
          faceValue:
            (finalTicket?.faceValueCents ?? created.faceValueCents) != null
              ? centsToDollars((finalTicket?.faceValueCents ?? created.faceValueCents) as number)
              : null,
          adminFeePaid: centsToDollars((finalTicket as any)?.adminFeePaidCents ?? (created as any).adminFeePaidCents ?? 0),
          image: finalTicket?.image ?? created.image,
          imageSource,
          imageReason,
          venue: finalTicket?.venue ?? created.venue,
          date: finalTicket?.date ?? created.date,
          section: (finalTicket as any)?.section ?? (created as any).section ?? null,
          row: (finalTicket as any)?.row ?? created.row ?? null,
          seat: (finalTicket as any)?.seat ?? created.seat ?? null,
          status: finalTicket?.status ?? created.status,
          verificationStatus: (verified as any)?.verificationStatus ?? (finalTicket as any)?.verificationStatus ?? "PENDING",
          verificationScore: (verified as any)?.verificationScore ?? (finalTicket as any)?.verificationScore ?? null,
          verificationReason: (verified as any)?.verificationReason ?? (finalTicket as any)?.verificationReason ?? null,
          verificationProvider: (verified as any)?.verificationProvider ?? (finalTicket as any)?.verificationProvider ?? null,
          verificationEvidence: (finalTicket as any)?.verificationEvidence ?? null,
          verifiedAt: (verified as any)?.verifiedAt ?? (finalTicket as any)?.verifiedAt ?? null,
          barcodeType: (finalTicket as any)?.barcodeType ?? null,
          barcodeLast4: (finalTicket as any)?.barcodeLast4 ?? null,
          event: finalTicket?.event
            ? {
                id: finalTicket.event.id,
                title: finalTicket.event.title,
                venue: finalTicket.event.venue,
                date: finalTicket.event.date,
                selloutStatus: finalTicket.event.selloutStatus,
              }
            : null,
          sellerId: finalTicket?.sellerId ?? created.sellerId,
          createdAt: finalTicket?.createdAt ?? created.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: "Ticket create failed", details: message },
      { status: 500 }
    );
  }
}
