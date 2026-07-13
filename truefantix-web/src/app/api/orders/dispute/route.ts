export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { auditLog, createAuditContext } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/service";
import { schemas, validateRequest } from "@/lib/validation";

export async function POST(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const validation = await validateRequest(schemas.orderOpenDispute)(req);
    if (!validation.success) return validation.response;

    const { orderId, reason, evidence } = validation.data;
    const now = new Date();

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerSellerId: true,
        sellerId: true,
        status: true,
        transferVerificationStatus: true,
        buyerConfirmationStatus: true,
        disputeWindowEndsAt: true,
        seller: { select: { user: { select: { id: true } } } },
        buyerSeller: { select: { user: { select: { id: true } } } },
        items: { select: { id: true } },
      },
    });

    if (!order) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Order not found." }, { status: 404 });
    }

    if (order.buyerSellerId !== gate.user.sellerId) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "User is not the buyer for this order." },
        { status: 403 }
      );
    }

    if (
      order.status !== "PAID" ||
      order.transferVerificationStatus !== "PENDING" ||
      order.buyerConfirmationStatus !== "PENDING" ||
      !order.disputeWindowEndsAt
    ) {
      return NextResponse.json(
        { ok: false, error: "INVALID_STATE", message: "This order is not in a valid state for a dispute." },
        { status: 409 }
      );
    }

    if (order.disputeWindowEndsAt.getTime() < now.getTime()) {
      return NextResponse.json(
        { ok: false, error: "WINDOW_CLOSED", message: "The buyer confirmation window has already ended." },
        { status: 409 }
      );
    }

    const disputeRecord = {
      type: "BUYER_DISPUTE",
      openedAt: now.toISOString(),
      openedByUserId: gate.user.id,
      reason,
      evidence: evidence || null,
    };

    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: {
        buyerConfirmationStatus: "DISPUTED",
        transferVerificationStatus: "MANUAL_REVIEW",
        transferVerificationReason: JSON.stringify(disputeRecord),
      },
      select: {
        id: true,
        status: true,
        buyerConfirmationStatus: true,
        transferVerificationStatus: true,
        transferVerificationReason: true,
      },
    });

    const auditContext = createAuditContext(req);
    await auditLog({
      action: "DISPUTE_OPEN",
      userId: gate.user.id,
      targetType: "Order",
      targetId: order.id,
      metadata: disputeRecord,
      ...auditContext,
    });

    if (order.seller.user?.id) {
      await createNotification({
        userId: order.seller.user.id,
        type: "DISPUTE_OPENED",
        message: `A buyer opened a dispute for order ${order.id}. Seller payout is paused while admin reviews it.`,
        link: `/account/tickets/seller-holding`,
      });
    }

    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", isBanned: false },
      select: { id: true },
      take: 25,
    });

    await Promise.all(
      admins.map((admin) =>
        createNotification({
          userId: admin.id,
          type: "DISPUTE_OPENED",
          message: `Buyer dispute opened for order ${order.id}.`,
          link: `/admin/orders/${encodeURIComponent(order.id)}`,
        })
      )
    );

    return NextResponse.json(
      { ok: true, order: updatedOrder, message: "Dispute opened. Seller payout is paused for admin review." },
      { status: 200 }
    );
  } catch (err) {
    console.error("POST /api/orders/dispute failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not open dispute." },
      { status: 500 }
    );
  }
}
