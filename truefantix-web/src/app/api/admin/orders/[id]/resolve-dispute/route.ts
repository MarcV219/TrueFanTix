export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { auditLog, createAuditContext } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/service";
import { DISPUTE_SUPPORT_EMAIL, parseDisputeCase, sendDisputeEmails } from "@/lib/disputes";
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

async function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY in environment.");
  const mod: any = await import("stripe");
  const StripeCtor = mod?.default ?? mod;
  return new StripeCtor(key, { apiVersion: "2024-06-20" });
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
    let refundId: string | null = null;

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
    } else if (action === "MARK_REFUND_REQUIRED") {
      if (!order.payment || order.payment.status !== "SUCCEEDED") {
        return NextResponse.json(
          {
            ok: false,
            error: "PAYMENT_NOT_REFUNDABLE",
            message: order.payment?.status === "REFUNDED"
              ? "This payment has already been refunded."
              : "The payment is not in a refundable state.",
          },
          { status: 409 }
        );
      }
      if (order.payment.provider !== "STRIPE" || !order.payment.providerRef) {
        return NextResponse.json(
          { ok: false, error: "PAYMENT_NOT_REFUNDABLE", message: "This payment cannot be refunded automatically." },
          { status: 409 }
        );
      }

      const stripe = await getStripe();
      const refund = await stripe.refunds.create(
        {
          payment_intent: order.payment.providerRef,
          reason: "requested_by_customer",
          metadata: {
            orderId: order.id,
            disputeResolution: "REFUND_REQUIRED",
            resolvedByUserId: gate.user.id,
          },
        },
        { idempotencyKey: `dispute-refund:${order.id}` }
      );
      if (refund.status === "failed" || refund.status === "canceled") {
        throw new Error(`Stripe did not accept the refund (${refund.status}).`);
      }
      refundId = refund.id;

      updatedOrder = await prisma.$transaction(async (tx: any) => {
        const ticketIds = order.items.map((item: any) => item.ticketId);

        await tx.payment.update({
          where: { orderId: order.id },
          data: { status: "REFUNDED" },
        });
        await tx.payout.updateMany({
          where: {
            sellerId: order.sellerId,
            providerRef: `order:${order.id}`,
            status: "PENDING",
          },
          data: { status: "CANCELED" },
        });
        await tx.ticket.updateMany({
          where: { id: { in: ticketIds } },
          data: {
            status: "WITHDRAWN",
            reservedByOrderId: null,
            reservedUntil: null,
          },
        });
        await tx.ticketEscrow.updateMany({
          where: { orderId: order.id },
          data: {
            state: "RELEASED_BACK_TO_SELLER",
            releasedTo: order.sellerId,
            releasedAt: now,
            failureReason: null,
          },
        });

        return tx.order.update({
          where: { id: order.id },
          data: {
            status: "REFUNDED",
            buyerConfirmationStatus: "REFUNDED",
            buyerConfirmationAt: now,
            transferVerificationStatus: "REFUNDED",
            transferVerificationReason: appendResolutionNote(order.transferVerificationReason, {
              ...resolution,
              stripeRefundId: refund.id,
              stripeRefundStatus: refund.status,
            }),
          },
          select: { id: true, status: true, buyerConfirmationStatus: true, transferVerificationStatus: true },
        });
      });
    } else {
      updatedOrder = await prisma.order.update({
        where: { id: order.id },
        data: {
          buyerConfirmationStatus: "DISPUTED",
          transferVerificationStatus: "MANUAL_REVIEW",
          transferVerificationReason: appendResolutionNote(order.transferVerificationReason, resolution),
        },
        select: { id: true, status: true, buyerConfirmationStatus: true, transferVerificationStatus: true },
      });
    }

    const message =
      action === "RELEASE_PAYOUT"
        ? `Admin resolved dispute for order ${order.id}: seller payout released to pending payout queue.`
        : action === "MARK_REFUND_REQUIRED"
          ? `Admin refunded the buyer and closed dispute for order ${order.id}.`
          : `Admin reviewed dispute for order ${order.id}: more review is required. Payout remains paused.`;

    const dispute = parseDisputeCase(order.transferVerificationReason);
    const disputedTicketDetails = order.items
      .filter((item: any) => !dispute?.ticketIds?.length || dispute.ticketIds.includes(item.ticketId))
      .map((item: any) => {
        const location = [item.ticket.row ? `Row ${item.ticket.row}` : null, item.ticket.seat ? `Seat ${item.ticket.seat}` : null]
          .filter(Boolean)
          .join(", ");
        return `${item.ticket.title} — ${item.ticket.venue} — ${item.ticket.date}${location ? ` — ${location}` : ""} (ticket ${item.ticketId})`;
      });
    const followUps: Promise<unknown>[] = [
      auditLog({
        action: "DISPUTE_RESOLVE",
        userId: gate.user.id,
        targetType: "Order",
        targetId: order.id,
        metadata: resolution,
        ...createAuditContext(req),
      }),
      ...[order.seller.user?.id, order.buyerSeller.user?.id]
        .filter((userId): userId is string => Boolean(userId))
        .map((userId) =>
          createNotification({
            userId,
            type: "DISPUTE_OPENED",
            message,
            link: userId === order.seller.user?.id ? "/account/tickets/seller-holding" : "/account/tickets/holding",
          })
        ),
    ];
    if (action === "RELEASE_PAYOUT" || action === "MARK_REFUND_REQUIRED") {
      followUps.push(
        sendDisputeEmails({
          orderId: order.id,
          kind: action === "MARK_REFUND_REQUIRED" ? "REFUNDED" : "RESOLVED",
          submittedBy: "TrueFanTix Support",
          comments: action === "MARK_REFUND_REQUIRED" && refundId
            ? `${note}\nStripe refund reference: ${refundId}`
            : note,
          ticketCount: dispute?.ticketCount || dispute?.ticketIds?.length || order.items.length,
          tickets: disputedTicketDetails,
          fileNames: [],
          parties: [
            ...(order.buyerSeller.user?.email ? [{ email: order.buyerSeller.user.email, firstName: order.buyerSeller.user.firstName, role: "Buyer" as const }] : []),
            ...(order.seller.user?.email ? [{ email: order.seller.user.email, firstName: order.seller.user.firstName, role: "Seller" as const }] : []),
            { email: DISPUTE_SUPPORT_EMAIL, role: "TrueFanTix Support" },
          ],
        })
      );
    }
    const followUpResults = await Promise.allSettled(followUps);
    followUpResults.forEach((result, index) => {
      if (result.status === "rejected") {
        console.error(`Dispute resolution follow-up ${index + 1} failed for order ${order.id}:`, result.reason);
      }
    });

    return NextResponse.json({ ok: true, order: updatedOrder, message }, { status: 200 });
  } catch (err) {
    console.error("POST /api/admin/orders/[id]/resolve-dispute failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not resolve dispute." },
      { status: 500 }
    );
  }
}
