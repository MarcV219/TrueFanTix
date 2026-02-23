export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function parseOrderIdFromUrl(req: Request): string {
  // /api/admin/orders/<id>/capture
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const ordersIndex = parts.indexOf("orders");
  if (ordersIndex !== -1 && parts.length > ordersIndex + 1) {
    return normalizeId(parts[ordersIndex + 1]);
  }
  return "";
}

/**
 * POST /api/admin/orders/<ORDER_ID>/capture
 * MVP manual capture:
 * - Validates reservation is still active for all items
 * - Creates/updates Payment(SUCCEEDED)
 * - Sets Order -> PAID
 */
export async function POST(req: Request) {
  try {
    const orderId = parseOrderIdFromUrl(req);
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "Missing order id" }, { status: 400 });
    }

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: { select: { id: true, ticketId: true } } },
      });

      if (!order) {
        return { ok: false as const, status: 404 as const, body: { ok: false, error: "Order not found" } };
      }

      if (order.status !== 'PENDING') {
        return {
          ok: false as const,
          status: 400 as const,
          body: { ok: false, error: "Order is not PENDING", debug: { status: order.status } },
        };
      }

      if (order.items.length === 0) {
        return { ok: false as const, status: 400 as const, body: { ok: false, error: "Order has no items" } };
      }

      // Validate all tickets are still reserved by this order and not expired
      const ticketIds = order.items.map((i) => i.ticketId);

      const tickets = await tx.ticket.findMany({
        where: { id: { in: ticketIds } },
        select: { id: true, status: true, reservedByOrderId: true, reservedUntil: true, sellerId: true },
      });

      const byId = new Map(tickets.map((t) => [t.id, t]));

      for (const tid of ticketIds) {
        const t = byId.get(tid);
        if (!t) {
          return { ok: false as const, status: 400 as const, body: { ok: false, error: `Missing ticket: ${tid}` } };
        }
        if (t.status !== 'RESERVED') {
          return {
            ok: false as const,
            status: 409 as const,
            body: { ok: false, error: `Ticket not RESERVED: ${tid}`, debug: { status: t.status } },
          };
        }
        if (t.reservedByOrderId !== orderId) {
          return {
            ok: false as const,
            status: 409 as const,
            body: { ok: false, error: `Ticket reserved by different order: ${tid}`, debug: { reservedByOrderId: t.reservedByOrderId } },
          };
        }
        if (!t.reservedUntil || t.reservedUntil <= now) {
          return {
            ok: false as const,
            status: 409 as const,
            body: { ok: false, error: `Reservation expired for ticket: ${tid}`, debug: { reservedUntil: t.reservedUntil } },
          };
        }
      }

      // Create or update payment record as "captured"
      // (provider/providerRef are placeholders for MVP)
      const payment = await tx.payment.upsert({
        where: { orderId },
        create: {
          orderId,
          amountCents: order.totalCents,
          currency: "CAD",
          status: 'SUCCEEDED',
          provider: "MANUAL",
          providerRef: `manual_${orderId}`,
        },
        update: {
          amountCents: order.totalCents,
          status: 'SUCCEEDED',
          provider: "MANUAL",
          providerRef: `manual_${orderId}`,
        },
      });

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: { status: 'PAID' },
        include: { items: true, payment: true },
      });

      return {
        ok: true as const,
        status: 200 as const,
        body: { ok: true, order: updatedOrder, payment },
      };
    });

    if (!result.ok) return NextResponse.json(result.body, { status: result.status });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: "Capture failed", details: message }, { status: 500 });
  }
}
