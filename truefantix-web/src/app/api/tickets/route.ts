export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireSellerApproved } from "@/lib/auth/guards";
import { autoVerifyTicketById } from "@/lib/tickets/verification";
import { verifyWithProvider } from "@/lib/tickets/provider";
import { applyRateLimit, rateLimitError } from "@/lib/rate-limit";
import { getTicketImage } from "@/lib/imageSearch";
import { getEventType } from "@/lib/ticketsView";
import { fetchOfficialSnapshot } from "@/lib/officialPricing";

function safeInt(v: unknown, fallback = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function centsToDollars(cents: number) {
  return Number((cents / 100).toFixed(2));
}

type CreateTicketBody = {
  title?: string;
  priceCents?: number;
  faceValueCents?: number | null;

  image?: string;
  venue?: string;
  date?: string;

  // Optional event linking (future use)
  eventId?: string | null;

  // Optional barcode evidence for anti-duplicate and legitimacy checks
  barcodeData?: string | null;
  barcodeType?: string | null;

  // New fields for escrow and verification
  primaryVendor?: string | null;
  transferMethod?: string | null;
  barcodeText?: string | null; // Extracted text from barcode image
  verificationImage?: string | null; // URL/path to verification image
};

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: "VALIDATION_ERROR", message }, { status: 400 });
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

    const take = Math.min(Math.max(Number(url.searchParams.get("take") || 50), 1), 100);
    const cursor = url.searchParams.get("cursor") || undefined;

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
      include: {
        seller: { include: { badges: true } },
        ...(includeEvent ? { event: true } : {}),
      },
    });

    const hasNext = tickets.length > take;
    const page = hasNext ? tickets.slice(0, take) : tickets;
    const nextCursor = hasNext ? page[page.length - 1]?.id ?? null : null;

    const normalized = page.map((t: any) => {
      const priceCents = safeInt((t as any).priceCents);
      const faceValueCents =
        (t as any).faceValueCents == null ? null : safeInt((t as any).faceValueCents);

      const sellerCredits = t.seller ? safeInt((t.seller as any).creditBalanceCredits) : 0;

      const eventAny: any = (t as any).event;

      let parsedEvidence: any = {};
      try {
        parsedEvidence = (t as any).verificationEvidence ? JSON.parse((t as any).verificationEvidence) : {};
      } catch {
        parsedEvidence = {};
      }

      const officialSync = parsedEvidence?.officialPricingSync ?? null;
      const confirmedFaceValueCents =
        typeof officialSync?.officialFaceValueCents === "number" ? officialSync.officialFaceValueCents : null;
      const isAboveConfirmedFaceValue =
        confirmedFaceValueCents != null ? priceCents > confirmedFaceValueCents : false;
      const isValidationMismatch = officialSync ? (!officialSync.found || !!officialSync.reason) : true;

      return {
        id: t.id,
        title: t.title,

        priceCents,
        faceValueCents,

        price: centsToDollars(priceCents),
        faceValue: faceValueCents != null ? centsToDollars(faceValueCents) : null,
        isAboveConfirmedFaceValue,
        isValidationMismatch,
        confirmationLog: {
          title: { confirmed: !!officialSync?.found, source: officialSync?.sourceUrl ?? null, note: !!officialSync?.found ? "Matched via official provider event lookup" : "Not confirmed yet" },
          date: { confirmed: !!officialSync?.found, source: officialSync?.sourceUrl ?? null, note: !!officialSync?.found ? "Matched via official provider event lookup" : "Not confirmed yet" },
          location: { confirmed: !!officialSync?.found, source: officialSync?.sourceUrl ?? null, note: !!officialSync?.found ? "Matched via official provider event lookup" : "Not confirmed yet" },
          seat: { confirmed: false, source: null, note: "Primary-market public API does not reliably expose seat/row-level confirmation" },
          price: { confirmed: confirmedFaceValueCents != null, source: officialSync?.sourceUrl ?? null, note: confirmedFaceValueCents != null ? "Confirmed against official primary-market event price range" : "No official face value confirmed" },
          soldOut: { confirmed: typeof officialSync?.soldOut === "boolean", source: officialSync?.sourceUrl ?? null, note: typeof officialSync?.soldOut === "boolean" ? "Confirmed via official event status" : "No official sold-out status confirmed" },
          provider: officialSync?.vendor ?? null,
          syncedAt: officialSync?.syncedAt ?? null,
        },

        image: t.image,
        venue: t.venue,
        date: t.date,
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

        event:
          includeEvent && eventAny
            ? {
                id: eventAny.id,
                title: eventAny.title,
                venue: eventAny.venue,
                date: eventAny.date,
                selloutStatus: eventAny.selloutStatus,
              }
            : null,

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

              creditBalanceCredits: sellerCredits,

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

  let body: CreateTicketBody;
  try {
    body = (await req.json()) as CreateTicketBody;
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const title = (body.title ?? "").trim();
  const requestedImage = (body.image ?? "").trim();
  const venue = (body.venue ?? "").trim();
  const date = (body.date ?? "").trim();

  // New fields from process flow
  const primaryVendor = (body.primaryVendor ?? "").trim() || null;
  const transferMethod = (body.transferMethod ?? "").trim() || null;
  const barcodeText = (body.barcodeText ?? "").trim() || null;
  const verificationImage = (body.verificationImage ?? "").trim() || null;

  // We store cents. Keep validation simple + safe.
  const priceCentsRaw = body.priceCents;
  const faceValueCentsRaw = body.faceValueCents;

  if (!title) return badRequest("Title is required.");
  if (title.length > 120) return badRequest("Title must be 120 characters or less.");

  if (priceCentsRaw == null) return badRequest("Price is required.");
  if (typeof priceCentsRaw !== "number" || !Number.isFinite(priceCentsRaw))
    return badRequest("Price must be a number (in cents).");
  if (!Number.isInteger(priceCentsRaw)) return badRequest("Price must be an integer (in cents).");
  if (priceCentsRaw < 1) return badRequest("Price must be at least 1 cent.");

  let faceValueCents: number | null = null;
  if (faceValueCentsRaw != null) {
    if (typeof faceValueCentsRaw !== "number" || !Number.isFinite(faceValueCentsRaw))
      return badRequest("Face value must be a number (in cents).");
    if (!Number.isInteger(faceValueCentsRaw))
      return badRequest("Face value must be an integer (in cents).");
    if (faceValueCentsRaw < 0) return badRequest("Face value cannot be negative.");
    faceValueCents = faceValueCentsRaw;
  }

  // Image is now auto-fetched server-side for consistency/relevance.
  // Optional client-provided image can be used only as fallback if auto-fetch fails.
  if (requestedImage.length > 2048) return badRequest("Image URL is too long.");

  if (!venue) return badRequest("Venue is required.");
  if (venue.length > 200) return badRequest("Venue must be 200 characters or less.");

  if (!date) return badRequest("Date is required.");
  if (date.length > 100) return badRequest("Date must be 100 characters or less.");

  if (primaryVendor && primaryVendor.length > 80) return badRequest("Primary vendor must be 80 characters or less.");
  if (transferMethod && transferMethod.length > 80) return badRequest("Transfer method must be 80 characters or less.");
  if (barcodeText && barcodeText.length > 255) return badRequest("Barcode text must be 255 characters or less.");
  if (verificationImage && verificationImage.length > 2048) return badRequest("Verification image URL is too long.");

  // Optional: event linking
  const eventId = (body.eventId ?? null)?.toString().trim() || null;

  // Optional: barcode payload evidence (raw data is not persisted)
  const barcodeDataRaw = (body.barcodeData ?? "").toString().trim();
  const barcodeType = (body.barcodeType ?? "").toString().trim() || null;

  let barcodeHash: string | null = null;
  let barcodeLast4: string | null = null;
  if (barcodeDataRaw) {
    if (barcodeDataRaw.length < 8) return badRequest("Barcode data is too short.");
    if (barcodeDataRaw.length > 8192) return badRequest("Barcode data is too long.");

    barcodeHash = createHash("sha256").update(barcodeDataRaw).digest("hex");
    barcodeLast4 = barcodeDataRaw.slice(-4);
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

    const providerCheck = await verifyWithProvider({
      eventId,
      title,
      venue,
      date,
      barcodeHash,
      barcodeType,
    });

    // Auto image pipeline: always attempt event-relevant fetch server-side.
    const inferredEventType = getEventType(title).type;
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
        image: resolvedImage,
        venue,
        date,
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

    // Immediate (on-create) official-market sync so tags/pricing are auto-corrected
    // right when a listing is created (no scheduled wait required).
    const official = await fetchOfficialSnapshot({
      title,
      date,
      venue,
      primaryVendor,
    });

    let linkedEventId = created.eventId;

    if (typeof official.soldOut === "boolean") {
      const selloutStatus = official.soldOut ? "SOLD_OUT" : "NOT_SOLD_OUT";

      if (linkedEventId) {
        await prisma.event.update({
          where: { id: linkedEventId },
          data: { selloutStatus },
        });
      } else {
        const existingEvent = await prisma.event.findFirst({
          where: { title, date },
          select: { id: true },
        });

        if (existingEvent) {
          linkedEventId = existingEvent.id;
          await prisma.event.update({
            where: { id: existingEvent.id },
            data: { selloutStatus, venue },
          });
        } else {
          const ev = await prisma.event.create({
            data: { title, date, venue, selloutStatus },
            select: { id: true },
          });
          linkedEventId = ev.id;
        }
      }
    }

    const syncedFaceValueCents = official.officialFaceValueCents ?? faceValueCents;
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
        ...(linkedEventId ? { eventId: linkedEventId } : {}),
        verificationEvidence: JSON.stringify({
          ...existingEvidence,
          officialPricingSync: {
            syncedAt: new Date().toISOString(),
            vendor: official.vendor,
            sourceUrl: official.sourceUrl,
            found: official.found,
            officialFaceValueCents: official.officialFaceValueCents,
            soldOut: official.soldOut,
            reason: official.reason ?? null,
          },
        }),
      },
    });

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
          price: centsToDollars(finalTicket?.priceCents ?? created.priceCents),
          faceValue:
            (finalTicket?.faceValueCents ?? created.faceValueCents) != null
              ? centsToDollars((finalTicket?.faceValueCents ?? created.faceValueCents) as number)
              : null,
          image: finalTicket?.image ?? created.image,
          imageSource,
          imageReason,
          venue: finalTicket?.venue ?? created.venue,
          date: finalTicket?.date ?? created.date,
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
