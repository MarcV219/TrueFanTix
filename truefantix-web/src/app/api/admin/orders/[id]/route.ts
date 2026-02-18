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
  // /api/admin/orders/<id>
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const ordersIndex = parts.indexOf("orders");
  if (ordersIndex !== -1 && parts.length > ordersIndex + 1) {
    return normalizeId(parts[ordersIndex + 1]);
  }
  return "";
}

export async function GET(req: Request) {
  try {
    const orderId = parseOrderIdFromUrl(req);

    if (!orderId) {
      return NextResponse.json(
        { ok: false, error: "Missing order id", debug: { url: req.url } },
        { status: 400 }
      );
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        seller: true,
        buyerSeller: true,
        payment: true,
        items: {
          orderBy: { createdAt: "asc" },
          include: {
            ticket: {
              include: {
                event: true,
                seller: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    // Helpful summary so you don’t have to eyeball nested data
    const summary = {
      orderId: order.id,
      status: order.status,
      sellerId: order.sellerId,
      buyerSellerId: order.buyerSellerId,
      itemCount: order.items.length,
      ticketIds: order.items.map((i) => i.ticketId),
      tickets: order.items.map((i) => ({
        ticketId: i.ticketId,
        status: i.ticket?.status ?? null,
        reservedByOrderId: i.ticket?.reservedByOrderId ?? null,
        reservedUntil: i.ticket?.reservedUntil ?? null,
        soldAt: i.ticket?.soldAt ?? null,
        eventId: i.ticket?.eventId ?? null,
        eventSelloutStatus: i.ticket?.event?.selloutStatus ?? null,
      })),
      paymentStatus: order.payment?.status ?? null,
      amountCents: order.amountCents,
      adminFeeCents: order.adminFeeCents,
      totalCents: order.totalCents,
    };

    return NextResponse.json({ ok: true, order, summary });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: "Order lookup failed", details: message },
      { status: 500 }
    );
  }
}
