export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { auditLog, createAuditContext } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/service";
import { DISPUTE_SUPPORT_EMAIL, parseDisputeCase, sendDisputeEmails } from "@/lib/disputes";
import { canBuyerCancelDispute } from "@/lib/dispute-case";
import {
  ManagedAccountOrderOperationError,
  OrderOperationAccessChangedError,
  runOrdinaryOrderOperation,
} from "@/lib/orders/ordinary-user";
import { schemas, validateRequest } from "@/lib/validation";
import { awardLaunchSale } from "@/lib/launchPromotion";

export async function POST(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const validation = await validateRequest(schemas.orderCancelDispute)(req);
    if (!validation.success) return validation.response;

    const { orderId } = validation.data;

    const result = await runOrdinaryOrderOperation(gate.user.id, async (tx, current) => {
      // Serialize buyer cancellation with evidence submission and administrator
      // resolution. The locked snapshot is authoritative for case closure.
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({
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
      if (order.buyerSellerId !== current.sellerId) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN", message: "Only this order’s buyer may cancel the dispute." }, { status: 403 });
      }
      if (!canBuyerCancelDispute(order.buyerConfirmationStatus, order.transferVerificationStatus)) {
        return NextResponse.json({ ok: false, error: "INVALID_STATE", message: "This dispute is no longer open." }, { status: 409 });
      }

      const dispute = parseDisputeCase(order.transferVerificationReason);
      if (!dispute) {
        return NextResponse.json({ ok: false, error: "INVALID_CASE", message: "Dispute case details could not be found." }, { status: 409 });
      }
      if (dispute.openedByUserId !== current.id) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN", message: "Only the user who opened this dispute may cancel it." }, { status: 403 });
      }

      const now = new Date();
      const cancellation = {
        cancelledAt: now.toISOString(),
        cancelledByUserId: current.id,
        satisfactorilyResolved: true as const,
      };
      const updatedDispute = { ...dispute, cancellation };

      await tx.ticket.updateMany({
        where: { id: { in: order.items.map((item) => item.ticketId) } },
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
      const completedOrder = await tx.order.update({
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
      await awardLaunchSale(tx, { orderId: order.id, sellerId: order.sellerId, ticketCount: order.items.length, occurredAt: now });

      const sellerUserId = order.seller.user?.id;
      const disputedTicketDetails = order.items
        .filter((item) => dispute.ticketIds?.includes(item.ticketId))
        .map((item) => {
          const location = [item.ticket.row ? `Row ${item.ticket.row}` : null, item.ticket.seat ? `Seat ${item.ticket.seat}` : null]
            .filter(Boolean)
            .join(", ");
          return `${item.ticket.title} — ${item.ticket.venue} — ${item.ticket.date}${location ? ` — ${location}` : ""} (ticket ${item.ticketId})`;
        });
      await auditLog({
        action: "DISPUTE_CANCEL",
        userId: current.id,
        targetType: "Order",
        targetId: order.id,
        metadata: cancellation,
        ...createAuditContext(req),
      }, tx);
      if (sellerUserId) {
        await createNotification({
          userId: sellerUserId,
          type: "DISPUTE_OPENED",
          message: `The buyer cancelled dispute ${order.id} and confirmed it was satisfactorily resolved. Seller payout is now pending.`,
          link: "/account/tickets/seller-holding",
        }, tx);
      }
      return {
        response: NextResponse.json({
          ok: true,
          order: completedOrder,
          message: "Dispute cancelled. You confirmed that it was satisfactorily resolved.",
        }),
        postCommitEmail: {
          orderId: order.id,
          kind: "CANCELLED" as const,
          submittedBy: "Buyer",
          comments: "The buyer confirmed that the dispute was satisfactorily resolved.",
          ticketCount: dispute.ticketCount || dispute.ticketIds?.length || 0,
          tickets: disputedTicketDetails,
          fileNames: [],
          parties: [
            ...(order.buyerSeller.user?.email ? [{ email: order.buyerSeller.user.email, firstName: order.buyerSeller.user.firstName, role: "Buyer" as const }] : []),
            ...(order.seller.user?.email ? [{ email: order.seller.user.email, firstName: order.seller.user.firstName, role: "Seller" as const }] : []),
            { email: DISPUTE_SUPPORT_EMAIL, role: "TrueFanTix Support" as const },
          ],
          idempotencyKeyPrefix: `dispute-cancelled:${order.id}`,
        },
      };
    });

    if (result instanceof NextResponse) return result;

    try {
      await sendDisputeEmails(result.postCommitEmail);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown dispute email error";
      console.error(
        "[EMAIL] Dispute-cancelled notifications failed after commit:",
        `EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: ${message}`,
      );
    }
    return result.response;
  } catch (err) {
    if (err instanceof ManagedAccountOrderOperationError) {
      return NextResponse.json(
        {
          ok: false,
          error: "STAGING_CONSOLE_ONLY",
          message: "This managed account is restricted to the staging console.",
        },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    if (err instanceof OrderOperationAccessChangedError) {
      const [status, message] = err.code === "NOT_AUTHENTICATED"
        ? [401, "Please log in."]
        : [403, "This account is restricted."];
      return NextResponse.json({ ok: false, error: err.code, message }, { status });
    }

    console.error("POST /api/orders/dispute/cancel failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: "Could not cancel dispute." }, { status: 500 });
  }
}
