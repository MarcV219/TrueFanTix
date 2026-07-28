export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { auditLog, createAuditContext } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/service";
import { DISPUTE_SUPPORT_EMAIL, parseDisputeCase, sendDisputeEmails } from "@/lib/disputes";
import { schemas, validateRequest } from "@/lib/validation";

export async function POST(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const validation = await validateRequest(schemas.orderCancelDispute)(req);
    if (!validation.success) return validation.response;

    const { orderId } = validation.data;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { ticket: true } },
        seller: { include: { user: true } },
        buyerSeller: { include: { user: true } },
      },
    });

    if (!order) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Order not found." }, { status: 404 });
    }
    if (order.buyerSellerId !== gate.user.sellerId) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN", message: "Only this order’s buyer may cancel the dispute." }, { status: 403 });
    }
    if (order.buyerConfirmationStatus !== "DISPUTED" || order.transferVerificationStatus !== "MANUAL_REVIEW") {
      return NextResponse.json({ ok: false, error: "INVALID_STATE", message: "This dispute is no longer open." }, { status: 409 });
    }

    const dispute = parseDisputeCase(order.transferVerificationReason);
    if (!dispute) {
      return NextResponse.json({ ok: false, error: "INVALID_CASE", message: "Dispute case details could not be found." }, { status: 409 });
    }
    if (dispute.openedByUserId !== gate.user.id) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN", message: "Only the user who opened this dispute may cancel it." }, { status: 403 });
    }

    const now = new Date();
    const cancellation = {
      cancelledAt: now.toISOString(),
      cancelledByUserId: gate.user.id,
      satisfactorilyResolved: true as const,
    };
    const updatedDispute = { ...dispute, cancellation };

    const updatedOrder = await prisma.$transaction(async (tx: any) => {
      await tx.ticket.updateMany({
        where: { id: { in: order.items.map((item: any) => item.ticketId) } },
        data: { status: "SOLD", soldAt: now, reservedByOrderId: null, reservedUntil: null },
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
          transferVerificationReason: JSON.stringify(updatedDispute),
        },
        select: { id: true, status: true, buyerConfirmationStatus: true, transferVerificationStatus: true },
      });
    });

    await auditLog({
      action: "DISPUTE_CANCEL",
      userId: gate.user.id,
      targetType: "Order",
      targetId: order.id,
      metadata: cancellation,
      ...createAuditContext(req),
    });

    const sellerUserId = order.seller.user?.id;
    if (sellerUserId) {
      await createNotification({
        userId: sellerUserId,
        type: "DISPUTE_OPENED",
        message: `The buyer cancelled dispute ${order.id} and confirmed it was satisfactorily resolved. Seller payout is now pending.`,
        link: "/account/tickets/seller-holding",
      });
    }

    const disputedTicketDetails = order.items
      .filter((item: any) => dispute.ticketIds?.includes(item.ticketId))
      .map((item: any) => {
        const location = [item.ticket.row ? `Row ${item.ticket.row}` : null, item.ticket.seat ? `Seat ${item.ticket.seat}` : null]
          .filter(Boolean)
          .join(", ");
        return `${item.ticket.title} — ${item.ticket.venue} — ${item.ticket.date}${location ? ` — ${location}` : ""} (ticket ${item.ticketId})`;
      });
    await sendDisputeEmails({
      orderId: order.id,
      kind: "CANCELLED",
      submittedBy: "Buyer",
      comments: "The buyer confirmed that the dispute was satisfactorily resolved.",
      ticketCount: dispute.ticketCount || dispute.ticketIds?.length || 0,
      tickets: disputedTicketDetails,
      fileNames: [],
      parties: [
        ...(order.buyerSeller.user?.email ? [{ email: order.buyerSeller.user.email, firstName: order.buyerSeller.user.firstName, role: "Buyer" as const }] : []),
        ...(order.seller.user?.email ? [{ email: order.seller.user.email, firstName: order.seller.user.firstName, role: "Seller" as const }] : []),
        { email: DISPUTE_SUPPORT_EMAIL, role: "TrueFanTix Support" },
      ],
    });

    return NextResponse.json({
      ok: true,
      order: updatedOrder,
      message: "Dispute cancelled. You confirmed that it was satisfactorily resolved.",
    });
  } catch (err) {
    console.error("POST /api/orders/dispute/cancel failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: "Could not cancel dispute." }, { status: 500 });
  }
}
