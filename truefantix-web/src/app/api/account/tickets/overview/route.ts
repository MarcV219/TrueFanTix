export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { withdrawExpiredAvailableTickets } from "@/lib/tickets/expireListings";

function parseEventDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isFutureEvent(value: string | null | undefined, now: Date) {
  const parsed = parseEventDate(value);
  return parsed ? parsed.getTime() > now.getTime() : false;
}

export async function GET(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  try {
    const now = new Date();
    const user = await prisma.user.findUnique({
      where: { id: gate.user.id },
      include: { seller: true },
    });

    if (!user?.seller) {
      return NextResponse.json({
        ok: true,
        tickets: {
          pendingCheckout: { count: 0, orderId: null },
          holding: { count: 0, actionRequired: 0 },
          selling: { count: 0 },
          sellerHolding: { count: 0, actionRequired: 0 },
          bought: { count: 0, activeUpcoming: 0 },
          sold: { count: 0 },
        },
      });
    }

    await withdrawExpiredAvailableTickets(now);

    const [buyerOrders, pendingCheckoutOrders, sellerHoldingOrders, activeSellingCount, soldCompletedCount] = await Promise.all([
      prisma.order.findMany({
        where: {
          buyerSellerId: user.seller.id,
          status: { in: ["PAID", "DELIVERED", "COMPLETED"] },
        },
        select: {
          status: true,
          transferVerificationStatus: true,
          buyerConfirmationStatus: true,
          items: {
            select: {
              ticket: {
                select: {
                  date: true,
                  event: { select: { date: true } },
                },
              },
            },
          },
        },
      }),
      prisma.order.findMany({
        where: {
          buyerSellerId: user.seller.id,
          status: "PENDING",
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          items: { select: { id: true } },
        },
      }),
      prisma.order.findMany({
        where: {
          sellerId: user.seller.id,
          status: { in: ["PAID", "DELIVERED"] },
        },
        select: {
          status: true,
          transferProofType: true,
          buyerConfirmationStatus: true,
        },
      }),
      prisma.ticket.count({
        where: {
          sellerId: user.seller.id,
          status: "AVAILABLE",
        },
      }),
      prisma.order.count({
        where: {
          sellerId: user.seller.id,
          status: "COMPLETED",
        },
      }),
    ]);

    const holdingOrders = buyerOrders.filter((order) => order.status === "PAID" || order.status === "DELIVERED");
    const completedBuyerOrders = buyerOrders.filter((order) => order.status === "COMPLETED");
    const holdingTicketCount = holdingOrders.reduce((total, order) => total + order.items.length, 0);
    const completedBuyerTicketCount = completedBuyerOrders.reduce((total, order) => total + order.items.length, 0);
    const pendingCheckoutTicketCount = pendingCheckoutOrders.reduce((total, order) => total + order.items.length, 0);

    const holdingActionRequired = holdingOrders.filter(
      (order) =>
        order.status === "PAID" &&
        order.transferVerificationStatus === "PENDING" &&
        order.buyerConfirmationStatus === "PENDING"
    ).reduce((total, order) => total + order.items.length, 0);

    const activeUpcomingBought = completedBuyerOrders.reduce(
      (total, order) =>
        total +
        order.items.filter((item) => isFutureEvent(item.ticket.date || item.ticket.event?.date, now)).length,
      0
    );

    const sellerActionRequired = sellerHoldingOrders.filter((order) => !order.transferProofType).length;

    return NextResponse.json({
      ok: true,
      tickets: {
        pendingCheckout: {
          count: pendingCheckoutTicketCount,
          orderId: pendingCheckoutOrders[0]?.id ?? null,
        },
        holding: {
          count: holdingTicketCount,
          actionRequired: holdingActionRequired,
        },
        selling: {
          count: activeSellingCount,
        },
        sellerHolding: {
          count: sellerHoldingOrders.length,
          actionRequired: sellerActionRequired,
        },
        bought: {
          count: completedBuyerTicketCount,
          activeUpcoming: activeUpcomingBought,
        },
        sold: {
          count: soldCompletedCount,
        },
      },
    });
  } catch (err) {
    console.error("GET /api/account/tickets/overview error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to load account ticket overview." },
      { status: 500 }
    );
  }
}
