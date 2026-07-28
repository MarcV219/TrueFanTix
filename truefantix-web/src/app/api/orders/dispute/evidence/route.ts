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
    const validation = await validateRequest(schemas.orderDisputeEvidence)(req);
    if (!validation.success) return validation.response;
    const { orderId, comments, evidenceFiles } = validation.data;

    const order = await prisma.order.findUnique({
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
      gate.user.sellerId === order.buyerSellerId ? "BUYER" :
      gate.user.sellerId === order.sellerId ? "SELLER" : null;
    if (!role) return NextResponse.json({ ok: false, error: "FORBIDDEN", message: "Only this order’s buyer or seller may update the dispute." }, { status: 403 });
    if (order.buyerConfirmationStatus !== "DISPUTED") {
      return NextResponse.json({ ok: false, error: "INVALID_STATE", message: "This dispute is no longer open." }, { status: 409 });
    }
    const dispute = parseDisputeCase(order.transferVerificationReason);
    if (!dispute) return NextResponse.json({ ok: false, error: "INVALID_CASE", message: "Dispute case details could not be found." }, { status: 409 });

    const submission = {
      id: crypto.randomUUID(),
      submittedAt: new Date().toISOString(),
      submittedByUserId: gate.user.id,
      submittedByRole: role,
      comments: comments || null,
      evidenceFiles,
    };
    const updatedDispute = { ...dispute, submissions: [...(Array.isArray(dispute.submissions) ? dispute.submissions : []), submission] };
    await prisma.order.update({
      where: { id: order.id },
      data: { transferVerificationReason: JSON.stringify(updatedDispute) },
    });
    await auditLog({
      action: "DISPUTE_EVIDENCE_SUBMIT",
      userId: gate.user.id,
      targetType: "Order",
      targetId: order.id,
      metadata: { ...submission, evidenceFiles: evidenceFiles.map((file) => ({ fileName: file.fileName })) },
      ...createAuditContext(req),
    });

    const buyer = order.buyerSeller.user;
    const seller = order.seller.user;
    const counterpart = role === "BUYER" ? seller : buyer;
    if (counterpart?.id) {
      await createNotification({
        userId: counterpart.id,
        type: "DISPUTE_OPENED",
        message: `${role === "BUYER" ? "The buyer" : "The seller"} added information to dispute ${order.id}.`,
        link: role === "BUYER" ? "/account/tickets/seller-holding" : "/account/tickets/holding",
      });
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
    });

    return NextResponse.json({ ok: true, message: "Additional dispute information submitted." });
  } catch (err) {
    console.error("POST /api/orders/dispute/evidence failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: "Could not add dispute information." }, { status: 500 });
  }
}
