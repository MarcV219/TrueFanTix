export const runtime = "nodejs";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma, TicketStatus, OrderStatus } from "@prisma/client";
import { requireVerifiedUser } from "@/lib/auth/guards";

const ADMIN_FEE_BPS = 875; // 8.75%
const BPS_DENOMINATOR = 10_000;

const RESERVATION_MINUTES = 15;
const CREDIT_COST_PER_SOLDOUT_PURCHASE = 1;

type Ctx = { params?: Promise<{ id?: string }> | { id?: string } };

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

function parseTicketIdFromUrl(req: Request): string {
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const ticketsIndex = parts.indexOf("tickets");
  if (ticketsIndex !== -1 && parts.length > ticketsIndex + 1) {
    return normalizeId(parts[ticketsIndex + 1]);
  }
  return "";
}

async function getTicketId(req: Request, ctx: Ctx): Promise<string> {
  const fromUrl = parseTicketIdFromUrl(req);
  if (fromUrl) return fromUrl;

  const p: any = ctx?.params;
  if (!p) return "";
  const resolved = typeof p?.then === "function" ? await p : p;
  return normalizeId(resolved?.id);
}

function getIdempotencyKey(req: Request): string {
  const fromHeader = normalizeId(req.headers.get("idempotency-key"));
  if (fromHeader) return fromHeader;

  const url = new URL(req.url);
  const fromQuery = normalizeId(url.searchParams.get("idempotencyKey"));
  return fromQuery;
}

