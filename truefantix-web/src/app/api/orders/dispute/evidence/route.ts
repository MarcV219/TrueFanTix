export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { auditLog, createAuditContext } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/service";
import { DISPUTE_SUPPORT_EMAIL, parseDisputeCase, sendDisputeEmails } from "@/lib/disputes";
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
    const validation = await validateRequest(schemas.orderDisputeEvidence)(req);
    if (!validation.success) return validation.response;
    const { orderId, comments, evidenceFiles } = validation.data;

    return await runOrdinaryOrderOperation(gate.user.id, async (tx, current) => {
      // Serialize submissions with dispute closure and other evidence updates.
      // The locked snapshot is authoritative for both authorization and append.
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          seller: { include: { user: true } },
          buyerSeller: { include: { user: true } },
          items: {
            include: { ticket: { select: { id: true, title: true, venue: true, date: true, row: true, seat: true } } },
          },
        },
      });
      if (!order) return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Order not found." }, { status: 404 });
      const role =
        current.sellerId === order.buyerSellerId ? "BUYER" :
        current.sellerId === order.sellerId ? "SELLER" : null;
      if (!role) return NextResponse.json({ ok: false, error: "FORBIDDEN", message: "Only this order’s buyer or seller may update the dispute." }, { status: 403 });
      if (order.buyerConfirmationStatus !== "DISPUTED") {
        return NextResponse.json({ ok: false, error: "INVALID_STATE", message: "This dispute is no longer open." }, { status: 409 });
      }
      const dispute = parseDisputeCase(order.transferVerificationReason);
      if (!dispute) return NextResponse.json({ ok: false, error: "INVALID_CASE", message: "Dispute case details could not be found." }, { status: 409 });

      const submission = {
        id: crypto.randomUUID(),
        submittedAt: new Date().toISOString(),
        submittedByUserId: current.id,
        submittedByRole: role,
        comments: comments || null,
        evidenceFiles,
      };
      const updatedDispute = { ...dispute, submissions: [...(Array.isArray(dispute.submissions) ? dispute.submissions : []), submission] };
      await tx.order.update({
        where: { id: order.id },
        data: { transferVerificationReason: JSON.stringify(updatedDispute) },
      });
      await auditLog({
        action: "DISPUTE_EVIDENCE_SUBMIT",
        userId: current.id,
        targetType: "Order",
        targetId: order.id,
        metadata: { ...submission, evidenceFiles: evidenceFiles.map((file) => ({ fileName: file.fileName })) },
        ...createAuditContext(req),
      }, tx);

      const buyer = order.buyerSeller.user;
      const seller = order.seller.user;
      const counterpart = role === "BUYER" ? seller : buyer;
      if (counterpart?.id) {
        await createNotification({
          userId: counterpart.id,
          type: "DISPUTE_OPENED",
          message: `${role === "BUYER" ? "The buyer" : "The seller"} added information to dispute ${order.id}.`,
          link: role === "BUYER" ? "/account/tickets/seller-holding" : "/account/tickets/holding",
        }, tx);
      }
      await sendDisputeEmails({
        orderId: order.id,
        kind: "UPDATED",
        submittedBy: role === "BUYER" ? "Buyer" : "Seller",
        comments: comments || "(documents only)",
        ticketCount: dispute.ticketCount || dispute.ticketIds?.length || 0,
        tickets: order.items
          .filter((item) => dispute.ticketIds?.includes(item.ticketId))
          .map((item) => {
            const location = [item.ticket.row ? `Row ${item.ticket.row}` : null, item.ticket.seat ? `Seat ${item.ticket.seat}` : null]
              .filter(Boolean)
              .join(", ");
            return `${item.ticket.title} — ${item.ticket.venue} — ${item.ticket.date}${location ? ` — ${location}` : ""} (ticket ${item.ticket.id})`;
          }),
        fileNames: evidenceFiles.map((file) => file.fileName),
        parties: [
          ...(buyer?.email ? [{ email: buyer.email, firstName: buyer.firstName, role: "Buyer" as const }] : []),
          ...(seller?.email ? [{ email: seller.email, firstName: seller.firstName, role: "Seller" as const }] : []),
          { email: DISPUTE_SUPPORT_EMAIL, role: "TrueFanTix Support" },
        ],
      }, tx);

      return NextResponse.json({ ok: true, message: "Additional dispute information submitted." });
    });
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

    console.error("POST /api/orders/dispute/evidence failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: "Could not add dispute information." }, { status: 500 });
  }
}
