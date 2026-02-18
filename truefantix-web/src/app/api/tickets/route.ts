export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TicketStatus } from "@prisma/client";
import { requireSellerApproved } from "@/lib/auth/guards";

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
};

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: "VALIDATION_ERROR", message }, { status: 400 });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";

    // Optional filters
    const status = url.searchParams.get("status"); // AVAILABLE|SOLD|WITHDRAWN
    const sellerId = url.searchParams.get("sellerId") || undefined;

    // Optional: allow skipping event join if ever needed
    const includeEvent = url.searchParams.get("includeEvent") !== "0";

    const take = Math.min(Math.max(Number(url.searchParams.get("take") || 50), 1), 100);
    const cursor = url.searchParams.get("cursor") || undefined;

    const where: any = {};
    if (sellerId) where.sellerId = sellerId;

    // Default behavior: exclude withdrawn tickets unless explicitly requested
    if (status === "AVAILABLE" || status === "SOLD" || status === "WITHDRAWN") {
      where.status = status as TicketStatus;
    } else {
      where.status = { in: [TicketStatus.AVAILABLE, TicketStatus.SOLD] };
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

    const normalized = page.map((t) => {
      const priceCents = safeInt((t as any).priceCents);
      const faceValueCents =
        (t as any).faceValueCents == null ? null : safeInt((t as any).faceValueCents);

      const sellerCredits = t.seller ? safeInt((t.seller as any).creditBalanceCredits) : 0;

      const eventAny: any = (t as any).event;

      return {
        id: t.id,
        title: t.title,

        priceCents,
        faceValueCents,

        price: centsToDollars(priceCents),
        faceValue: faceValueCents != null ? centsToDollars(faceValueCents) : null,

        image: t.image,
        venue: t.venue,
        date: t.date,
        status: t.status,

        // Helpful timestamps (safe even if null)
        soldAt: (t as any).soldAt ?? null,
        withdrawnAt: (t as any).withdrawnAt ?? null,

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

              badges: t.seller.badges.map((b) => b.name),
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
        filters: "Optional: ?status=AVAILABLE|SOLD|WITHDRAWN&sellerId=<id>&take=50&cursor=<ticketId>",
        includeEvent: "Optional: ?includeEvent=0 to skip joining event data",
      },
      take,
      nextCursor,
      tickets: normalized.map((t) => ({
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
  const image = (body.image ?? "").trim();
  const venue = (body.venue ?? "").trim();
  const date = (body.date ?? "").trim();

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

  if (!image) return badRequest("Image URL is required.");
  if (image.length > 2048) return badRequest("Image URL is too long.");

  if (!venue) return badRequest("Venue is required.");
  if (venue.length > 200) return badRequest("Venue must be 200 characters or less.");

  if (!date) return badRequest("Date is required.");
  if (date.length > 100) return badRequest("Date must be 100 characters or less.");

  // Optional: event linking
  const eventId = (body.eventId ?? null)?.toString().trim() || null;

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
    const created = await prisma.ticket.create({
      data: {
        title,
        priceCents: priceCentsRaw,
        faceValueCents,
        image,
        venue,
        date,
        status: TicketStatus.AVAILABLE,
        sellerId,
        ...(eventId ? { eventId } : {}),
      },
      include: {
        event: true,
        seller: { include: { badges: true } },
      },
    });

    return NextResponse.json(
      {
        ok: true,
        ticket: {
          id: created.id,
          title: created.title,
          priceCents: created.priceCents,
          faceValueCents: created.faceValueCents,
          price: centsToDollars(created.priceCents),
          faceValue:
            created.faceValueCents != null ? centsToDollars(created.faceValueCents) : null,
          image: created.image,
          venue: created.venue,
          date: created.date,
          status: created.status,
          event: created.event
            ? {
                id: created.event.id,
                title: created.event.title,
                venue: created.event.venue,
                date: created.event.date,
                selloutStatus: created.event.selloutStatus,
              }
            : null,
          sellerId: created.sellerId,
          createdAt: created.createdAt,
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
