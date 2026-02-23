export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrderStatus, TicketStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth/guards";

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function parseOrderIdFromUrl(req: Request): string {
  // /api/admin/orders/<id>/deliver
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const ordersIndex = parts.indexOf("orders");
  if (ordersIndex !== -1 && parts.length > ordersIndex + 1) {
    return normalizeId(parts[ordersIndex + 1]);
  }
  return "";
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  try {
    const orderId = parseOrderIdFromUrl(req);
    if (!orderId) {
      return NextResponse.json(
        { ok: false, error: "Missing order id", debug: { url: req.url } },
        { status: 400 }
      );
    }

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      // Load order + items + tickets
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: { select: { id: true, ticketId: true } },
        },
      });

      if (!order) {
        return { ok: false as const, status: 404 as const, body: { ok: false, error: "Order not found" } };
      }

      if (order.status !== OrderStatus.PAID) {
        return {
          ok: false as const,
          status: 409 as const,
          body: {
            ok: false,
            error: "Order must be PAID before it can be DELIVERED",
            debug: { orderId, status: order.status },
          },
        };
      }

      // Ensure payment exists + succeeded (belt & suspenders)
      const payment = await tx.payment.findUnique({
        where: { orderId },
        select: { status: true, id: true },
      });

      if (!payment || payment.status !== "SUCCEEDED") {
        return {
          ok: false as const,
          status: 409 as const,
          body: {
            ok: false,
            error: "Cannot deliver: payment is not SUCCEEDED",
            debug: { orderId, payment: payment ?? null },
          },
        };
      }

      const ticketIds = order.items.map((i) => i.ticketId);

      // Validate all tickets are still reserved by THIS order and not expired
      const tickets = await tx.ticket.findMany({
        where: { id: { in: ticketIds } },
        select: { id: true, status: true, reservedByOrderId: true, reservedUntil: true },
      });

      const missing = ticketIds.filter((id) => !tickets.find((t) => t.id === id));
      if (missing.length) {
        return {
          ok: false as const,
          status: 409 as const,
          body: { ok: false, error: "Cannot deliver: missing ticket(s)", debug: { missing } },
        };
      }

      const bad = tickets.filter((t) => {
        if (t.status !== TicketStatus.RESERVED) return true;
        if (t.reservedByOrderId !== orderId) return true;
        if (t.reservedUntil && t.reservedUntil <= now) return true; // expired reservation
        return false;
      });

      if (bad.length) {
        return {
          ok: false as const,
          status: 409 as const,
          body: {
            ok: false,
            error: "Cannot deliver: ticket reservation is not valid",
            debug: { bad },
          },
        };
      }

      // Mark tickets SOLD (and clear reservation fields)
      const sold = await tx.ticket.updateMany({
        where: {
          id: { in: ticketIds },
          status: TicketStatus.RESERVED,
          reservedByOrderId: orderId,
          OR: [{ reservedUntil: null }, { reservedUntil: { gt: now } }],
        },
        data: {
          status: TicketStatus.SOLD,
          soldAt: now,
          reservedByOrderId: null,
          reservedUntil: null,
        },
      });

      if (sold.count !== ticketIds.length) {
        return {
          ok: false as const,
          status: 409 as const,
          body: {
            ok: false,
            error: "Cannot deliver: one or more tickets could not be marked SOLD",
            debug: { expected: ticketIds.length, updated: sold.count },
          },
        };
      }

      // Move order to DELIVERED
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.DELIVERED },
        include: {
          items: true,
          payment: true,
        },
      });

      return {
        ok: true as const,
        status: 200 as const,
        body: {
          ok: true,
          order: updatedOrder,
          ticketsUpdated: sold.count,
          next: "Finalize -> set Order.COMPLETED (access tokens/payout eligibility only at COMPLETED)",
        },
      };
    });

    if ((result as any).ok === false) {
      return NextResponse.json((result as any).body, { status: (result as any).status });
    }
    return NextResponse.json((result as any).body, { status: (result as any).status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: "Deliver failed", details: message }, { status: 500 });
  }
}
