export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";

export async function GET(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  try {
    const user = await prisma.user.findUnique({
      where: { id: gate.user.id },
      include: { seller: true },
    });

    if (!user?.seller) {
      return NextResponse.json({ ok: true, refunds: [] }, { status: 200 });
    }

    const sellerId = user.seller.id;

    const [buyerRefundOrders, sellerRefundOrders, refundTxns] = await Promise.all([
      prisma.order.findMany({
        where: { buyerSellerId: sellerId, status: "REFUNDED" },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          status: true,
          totalCents: true,
          createdAt: true,
          items: { select: { ticketId: true, ticket: { select: { title: true } } } },
        },
      }),
      prisma.order.findMany({
        where: { sellerId, status: "REFUNDED" },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          status: true,
          totalCents: true,
          createdAt: true,
          items: { select: { ticketId: true, ticket: { select: { title: true } } } },
        },
      }),
      prisma.creditTransaction.findMany({
        where: { sellerId, source: "REFUND" },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          type: true,
          source: true,
          amountCredits: true,
          balanceAfterCredits: true,
          note: true,
          orderId: true,
          createdAt: true,
        },
      }),
    ]);

    const refunds = [
      ...buyerRefundOrders.map((o) => ({
        id: `buyer-${o.id}`,
        kind: "ORDER_REFUND_BUYER",
        orderId: o.id,
        status: o.status,
        amount: o.totalCents / 100,
        accessTokenDelta: 0,
        note: o.items[0]?.ticket?.title ? `Refunded purchase: ${o.items[0].ticket.title}` : "Refunded purchase",
        createdAt: o.createdAt.toISOString(),
      })),
      ...sellerRefundOrders.map((o) => ({
        id: `seller-${o.id}`,
        kind: "ORDER_REFUND_SELLER",
        orderId: o.id,
        status: o.status,
        amount: o.totalCents / 100,
        accessTokenDelta: 0,
        note: o.items[0]?.ticket?.title ? `Refunded sale: ${o.items[0].ticket.title}` : "Refunded sale",
        createdAt: o.createdAt.toISOString(),
      })),
      ...refundTxns.map((t) => ({
        id: `token-${t.id}`,
        kind: "ACCESS_TOKEN_REFUND",
        orderId: t.orderId,
        status: t.type,
        amount: 0,
        accessTokenDelta: t.amountCredits ?? 0,
        note: t.note ?? "Access token refund adjustment",
        createdAt: t.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, 200);

    return NextResponse.json({ ok: true, refunds }, { status: 200 });
  } catch (err: any) {
    console.error("GET /api/account/transactions/refunds error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to load refunds." },
      { status: 500 }
    );
  }
}
