export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSellerApproved } from "@/lib/auth/guards";
import { fetchOfficialSnapshot } from "@/lib/officialPricing";
import { getTicketImage } from "@/lib/imageSearch";
import { getEventType } from "@/lib/ticketsView";
import { validateListingPriceAgainstOfficial } from "@/lib/tickets/listingValidation";
import { analyzeReceiptProof, type ReceiptOcrReview } from "@/lib/tickets/receiptOcr";

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function parseTicketIdFromUrl(req: Request): string {
  // /api/tickets/<id>
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const ticketsIndex = parts.indexOf("tickets");
  if (ticketsIndex !== -1 && parts.length > ticketsIndex + 1) {
    return normalizeId(parts[ticketsIndex + 1]);
  }
  return "";
}

function safeInt(v: unknown, fallback = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function centsToDollars(cents: number) {
  return Number((cents / 100).toFixed(2));
}

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: "VALIDATION_ERROR", message }, { status: 400 });
}

function receiptReviewFromEvidence(value: unknown): ReceiptOcrReview | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const ocr = parsed?.receiptProof?.ocr;
    return ocr && typeof ocr === "object" ? ocr as ReceiptOcrReview : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const ticketId = parseTicketIdFromUrl(req);

    if (!ticketId) {
      return NextResponse.json(
        { ok: false, error: "Missing ticket id", debug: { url: req.url } },
        { status: 400 }
      );
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        title: true,
        priceCents: true,
        faceValueCents: true,
        adminFeePaidCents: true,
        image: true,
        venue: true,
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
        event: {
          select: {
            id: true,
            selloutStatus: true,
          },
        },
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
      },
    });

    if (!ticket) {
      return NextResponse.json({ ok: false, error: "Ticket not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      ticket: {
        ...ticket,
        seller: ticket.seller
          ? { ...ticket.seller, badges: ticket.seller.badges.map((b: any) => b.name) }
          : null,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: "Ticket lookup failed", details: message },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  const gate = await requireSellerApproved(req);
  if (!gate.ok) return gate.res;

  try {
    const ticketId = parseTicketIdFromUrl(req);
    const sellerId = gate.user.sellerId;

    if (!ticketId) {
      return NextResponse.json(
        { ok: false, error: "Missing ticket id", debug: { url: req.url } },
        { status: 400 }
      );
    }

    if (!sellerId) {
      return NextResponse.json(
        { ok: false, error: "SELLER_LINK_MISSING", message: "Seller profile is missing." },
        { status: 409 }
      );
    }

    const existing = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        sellerId: true,
        title: true,
        venue: true,
        date: true,
        row: true,
        seat: true,
        priceCents: true,
        faceValueCents: true,
        adminFeePaidCents: true,
        status: true,
        reservedUntil: true,
        reservedByOrderId: true,
        eventId: true,
        primaryVendor: true,
        verificationImage: true,
        verificationEvidence: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ ok: false, error: "Ticket not found" }, { status: 404 });
    }

    if (existing.sellerId !== sellerId) {
      return NextResponse.json(
        { ok: false, error: "Not authorized to edit this ticket" },
        { status: 403 }
      );
    }

    if (existing.status === "SOLD") {
      return NextResponse.json(
        { ok: false, error: "Cannot edit a SOLD ticket" },
        { status: 400 }
      );
    }

    if (existing.status === "WITHDRAWN") {
      return NextResponse.json(
        { ok: false, error: "Cannot edit a WITHDRAWN ticket" },
        { status: 400 }
      );
    }

    const now = new Date();
    const isActivelyReserved =
      existing.status === "RESERVED" &&
      existing.reservedUntil != null &&
      existing.reservedUntil > now;

    if (isActivelyReserved) {
      return NextResponse.json(
        {
          ok: false,
          error: "Cannot edit: ticket is currently reserved",
          debug: {
            reservedUntil: existing.reservedUntil,
            reservedByOrderId: existing.reservedByOrderId,
          },
        },
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return badRequest("Invalid JSON body.");

    const title = typeof body.title === "string" ? body.title.trim() : existing.title;
    const venue = typeof body.venue === "string" ? body.venue.trim() : existing.venue;
    const date = typeof body.date === "string" ? body.date.trim() : existing.date;
    const row = typeof body.row === "string" ? body.row.trim() || null : existing.row;
    const seat = typeof body.seat === "string" ? body.seat.trim() || null : existing.seat;
    const primaryVendor = typeof body.primaryVendor === "string" ? body.primaryVendor.trim() || null : existing.primaryVendor;
    const priceCents =
      typeof body.priceCents === "number" && Number.isInteger(body.priceCents)
        ? body.priceCents
        : existing.priceCents;
    const faceValueCents =
      body.faceValueCents === null
        ? null
        : typeof body.faceValueCents === "number" && Number.isInteger(body.faceValueCents)
        ? body.faceValueCents
        : existing.faceValueCents;
    const adminFeePaidCents =
      typeof body.adminFeePaidCents === "number" && Number.isInteger(body.adminFeePaidCents)
        ? body.adminFeePaidCents
        : existing.adminFeePaidCents;

    if (title.length < 1 || title.length > 120) return badRequest("Title is required.");
    if (venue.length < 1 || venue.length > 200) return badRequest("Venue is required.");
    if (date.length < 1 || date.length > 100) return badRequest("Date is required.");
    if (row && row.length > 80) return badRequest("Row must be 80 characters or less.");
    if (seat && seat.length > 80) return badRequest("Seat must be 80 characters or less.");
    if (!Number.isInteger(priceCents) || priceCents <= 0 || priceCents > 10_000_000) {
      return badRequest("Price must be greater than 0.");
    }
    if (faceValueCents != null && (!Number.isInteger(faceValueCents) || faceValueCents < 0)) {
      return badRequest("Face value must be 0 or greater.");
    }
    if (!Number.isInteger(adminFeePaidCents) || adminFeePaidCents < 0 || adminFeePaidCents > 10_000_000) {
      return badRequest("Admin fees paid must be 0 or greater.");
    }

    const official = await fetchOfficialSnapshot({
      title,
      date,
      venue,
      primaryVendor,
    });

    const existingReceiptReview = receiptReviewFromEvidence(existing.verificationEvidence);
    const receiptReview =
      existingReceiptReview ??
      await analyzeReceiptProof({
        receiptDataUrl: existing.verificationImage,
        receiptFileName: null,
      });

    const listingCheck = validateListingPriceAgainstOfficial({
      official,
      sellerTitle: title,
      sellerDate: date,
      sellerVenue: venue,
      sellerRow: row,
      sellerSeat: seat,
      purchaseQuantity: 1,
      priceCents,
      sellerFaceValueCents: faceValueCents,
      adminFeePaidCents,
      hasReceiptProof: !!existing.verificationImage,
      sellerConfirmedReceiptValues: true,
      receiptReview,
      action: "update",
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

    let linkedEventId = existing.eventId;
    if (typeof official.soldOut === "boolean") {
      const selloutStatus = official.soldOut ? "SOLD_OUT" : "NOT_SOLD_OUT";
      if (linkedEventId) {
        await prisma.event.update({
          where: { id: linkedEventId },
          data: { title, date, venue, selloutStatus },
        });
      } else {
        const matchedEvent = await prisma.event.findFirst({
          where: { title, date },
          select: { id: true },
        });
        if (matchedEvent) {
          linkedEventId = matchedEvent.id;
          await prisma.event.update({
            where: { id: matchedEvent.id },
            data: { venue, selloutStatus },
          });
        } else {
          const createdEvent = await prisma.event.create({
            data: { title, date, venue, selloutStatus },
            select: { id: true },
          });
          linkedEventId = createdEvent.id;
        }
      }
    }

    let existingEvidence: any = {};
    try {
      existingEvidence = existing.verificationEvidence ? JSON.parse(existing.verificationEvidence as any) : {};
    } catch {
      existingEvidence = {};
    }

    const image = await getTicketImage(title, getEventType(title).type);
    const updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        title,
        venue,
        date,
        row,
        seat,
        priceCents,
        faceValueCents: listingCheck.faceValueCents,
        adminFeePaidCents,
        image,
        primaryVendor,
        ...(linkedEventId ? { eventId: linkedEventId } : {}),
        verificationStatus: "PENDING",
        verificationScore: null,
        verificationReason: null,
        verificationProvider: null,
        verifiedAt: null,
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
          receiptProof: {
            ...(existingEvidence.receiptProof ?? {}),
            ocr: receiptReview,
          },
          sellerEditedAt: new Date().toISOString(),
        }),
      },
      include: { event: true },
    });

    return NextResponse.json({
      ok: true,
      message: "Ticket updated",
      ticket: {
        id: updated.id,
        title: updated.title,
        priceCents: safeInt(updated.priceCents),
        faceValueCents: updated.faceValueCents,
        adminFeePaidCents: (updated as any).adminFeePaidCents ?? 0,
        price: centsToDollars(safeInt(updated.priceCents)),
        faceValue: updated.faceValueCents == null ? null : centsToDollars(updated.faceValueCents),
        adminFeePaid: centsToDollars((updated as any).adminFeePaidCents ?? 0),
        image: updated.image,
        venue: updated.venue,
        date: updated.date,
        row: updated.row,
        seat: updated.seat,
        status: updated.status,
        verificationStatus: updated.verificationStatus,
        verificationScore: updated.verificationScore,
        verificationReason: updated.verificationReason,
        event: updated.event
          ? {
              id: updated.event.id,
              title: updated.event.title,
              venue: updated.event.venue,
              date: updated.event.date,
              selloutStatus: updated.event.selloutStatus,
            }
          : null,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: "Ticket update failed", details: message },
      { status: 500 }
    );
  }
}

