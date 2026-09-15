export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { auditLog, createAuditContext } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/service";
import { DISPUTE_SUPPORT_EMAIL, sendDisputeEmails } from "@/lib/disputes";
import {
  ManagedAccountOrderOperationError,
  OrderOperationAccessChangedError,
  runOrdinaryOrderOperation,
} from "@/lib/orders/ordinary-user";
import { schemas, validateRequest } from "@/lib/validation";

export async function POST(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const validation = await validateRequest(schemas.orderOpenDispute)(req);
    if (!validation.success) return validation.response;

    const { orderId, ticketIds, reason, evidence, evidenceFiles } = validation.data;

    const result = await runOrdinaryOrderOperation(gate.user.id, async (tx, current) => {
      // Serialize competing buyer/admin transitions for this order. Every
      // participant must re-read the current dispute state after this lock.
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          buyerSellerId: true,
          sellerId: true,
          status: true,
          transferVerificationStatus: true,
          buyerConfirmationStatus: true,
          disputeWindowEndsAt: true,
          seller: { select: { user: { select: { id: true, email: true, firstName: true } } } },
          buyerSeller: { select: { user: { select: { id: true, email: true, firstName: true } } } },
          items: {
            select: {
              ticketId: true,
              ticket: { select: { title: true, venue: true, date: true, row: true, seat: true } },
            },
          },
        },
      });

      if (!order) {
        return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Order not found." }, { status: 404 });
      }

      if (order.buyerSellerId !== current.sellerId) {
        return NextResponse.json(
          { ok: false, error: "FORBIDDEN", message: "User is not the buyer for this order." },
          { status: 403 }
        );
      }

      const now = new Date();
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

      const orderTicketIds = new Set(order.items.map((item) => item.ticketId));
      if (ticketIds.some((ticketId) => !orderTicketIds.has(ticketId))) {
        return NextResponse.json(
          {
            ok: false,
            error: "INVALID_TICKET_SELECTION",
            message: "Every disputed ticket must belong to this purchase.",
          },
          { status: 400 }
        );
      }

      const disputeRecord = {
        type: "BUYER_DISPUTE",
        openedAt: now.toISOString(),
        openedByUserId: current.id,
        ticketIds,
        ticketCount: ticketIds.length,
        reason,
        evidence: evidence || null,
        evidenceFiles,
      };

      const updatedOrder = await tx.order.update({
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
        userId: current.id,
        targetType: "Order",
        targetId: order.id,
        metadata: disputeRecord,
        ...auditContext,
      }, tx);

      if (order.seller.user?.id) {
        await createNotification({
          userId: order.seller.user.id,
          type: "DISPUTE_OPENED",
          message: `A buyer opened a dispute for ${ticketIds.length} ticket${ticketIds.length === 1 ? "" : "s"} in order ${order.id}. Seller payout is paused while admin reviews it.`,
          link: `/account/tickets/seller-holding`,
        }, tx);
      }

      const admins = await tx.user.findMany({
        where: { role: "ADMIN", isBanned: false },
        select: { id: true },
        take: 25,
      });

      await Promise.all(
        admins.map((admin) =>
          createNotification({
            userId: admin.id,
            type: "DISPUTE_OPENED",
            message: `Buyer dispute opened for ${ticketIds.length} ticket${ticketIds.length === 1 ? "" : "s"} in order ${order.id}.`,
            link: `/admin/orders/${encodeURIComponent(order.id)}`,
          }, tx)
        )
      );

      const buyer = order.buyerSeller.user;
      const seller = order.seller.user;
      const disputedTicketDetails = order.items
        .filter((item) => ticketIds.includes(item.ticketId))
        .map((item) => {
          const location = [item.ticket.row ? `Row ${item.ticket.row}` : null, item.ticket.seat ? `Seat ${item.ticket.seat}` : null]
            .filter(Boolean)
            .join(", ");
          return `${item.ticket.title} — ${item.ticket.venue} — ${item.ticket.date}${location ? ` — ${location}` : ""} (ticket ${item.ticketId})`;
        });
      return {
        response: NextResponse.json(
          { ok: true, order: updatedOrder, message: "Dispute opened. Seller payout is paused for admin review." },
          { status: 200 }
        ),
        postCommitEmail: {
          orderId: order.id,
          kind: "OPENED" as const,
          submittedBy: "Buyer",
          comments: reason,
          ticketCount: ticketIds.length,
          tickets: disputedTicketDetails,
          fileNames: evidenceFiles.map((file) => file.fileName),
          parties: [
            ...(buyer?.email ? [{ email: buyer.email, firstName: buyer.firstName, role: "Buyer" as const }] : []),
            ...(seller?.email ? [{ email: seller.email, firstName: seller.firstName, role: "Seller" as const }] : []),
            { email: DISPUTE_SUPPORT_EMAIL, role: "TrueFanTix Support" as const },
          ],
          idempotencyKeyPrefix: `dispute-opened:${order.id}`,
        },
      };
    });

    if (result instanceof NextResponse) return result;

    try {
      await sendDisputeEmails(result.postCommitEmail);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown dispute email error";
      console.error(
        "[EMAIL] Dispute-opened notifications failed after commit:",
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

    console.error("POST /api/orders/dispute failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not open dispute." },
      { status: 500 }
    );
  }
}
