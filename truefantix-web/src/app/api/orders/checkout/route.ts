export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { applyRateLimit } from "@/lib/rate-limit";
import { schemas, validateRequest } from "@/lib/validation";
import { calculateAdminFeeTax, getTaxRateForVenue } from "@/lib/tax-rates";
import { isTicketEventExpired } from "@/lib/tickets/expiry";

const ADMIN_FEE_BPS = 875;
const BPS_DENOMINATOR = 10_000;

const RESERVATION_MINUTES = 15;
const ACCESS_TOKEN_COST_PER_SOLDOUT_PURCHASE = 1;

function centsToDollars(cents: number) {
  return Number((cents / 100).toFixed(2));
}

function normalizeCurrency(value: unknown): "CAD" | "USD" {
  return String(value || "CAD").trim().toUpperCase() === "USD" ? "USD" : "CAD";
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

class TicketNotAvailableError extends Error {
  ticketId: string;
  constructor(ticketId: string) {
    super(`Ticket not available: ${ticketId}`);
    this.ticketId = ticketId;
    this.name = "TicketNotAvailableError";
  }
}

class InsufficientAccessTokensError extends Error {}

export async function POST(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  const rateLimit = await applyRateLimit(req, "orders:checkout");
  if (!rateLimit.ok) return rateLimit.response;

  try {
    const validation = await validateRequest(schemas.orderCheckout)(req);
    if (!validation.success) return validation.response;

    const buyerSellerId = normalizeId(gate.user.sellerId);
    const requestedBuyerSellerId = normalizeId(validation.data.buyerSellerId);

    if (!buyerSellerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "BUYER_WALLET_MISSING",
          message: "Buyer wallet is not set up for this account.",
        },
        { status: 409 }
      );
    }

    if (requestedBuyerSellerId && requestedBuyerSellerId !== buyerSellerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "FORBIDDEN_BUYER",
          message: "buyerSellerId does not match the logged-in user.",
        },
        { status: 403 }
      );
    }

    // IMPORTANT: de-dupe ticketIds to avoid duplicate OrderItems / confusing totals
    const ticketIds = Array.from(
      new Set((validation.data.ticketIds ?? []).map(normalizeId).filter(Boolean))
    );

    const idempotencyKey = getIdempotencyKey(req, validation.data.idempotencyKey);

    // MVP rule: idempotency is REQUIRED for checkout (avoid double-charges / double-reservations)
    if (!idempotencyKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "VALIDATION_ERROR",
          message:
            "Missing idempotency key (header Idempotency-Key or body.idempotencyKey)",
        },
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
      if (existing.buyerSellerId !== buyerSellerId) {
        return NextResponse.json(
          {
            ok: false,
            error: "FORBIDDEN_BUYER",
            message: "Idempotency key belongs to a different buyer.",
          },
          { status: 403 }
        );
      }

      return NextResponse.json(
        {
          ok: true,
          replay: true,
          order: {
            ...existing,
            amount: centsToDollars(existing.amountCents),
            adminFee: centsToDollars(existing.adminFeeCents),
            adminFeeTax: centsToDollars(existing.adminFeeTaxCents ?? 0),
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
        select: { id: true, accessTokenBalance: true },
      });
      if (!buyer) {
        return {
          ok: false as const,
          status: 400 as const,
          body: { ok: false, error: "buyerSellerId not found" },
        };
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
          body: {
            ok: false,
            error: "One or more tickets not found",
            debug: { missing },
          },
        };
      }

      if (!tickets.length) {
        return {
          ok: false as const,
          status: 404 as const,
          body: { ok: false, error: "No tickets found" },
        };
      }

      const expiredTickets = tickets.filter((ticket: any) =>
        isTicketEventExpired(
          {
            date: ticket.date || ticket.event?.date,
            venue: ticket.venue || ticket.event?.venue,
          },
          now
        )
      );

      if (expiredTickets.length) {
        await tx.ticket.updateMany({
          where: {
            id: { in: expiredTickets.map((ticket: any) => ticket.id) },
            status: "AVAILABLE",
          },
          data: {
            status: "WITHDRAWN",
            withdrawnAt: now,
            reservedByOrderId: null,
            reservedUntil: null,
          },
        });

        return {
          ok: false as const,
          status: 409 as const,
          body: {
            ok: false,
            error: "TICKET_EVENT_EXPIRED",
            message: "One or more selected tickets are for an event that has already started or passed.",
            debug: { ticketIds: expiredTickets.map((ticket: any) => ticket.id) },
          },
        };
      }

      // MVP rule: all tickets must be from the same seller
      const sellerId = tickets[0].sellerId;
      if (tickets.some((t: any) => t.sellerId !== sellerId)) {
        return {
          ok: false as const,
          status: 400 as const,
          body: {
            ok: false,
            error:
              "All tickets in a single order must be from the same seller (MVP)",
          },
        };
      }

      const currency = normalizeCurrency(tickets[0]?.currency);
      if (tickets.some((t: any) => normalizeCurrency(t.currency) !== currency)) {
        return {
          ok: false as const,
          status: 400 as const,
          body: {
            ok: false,
            error: "MIXED_CURRENCY_ORDER",
            message: "Checkout can only include tickets listed in the same currency.",
          },
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
      const soldOutCount = tickets.filter(
        (t: any) => t.event?.selloutStatus === "SOLD_OUT"
      ).length;
      const requiredAccessTokens = soldOutCount * ACCESS_TOKEN_COST_PER_SOLDOUT_PURCHASE;

      if (requiredAccessTokens > 0 && (buyer.accessTokenBalance ?? 0) < requiredAccessTokens) {
        return {
          ok: false as const,
          status: 400 as const,
          body: {
            ok: false,
            error: "Insufficient access tokens to reserve sold-out event tickets",
            debug: {
              buyerAccessTokens: buyer.accessTokenBalance ?? 0,
              requiredAccessTokens,
              soldOutCount,
            },
          },
        };
      }

      // Compute totals for the entire order
      const amountCents = tickets.reduce(
        (sum: number, t: { priceCents: number }) => sum + t.priceCents,
        0
      );
      const adminFeeCents = Math.round(
        (amountCents * ADMIN_FEE_BPS) / BPS_DENOMINATOR
      );
      const taxRate = getTaxRateForVenue(tickets[0]?.event?.venue ?? tickets[0]?.venue);
      const adminFeeTax = calculateAdminFeeTax(adminFeeCents, taxRate);
      const totalCents = amountCents + adminFeeCents + adminFeeTax.taxCents;

      // Create Order header first (we need its id for reservations)
      const order = await tx.order.create({
        data: {
          sellerId,
          buyerSellerId,
          status: "PENDING",
          idempotencyKey,
          amountCents,
          adminFeeCents,
          adminFeeTaxCents: adminFeeTax.taxCents,
          currency,
          taxRateBps: adminFeeTax.rateBps,
          taxRegionCode: adminFeeTax.regionCode || null,
          taxRegionName: adminFeeTax.regionName || null,
          taxCountryCode: adminFeeTax.countryCode || null,
          taxLabel: adminFeeTax.label,
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
          currency,
        })),
      });

      if (requiredAccessTokens > 0) {
        const debited = await tx.seller.updateMany({
          where: {
            id: buyerSellerId,
            accessTokenBalance: { gte: requiredAccessTokens },
          },
          data: { accessTokenBalance: { decrement: requiredAccessTokens } },
        });
        if (debited.count !== 1) throw new InsufficientAccessTokensError();

        const updatedBuyer = await tx.seller.findUnique({
          where: { id: buyerSellerId },
          select: { accessTokenBalance: true },
        });
        const heldBalance = updatedBuyer?.accessTokenBalance ?? 0;
        const soldOutTickets = tickets.filter((t: any) => t.event?.selloutStatus === "SOLD_OUT");
        await tx.accessTokenTransaction.createMany({
          data: soldOutTickets.map((ticket: any, index: number) => ({
            sellerId: buyerSellerId,
            type: "HELD",
            source: "SOLD_OUT_PURCHASE",
            amountAccessTokens: -ACCESS_TOKEN_COST_PER_SOLDOUT_PURCHASE,
            balanceAfterAccessTokens: heldBalance + soldOutTickets.length - index - 1,
            note: `Access token held while order ${order.id} awaits completion`,
            referenceType: "Order",
            referenceId: order.id,
            orderId: order.id,
            ticketId: ticket.id,
          })),
        });
      }

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
                adminFeeTax: centsToDollars(out.adminFeeTaxCents ?? 0),
                total: centsToDollars(out.totalCents),
              }
            : null,
          reservation: { reservedUntil, minutes: RESERVATION_MINUTES },
          soldOutCount,
          requiredAccessTokens,
          next: "Proceed to payment capture -> set Order.PAID, then delivery confirmation -> Order.DELIVERED, then finalize -> Order.COMPLETED",
        },
      };
    });

    if ((result as any)?.ok === false) {
      return NextResponse.json((result as any).body, {
        status: (result as any).status,
      });
    }

    return NextResponse.json((result as any).body, {
      status: (result as any).status ?? 200,
    });
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

    if (err instanceof InsufficientAccessTokensError) {
      return NextResponse.json(
        { ok: false, error: "Insufficient access tokens to reserve sold-out event tickets" },
        { status: 409 }
      );
    }

    if (message.startsWith("Ticket not available:")) {
      return NextResponse.json(
        { ok: false, error: "One or more tickets not available", details: message },
        { status: 409 }
      );
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
        {
          ok: false,
          error: "Checkout already processed (idempotency)",
          details: message,
          debug: { idempotencyKey: bodyKey },
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { ok: false, error: "Checkout failed", details: message },
      { status: 500 }
    );
  }
}
