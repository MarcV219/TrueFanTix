export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ADMIN_FEE_BPS = 875;
const BPS_DENOMINATOR = 10_000;

const RESERVATION_MINUTES = 15;
const CREDIT_COST_PER_SOLDOUT_PURCHASE = 1;

function centsToDollars(cents: number) {
  return Number((cents / 100).toFixed(2));
}

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function getIdempotencyKey(req: Request, bodyKey?: string): string {
  const fromHeader = normalizeId(req.headers.get("idempotency-key"));
  if (fromHeader) return fromHeader;
  if (bodyKey) return normalizeId(bodyKey);
  return "";
}

type CheckoutBody = {
  ticketIds: string[];
  buyerSellerId: string;
  idempotencyKey?: string;
};

class TicketNotAvailableError extends Error {
  ticketId: string;
  constructor(ticketId: string) {
    super(`Ticket not available: ${ticketId}`);
    this.ticketId = ticketId;
    this.name = "TicketNotAvailableError";
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CheckoutBody;

    const buyerSellerId = normalizeId(body?.buyerSellerId);

    // IMPORTANT: de-dupe ticketIds to avoid duplicate OrderItems / confusing totals
    const ticketIds = Array.isArray(body?.ticketIds)
      ? Array.from(new Set(body.ticketIds.map(normalizeId).filter(Boolean)))
      : [];

    const idempotencyKey = getIdempotencyKey(req, body?.idempotencyKey);

    if (!buyerSellerId) {
      return NextResponse.json({ ok: false, error: "Missing buyerSellerId" }, { status: 400 });
    }
    if (!ticketIds.length) {
      return NextResponse.json({ ok: false, error: "Missing ticketIds[]" }, { status: 400 });
    }
    if (ticketIds.length > 10) {
      return NextResponse.json({ ok: false, error: "Too many tickets in one checkout (max 10)" }, { status: 400 });
    }
    if (!idempotencyKey) {
      return NextResponse.json(
        { ok: false, error: "Missing idempotency key (header Idempotency-Key or body.idempotencyKey)" },
        { status: 400 }
      );
    }

    // Idempotency replay (fast path)
    // Only replay if the prior order exists and has items (i.e., a real checkout result)
    const existing = await prisma.order.findUnique({
      where: { idempotencyKey },
      include: { items: { include: { ticket: true } }, payment: true },
    });
    if (existing && existing.items?.length) {
      return NextResponse.json(
        {
          ok: true,
          replay: true,
          order: {
            ...existing,
            amount: centsToDollars(existing.amountCents),
            adminFee: centsToDollars(existing.adminFeeCents),
            total: centsToDollars(existing.totalCents),
          },
        },
        { status: 200 }
      );
    }

    const now = new Date();
    const reservedUntil = new Date(now.getTime() + RESERVATION_MINUTES * 60_000);

    const result = await prisma.$transaction(async (tx: any) => {
      // Buyer must exist (buyer is a Seller record in your current model)
      const buyer = await tx.seller.findUnique({
        where: { id: buyerSellerId },
        select: { id: true, creditBalanceCredits: true },
      });
      if (!buyer) {
        return { ok: false as const, status: 400 as const, body: { ok: false, error: "buyerSellerId not found" } };
      }

      // Load all tickets + event
      const tickets = await tx.ticket.findMany({
        where: { id: { in: ticketIds } },
        include: { event: true },
      });

      if (tickets.length !== ticketIds.length) {
        const found = new Set(tickets.map((t: any) => t.id));
        const missing = ticketIds.filter((id: any) => !found.has(id));
        return {
          ok: false as const,
          status: 404 as const,
          body: { ok: false, error: "One or more tickets not found", debug: { missing } },
        };
      }

      if (!tickets.length) {
        return {
          ok: false as const,
          status: 404 as const,
          body: { ok: false, error: "No tickets found" },
        };
      }

      // MVP rule: all tickets must be from the same seller
      const sellerId = tickets[0].sellerId;
      if (tickets.some((t: any) => t.sellerId !== sellerId)) {
        return {
          ok: false as const,
          status: 400 as const,
          body: { ok: false, error: "All tickets in a single order must be from the same seller (MVP)" },
        };
      }

      // No self-buy
      if (buyerSellerId === sellerId) {
        return {
          ok: false as const,
          status: 400 as const,
          body: { ok: false, error: "You cannot buy your own tickets" },
        };
      }

      // Sold-out access token requirement: 1 access token per SOLD_OUT ticket
      const soldOutCount = tickets.filter((t: any) => t.event?.selloutStatus === "SOLD_OUT").length;
      const requiredCredits = soldOutCount * CREDIT_COST_PER_SOLDOUT_PURCHASE;

      if (requiredCredits > 0 && (buyer.creditBalanceCredits ?? 0) < requiredCredits) {
        return {
          ok: false as const,
          status: 400 as const,
          body: {
            ok: false,
            error: "Insufficient access tokens to reserve sold-out event tickets",
            debug: { buyerCredits: buyer.creditBalanceCredits ?? 0, requiredCredits, soldOutCount },
          },
        };
      }

      // Compute totals for the entire order
      const amountCents = tickets.reduce((sum: number, t: { priceCents: number }) => sum + t.priceCents, 0);
      const adminFeeCents = Math.round((amountCents * ADMIN_FEE_BPS) / BPS_DENOMINATOR);
      const totalCents = amountCents + adminFeeCents;

      // Create Order header first (we need its id for reservations)
      const order = await tx.order.create({
        data: {
          sellerId,
          buyerSellerId,
          status: "PENDING",
          idempotencyKey,
          amountCents,
          adminFeeCents,
          totalCents,
        },
      });

      // Reserve all tickets atomically (all-or-nothing)
      // ✅ Reserve if:
      //   - AVAILABLE
      //   - OR RESERVED but expired (reservedUntil <= now)
      // This is safe even without OrderItem.ticketId uniqueness.
      for (const t of tickets) {
        const reserved = await tx.ticket.updateMany({
          where: {
            id: t.id,
            withdrawnAt: null,
            soldAt: null,
            OR: [
              { status: "AVAILABLE" },
              { status: "RESERVED", reservedUntil: { not: null, lte: now } },
            ],
          },
          data: {
            status: "RESERVED",
            reservedByOrderId: order.id,
            reservedUntil,
          },
        });

        if (reserved.count !== 1) {
          // Force rollback of the whole transaction
          throw new TicketNotAvailableError(t.id);
        }
      }

      // Create OrderItems (snapshot pricing)
      await tx.orderItem.createMany({
        data: tickets.map((t: any) => ({
          orderId: order.id,
          ticketId: t.id,
          priceCents: t.priceCents,
          faceValueCents: t.faceValueCents ?? null,
        })),
      });

      // Return fully hydrated order
      const out = await tx.order.findUnique({
        where: { id: order.id },
        include: { items: { include: { ticket: true } }, payment: true },
      });

      return {
        ok: true as const,
        status: 201 as const,
        body: {
          ok: true,
          order: out
            ? {
                ...out,
                amount: centsToDollars(out.amountCents),
                adminFee: centsToDollars(out.adminFeeCents),
                total: centsToDollars(out.totalCents),
              }
            : null,
          reservation: { reservedUntil, minutes: RESERVATION_MINUTES },
          soldOutCount,
          requiredCredits,
          next: "Proceed to payment capture -> set Order.PAID, then delivery confirmation -> Order.DELIVERED, then finalize -> Order.COMPLETED",
        },
      };
    });

    if ((result as any)?.ok === false) {
      return NextResponse.json((result as any).body, { status: (result as any).status });
    }

    return NextResponse.json((result as any).body, { status: (result as any).status ?? 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (err instanceof TicketNotAvailableError) {
      return NextResponse.json(
        {
          ok: false,
          error: "One or more tickets not available",
          details: err.message,
          debug: { ticketId: err.ticketId },
        },
        { status: 409 }
      );
    }

    if (message.startsWith("Ticket not available:")) {
      return NextResponse.json({ ok: false, error: "One or more tickets not available", details: message }, { status: 409 });
    }

    if (err && typeof err === "object" && "code" in err && (err as any).code === "P2002") {
      // If two requests race with the same idempotencyKey, return idempotency-ish response
      const bodyKey = (() => {
        try {
          return getIdempotencyKey(req);
        } catch {
          return "";
        }
      })();

      return NextResponse.json(
        { ok: false, error: "Checkout already processed (idempotency)", details: message, debug: { idempotencyKey: bodyKey } },
        { status: 200 }
      );
    }

    return NextResponse.json({ ok: false, error: "Checkout failed", details: message }, { status: 500 });
  }
}
