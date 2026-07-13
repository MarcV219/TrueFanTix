export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { auditLog, createAuditContext } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/service";
import { schemas, validateRequest } from "@/lib/validation";

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function parseOrderIdFromUrl(req: Request): string {
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const ordersIndex = parts.indexOf("orders");
  if (ordersIndex !== -1 && parts.length > ordersIndex + 1) {
    return normalizeId(parts[ordersIndex + 1]);
  }
  return "";
}

function appendResolutionNote(existing: string | null, resolution: Record<string, unknown>) {
  let parsed: unknown = null;
  if (existing) {
    try {
      parsed = JSON.parse(existing);
    } catch {
      parsed = { previousReason: existing };
    }
  }
  return JSON.stringify({ dispute: parsed, resolution });
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return gate.res;

    const orderId = parseOrderIdFromUrl(req);
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "MISSING_ORDER_ID", message: "Missing order id." }, { status: 400 });
    }

    const validation = await validateRequest(schemas.adminResolveDispute)(req);
    if (!validation.success) return validation.response;

    const { action, note } = validation.data;
    const now = new Date();

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { ticket: true } },
        payment: true,
        seller: { include: { user: true } },
        buyerSeller: { include: { user: true } },
      },
    });

    if (!order) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Order not found." }, { status: 404 });
    }

    if (order.buyerConfirmationStatus !== "DISPUTED") {
      return NextResponse.json(
        { ok: false, error: "INVALID_STATE", message: "Order is not currently disputed." },
        { status: 409 }
      );
    }

    const resolution = {
      type: "ADMIN_DISPUTE_RESOLUTION",
      action,
      note,
      resolvedAt: now.toISOString(),
      resolvedByUserId: gate.user.id,
    };

    let updatedOrder;

    if (action === "RELEASE_PAYOUT") {
      updatedOrder = await prisma.$transaction(async (tx: any) => {
        const ticketIds = order.items.map((item: any) => item.ticketId);

        await tx.ticket.updateMany({
          where: { id: { in: ticketIds } },
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
          where: { id: order.id },
          data: {
            status: "COMPLETED",
            buyerConfirmationStatus: "CONFIRMED",
            buyerConfirmationAt: now,
            transferVerificationStatus: "MATCHED",
            transferVerificationReason: appendResolutionNote(order.transferVerificationReason, resolution),
          },
          select: { id: true, status: true, buyerConfirmationStatus: true, transferVerificationStatus: true },
        });
      });
    } else {
      updatedOrder = await prisma.order.update({
        where: { id: order.id },
        data: {
          buyerConfirmationStatus: "DISPUTED",
          transferVerificationStatus: action === "MARK_REFUND_REQUIRED" ? "REFUND_REQUIRED" : "MANUAL_REVIEW",
          transferVerificationReason: appendResolutionNote(order.transferVerificationReason, resolution),
        },
        select: { id: true, status: true, buyerConfirmationStatus: true, transferVerificationStatus: true },
      });
    }

    const auditContext = createAuditContext(req);
    await auditLog({
      action: "DISPUTE_RESOLVE",
      userId: gate.user.id,
      targetType: "Order",
      targetId: order.id,
      metadata: resolution,
      ...auditContext,
    });

    const message =
      action === "RELEASE_PAYOUT"
        ? `Admin resolved dispute for order ${order.id}: seller payout released to pending payout queue.`
        : action === "MARK_REFUND_REQUIRED"
          ? `Admin resolved dispute for order ${order.id}: refund required. Payout remains paused.`
          : `Admin reviewed dispute for order ${order.id}: more review is required. Payout remains paused.`;

    await Promise.all(
      [order.seller.user?.id, order.buyerSeller.user?.id]
        .filter((userId): userId is string => Boolean(userId))
        .map((userId) =>
          createNotification({
            userId,
            type: "DISPUTE_OPENED",
            message,
            link: userId === order.seller.user?.id ? "/account/tickets/seller-holding" : "/account/tickets/holding",
          })
        )
    );

    return NextResponse.json({ ok: true, order: updatedOrder, message }, { status: 200 });
  } catch (err) {
    console.error("POST /api/admin/orders/[id]/resolve-dispute failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not resolve dispute." },
      { status: 500 }
    );
  }
}