export async function POST(req: Request, ctx: Ctx) {
  // ✅ Step 3 enforcement: must be logged in + verified + not banned
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  // Optional: if you want a "canBuy" kill-switch.
  if (gate.user.canBuy !== true) {
    return NextResponse.json(
      { ok: false, error: "BUYING_DISABLED", message: "Buying is disabled for this account." },
      { status: 403 }
    );
  }

  try {
    const ticketId = await getTicketId(req, ctx);
    const url = new URL(req.url);

    // MVP: existing flow passes buyerSellerId; we must ensure it belongs to the logged-in user.
    const buyerSellerId = normalizeId(url.searchParams.get("buyerSellerId"));
    const idempotencyKey = getIdempotencyKey(req);

    if (!ticketId) {
      return NextResponse.json(
        { ok: false, error: "Missing ticket id in URL" },
        { status: 400 }
      );
    }

    if (!buyerSellerId) {
      return NextResponse.json(
        { ok: false, error: "Missing buyerSellerId" },
        { status: 400 }
      );
    }

    // ✅ Bulletproof buyer identity enforcement:
    // Purchases MUST use the buyer "wallet" Seller record linked at User.sellerId
    // (created via /api/auth/ensure-buyer).
    const loggedInBuyerSellerId = gate.user.sellerId;

    if (!loggedInBuyerSellerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "BUYER_WALLET_MISSING",
          message: "Buyer wallet is not set up for this account.",
        },
        { status: 409 }
      );
    }

    if (buyerSellerId !== loggedInBuyerSellerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "FORBIDDEN_BUYER",
          message: "buyerSellerId does not match the logged-in user.",
        },
        { status: 403 }
      );
    }

    if (!idempotencyKey) {
      return NextResponse.json(
        { ok: false, error: "Missing idempotency key" },
        { status: 400 }
      );
    }

    // Fast idempotency replay (outside tx)
    const existingByKey = await prisma.order.findUnique({ where: { idempotencyKey } });
    if (existingByKey) {
      return NextResponse.json(
        {
          ok: true,
          replay: true,
          order: {
            ...existingByKey,
            amount: centsToDollars(existingByKey.amountCents),
            adminFee: centsToDollars(existingByKey.adminFeeCents),
            total: centsToDollars(existingByKey.totalCents),
          },
        },
        { status: 200 }
      );
    }

    const now = new Date();
    const reservedUntil = new Date(now.getTime() + RESERVATION_MINUTES * 60_000);

    const result = await prisma.$transaction(async (tx) => {
      const buyer = await tx.seller.findUnique({
        where: { id: buyerSellerId },
        select: { id: true, creditBalanceCredits: true },
      });

      if (!buyer) {
        return {
          ok: false as const,
          status: 400 as const,
          body: { ok: false, error: "buyerSellerId not found", debug: { buyerSellerId } },
        };
      }

      const ticket = await tx.ticket.findUnique({
        where: { id: ticketId },
        include: { event: true },
      });

      if (!ticket) {
        return {
          ok: false as const,
          status: 404 as const,
          body: { ok: false, error: "Ticket not found", debug: { ticketId } },
        };
      }

      if (buyerSellerId === ticket.sellerId) {
        return {
          ok: false as const,
          status: 400 as const,
          body: { ok: false, error: "You cannot buy your own ticket" },
        };
      }

      const soldOutEvent = ticket.event?.selloutStatus === "SOLD_OUT";

      if (soldOutEvent && (buyer.creditBalanceCredits ?? 0) < CREDIT_COST_PER_SOLDOUT_PURCHASE) {
        return {
          ok: false as const,
          status: 400 as const,
          body: { ok: false, error: "Insufficient credits to reserve sold-out event ticket" },
        };
      }

      const adminFeeCents = Math.round((ticket.priceCents * ADMIN_FEE_BPS) / BPS_DENOMINATOR);
      const totalCents = ticket.priceCents + adminFeeCents;

      // Because Order.ticketId is UNIQUE, a ticket can only ever have one Order row.
      // If an order exists and is CANCELLED, we reuse it (set back to PENDING).
      const existingOrderForTicket = await tx.order.findUnique({
        where: { ticketId: ticket.id },
      });

      // Decide which orderId we will use for reservation
      let orderIdToUse: string;

      if (!existingOrderForTicket) {
        orderIdToUse = crypto.randomUUID();
      } else {
        if (existingOrderForTicket.status !== OrderStatus.CANCELLED) {
          return {
            ok: false as const,
            status: 409 as const,
            body: {
              ok: false,
              error: "Ticket already has an order and cannot be reserved again",
              debug: {
                ticketId: ticket.id,
                orderId: existingOrderForTicket.id,
                status: existingOrderForTicket.status,
              },
            },
          };
        }
        orderIdToUse = existingOrderForTicket.id;
      }

      // Atomic reservation
      const reserved = await tx.ticket.updateMany({
        where: {
          id: ticket.id,
          status: TicketStatus.AVAILABLE,
          OR: [{ reservedUntil: null }, { reservedUntil: { lt: now } }],
        },
        data: {
          status: TicketStatus.RESERVED,
          reservedByOrderId: orderIdToUse,
          reservedUntil,
        },
      });

      if (reserved.count !== 1) {
        return {
          ok: false as const,
          status: 409 as const,
          body: {
            ok: false,
            error: "Ticket not available (already reserved/sold/withdrawn)",
            debug: { ticketId: ticket.id },
          },
        };
      }

      // Create or reuse order
      const order =
        existingOrderForTicket == null
          ? await tx.order.create({
              data: {
                id: orderIdToUse,
                ticketId: ticket.id,
                sellerId: ticket.sellerId,
                buyerSellerId,
                amountCents: ticket.priceCents,
                adminFeeCents,
                totalCents,
                status: OrderStatus.PENDING,
                idempotencyKey,
              },
            })
          : await tx.order.update({
              where: { id: orderIdToUse },
              data: {
                buyerSellerId,
                amountCents: ticket.priceCents,
                adminFeeCents,
                totalCents,
                status: OrderStatus.PENDING,
                idempotencyKey,
              },
            });

      const updatedTicket = await tx.ticket.findUnique({ where: { id: ticket.id } });

      return {
        ok: true as const,
        status: 201 as const,
        body: {
          ok: true,
          order: {
            ...order,
            amount: centsToDollars(order.amountCents),
            adminFee: centsToDollars(order.adminFeeCents),
            total: centsToDollars(order.totalCents),
          },
          ticket: updatedTicket,
          soldOutEvent,
          reservation: { reservedUntil, minutes: RESERVATION_MINUTES },
        },
      };
    });

    if ((result as any)?.ok === false) {
      return NextResponse.json((result as any).body, { status: (result as any).status });
    }
    return NextResponse.json((result as any).body, { status: (result as any).status ?? 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";

    // Better P2002 handling: try idempotency replay; otherwise return a clear 409.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const key = getIdempotencyKey(req);
      if (key) {
        const existing = await prisma.order.findUnique({ where: { idempotencyKey: key } });
        if (existing) {
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
      }
      return NextResponse.json(
        {
          ok: false,
          error:
            "Conflict: unique constraint (ticket already has an order, or idempotency key reused)",
          details: message,
        },
        { status: 409 }
      );
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json(
        { ok: false, error: "Purchase failed (Prisma)", code: err.code, details: message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { ok: false, error: "Purchase failed", details: message },
      { status: 500 }
    );
  }
}
