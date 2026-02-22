export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrderStatus, TicketStatus } from "@prisma/client";

type Ctx = { params?: Promise<{ id?: string }> | { id?: string } };

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function parseOrderIdFromUrl(req: Request): string {
  // /api/orders/<id>/reverse
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const ordersIndex = parts.indexOf("orders");
  if (ordersIndex !== -1 && parts.length > ordersIndex + 1) {
    return normalizeId(parts[ordersIndex + 1]);
  }
  return "";
}

async function getOrderId(req: Request, ctx: Ctx): Promise<string> {
  const fromUrl = parseOrderIdFromUrl(req);
  if (fromUrl) return fromUrl;

  const p: any = ctx?.params;
  if (!p) return "";

  const resolved = typeof p?.then === "function" ? await p : p;
  return normalizeId(resolved?.id);
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const orderId = await getOrderId(req, ctx);
    const url = new URL(req.url);

    // DEV-ONLY guard (replace with real auth later)
    const adminKey = url.searchParams.get("adminKey");
    if (adminKey !== "dev") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const note = normalizeId(url.searchParams.get("note")) || "Order reversal";

    if (!orderId) {
      return NextResponse.json({ ok: false, error: "Missing order id" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { ticket: { include: { event: true } } },
      });

      if (!order) {
        return { ok: false as const, status: 404 as const, body: { ok: false, error: "Order not found" } };
      }

      if (order.status === OrderStatus.CANCELLED) {
        return {
          ok: true as const,
          status: 200 as const,
          body: { ok: true, replay: true, message: "Order already cancelled", orderId: order.id },
        };
      }

      const soldOutEvent = order.ticket?.event?.selloutStatus === "SOLD_OUT";

      // Reverse access tokens ONLY for SOLD_OUT purchases
      if (soldOutEvent) {
        // Buyer gets +1 back
        const buyer = await tx.seller.update({
          where: { id: order.buyerSellerId },
          data: { creditBalanceCredits: { increment: 1 } },
          select: { id: true, creditBalanceCredits: true },
        });

        await tx.creditTransaction.create({
          data: {
            sellerId: buyer.id,
            type: "REVERSAL",
            source: "REFUND",
            amountCredits: 1,
            balanceAfterCredits: buyer.creditBalanceCredits,
            note: `${note} (buyer access token restored)`,
            referenceType: "Order",
            referenceId: order.id,
            ticketId: order.ticketId,
            orderId: order.id,
          },
        });

        // Seller loses 1
        const seller = await tx.seller.update({
          where: { id: order.sellerId },
          data: { creditBalanceCredits: { decrement: 1 } },
          select: { id: true, creditBalanceCredits: true },
        });

        await tx.creditTransaction.create({
          data: {
            sellerId: seller.id,
            type: "REVERSAL",
            source: "REFUND",
            amountCredits: -1,
            balanceAfterCredits: seller.creditBalanceCredits,
            note: `${note} (seller access token removed)`,
            referenceType: "Order",
            referenceId: order.id,
            ticketId: order.ticketId,
            orderId: order.id,
          },
        });
      }

      // Mark order cancelled
      const cancelled = await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CANCELLED },
      });

      // Put ticket back to AVAILABLE (simple rollback)
      await tx.ticket.update({
        where: { id: order.ticketId },
        data: { status: TicketStatus.AVAILABLE, soldAt: null },
      });

      return {
        ok: true as const,
        status: 200 as const,
        body: {
          ok: true,
          reversed: true,
          order: cancelled,
          soldOutEvent,
        },
      };
    });

    if ((result as any)?.ok === false) {
      return NextResponse.json((result as any).body, { status: (result as any).status });
    }

    return NextResponse.json((result as any).body, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: "Reverse failed", details: message }, { status: 500 });
  }
}
