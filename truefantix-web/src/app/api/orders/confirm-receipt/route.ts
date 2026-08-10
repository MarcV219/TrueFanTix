export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";
import { notifySellerBuyerConfirmed } from "@/lib/orders/transferWorkflow";
import { sendAdminActivityEmail } from "@/lib/adminActivityEmail";

// POST /api/orders/confirm-receipt
// Allows a buyer to confirm receipt of tickets for a specific order.
export async function POST(req: Request) {
  try {
    const gate = await requireUser(req); // Ensure user is logged in
    if (!gate.ok) return gate.res;

    const validation = await validateRequest(schemas.orderConfirmReceipt)(req);
    if (!validation.success) return validation.response;

    const { orderId } = validation.data;

    // Find the order and verify the logged-in user is the buyer
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerSellerId: true,
        status: true,
        transferVerificationStatus: true,
        buyerConfirmationStatus: true,
        seller: { include: { user: true } },
        items: { select: { ticketId: true } },
        amountCents: true,
        sellerId: true,
      },
    });

    if (!order) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", message: "Order not found." },
        { status: 404 }
      );
    }

    if (order.buyerSellerId !== gate.user.sellerId) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "User is not the buyer for this order." },
        { status: 403 }
      );
    }

    // Only allow confirmation if order is PAID and transfer proof has been submitted by seller
    if (order.status !== "PAID" || order.transferVerificationStatus !== "PENDING") {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_STATE",
          message: "Order is not in a valid state for receipt confirmation.",
        },
        { status: 409 }
      );
    }

    // Update the order to confirmed status and record confirmation time
    const now = new Date();
    const updatedOrder = await prisma.$transaction(async (tx: any) => {
      await tx.ticket.updateMany({
        where: { id: { in: order.items.map((item) => item.ticketId) } },
        data: {
          status: "SOLD",
          soldAt: now,
          reservedByOrderId: null,
          reservedUntil: null,
        },
      });

      await tx.sellerMetrics.upsert({
        where: { sellerId: order.sellerId },
        create: {
          sellerId: order.sellerId,
          lifetimeSalesCents: order.amountCents,
          lifetimeOrders: 1,
          lifetimeTicketsSold: order.items.length,
        },
        update: {
          lifetimeSalesCents: { increment: order.amountCents },
          lifetimeOrders: { increment: 1 },
          lifetimeTicketsSold: { increment: order.items.length },
        },
      });

      const providerRef = `order:${order.id}`;
      const existingPayout = await tx.payout.findFirst({
        where: { sellerId: order.sellerId, provider: "ESCROW_INTERNAL", providerRef },
        select: { id: true },
      });

      if (!existingPayout) {
        await tx.payout.create({
          data: {
            sellerId: order.sellerId,
            amountCents: order.amountCents,
            feeCents: 0,
            netCents: order.amountCents,
            status: "PENDING",
            provider: "ESCROW_INTERNAL",
            providerRef,
          },
        });
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          buyerConfirmationStatus: "CONFIRMED",
          buyerConfirmationAt: now,
          status: "COMPLETED",
        },
        select: {
          id: true,
          status: true,
          buyerConfirmationStatus: true,
          buyerConfirmationAt: true,
        },
      });
    });

    // Buyer confirmation moves the payment hold into the pending payout queue.
    if (order.seller.user?.id) {
      await notifySellerBuyerConfirmed({
        sellerUserId: order.seller.user.id,
        orderId,
        ticketCount: order.items.length,
      });
    }
    await sendAdminActivityEmail({
      activity: "TRANSFER_CONFIRMED",
      summary: `Buyer confirmed ticket transfer — order ${orderId}`,
      details: {
        "Order ID": orderId,
        Seller: order.seller.user?.email,
        "Ticket count": order.items.length,
        "Order amount": `CAD ${(order.amountCents / 100).toFixed(2)}`,
        "Confirmed at": now.toISOString(),
      },
    });

    return NextResponse.json(
      {
        ok: true,
        order: updatedOrder,
        message: "Ticket receipt confirmed. Seller payout is now eligible for completion.",
      },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_AUTHENTICATED") {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." },
        { status: 401 }
      );
    }
    console.error("POST /api/orders/confirm-receipt failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not confirm receipt." },
      { status: 500 }
    );
  }
}