/**
 * Withdraw (soft-remove) an unsold ticket.
 * Call: DELETE /api/tickets/<TICKET_ID>?sellerId=<SELLER_ID>
 *
 * Rules:
 * - Seller can withdraw only their own ticket.
 * - Cannot withdraw SOLD.
 * - Cannot withdraw during an active reservation window.
 * - If RESERVED but expired, allow withdraw and clear reservation fields.
 * - AVAILABLE is withdrawable.
 */
export async function DELETE(req: Request) {
  const gate = await requireSellerApproved(req);
  if (!gate.ok) return gate.res;

  try {
    const ticketId = parseTicketIdFromUrl(req);
    const url = new URL(req.url);
    const requestedSellerId = normalizeId(url.searchParams.get("sellerId"));
    const sellerId = gate.user.sellerId;

    if (!ticketId) {
      return NextResponse.json(
        { ok: false, error: "Missing ticket id", debug: { url: req.url } },
        { status: 400 }
      );
    }

    if (!sellerId) {
      return NextResponse.json(
        { ok: false, error: "SELLER_LINK_MISSING", message: "Seller profile is missing." },
        { status: 409 }
      );
    }

    if (requestedSellerId && requestedSellerId !== sellerId) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "sellerId does not match the logged-in user." },
        { status: 403 }
      );
    }

    const now = new Date();

    // Load ticket + reservation fields for guardrails
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        sellerId: true,
        status: true,
        reservedUntil: true,
        reservedByOrderId: true,
      },
    });

    if (!ticket) {
      return NextResponse.json({ ok: false, error: "Ticket not found" }, { status: 404 });
    }

    // Only the listing seller can withdraw
    if (ticket.sellerId !== sellerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Not authorized to withdraw this ticket",
        },
        { status: 403 }
      );
    }

    // Guardrails
    if (ticket.status === "SOLD") {
      return NextResponse.json(
        { ok: false, error: "Cannot withdraw a SOLD ticket" },
        { status: 400 }
      );
    }

    // Block withdraw during an active reservation window
    const isActivelyReserved =
      ticket.status === "RESERVED" &&
      ticket.reservedUntil != null &&
      ticket.reservedUntil > now;

    if (isActivelyReserved) {
      return NextResponse.json(
        {
          ok: false,
          error: "Cannot withdraw: ticket is currently reserved",
          debug: {
            reservedUntil: ticket.reservedUntil,
            reservedByOrderId: ticket.reservedByOrderId,
          },
        },
        { status: 409 }
      );
    }

    // Only AVAILABLE or (RESERVED but expired) can be withdrawn
    if (ticket.status !== "AVAILABLE" && ticket.status !== "RESERVED") {
      return NextResponse.json(
        {
          ok: false,
          error: "Only AVAILABLE tickets can be withdrawn (or RESERVED if expired)",
          debug: { status: ticket.status },
        },
        { status: 400 }
      );
    }

    // Soft withdraw atomically, expiry-aware:
    // - If AVAILABLE: withdraw
    // - If RESERVED but expired: withdraw and clear reservation fields
    const updated = await prisma.ticket.updateMany({
      where: {
        id: ticketId,
        sellerId,
        OR: [
          { status: "AVAILABLE" },
          {
            status: "RESERVED",
            OR: [{ reservedUntil: null }, { reservedUntil: { lte: now } }],
          },
        ],
      },
      data: {
        status: "WITHDRAWN",
        withdrawnAt: new Date(),
        reservedUntil: null,
        reservedByOrderId: null,
      },
    });

    if (updated.count !== 1) {
      return NextResponse.json(
        { ok: false, error: "Ticket could not be withdrawn (status changed or active reservation)" },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Ticket withdrawn",
      withdrawnTicketId: ticketId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: "Withdraw failed", details: message },
      { status: 500 }
    );
  }
}
