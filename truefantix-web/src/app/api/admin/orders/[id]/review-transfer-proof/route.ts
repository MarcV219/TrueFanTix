export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { auditLog, createAuditContext } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { createNotification } from "@/lib/notifications/service";
import { BUYER_CONFIRMATION_DEADLINE_HOURS, addHours, notifyBuyerTransferConfirmationRequired } from "@/lib/orders/transferWorkflow";
import { transferProofAdminActionMessage, transferProofStatusForAdminAction } from "@/lib/orders/transferProofAdminReview";
import { schemas, validateRequest } from "@/lib/validation";

function orderIdFromUrl(req: Request) {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const ordersIndex = parts.indexOf("orders");
  return ordersIndex >= 0 ? decodeURIComponent(parts[ordersIndex + 1] || "").trim() : "";
}

function parseProofData(value: string | null) {
  try {
    const parsed = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function actionEmail(action: "APPROVE" | "REJECT" | "REQUEST_INFORMATION", orderId: string, firstName: string | null, note: string) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_ORIGIN || "https://truefantix.com").replace(/\/$/, "");
  const holdingUrl = `${appUrl}/account/tickets/seller-holding`;
  const heading = action === "APPROVE" ? "Transfer proof approved" : action === "REJECT" ? "Transfer proof needs to be replaced" : "ACTION REQUIRED: More transfer information needed";
  const instruction = action === "APPROVE"
    ? "No further transfer-proof action is required right now. The buyer has been asked to confirm receipt."
    : action === "REJECT"
      ? "Please upload corrected transfer documentation from Seller Holding."
      : "Please upload the requested supporting information from Seller Holding so Support can complete its review.";
  const subject = action === "APPROVE" ? `Transfer Proof Approved — ${orderId}` : `ACTION REQUIRED: ${heading} — ${orderId}`;
  const text = `${heading}\n\nHi ${firstName || "there"},\n\nSupport reviewed the transfer proof for order ${orderId}.\n\nSupport note:\n${note}\n\n${instruction}\n\n${holdingUrl}\n\nThanks,\nThe TrueFanTix Team`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f2937"><div style="background:#064a93;color:white;padding:20px;border-radius:8px 8px 0 0"><strong>${heading}</strong></div><div style="background:#f9fafb;padding:24px"><p>Hi ${firstName || "there"},</p><p>Support reviewed the transfer proof for order <strong>${orderId}</strong>.</p><div style="background:white;border-left:4px solid #f97316;padding:16px;margin:18px 0"><strong>Support note</strong><p style="white-space:pre-wrap">${note.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character)}</p></div><p>${instruction}</p><p><a href="${holdingUrl}" style="display:inline-block;background:#064a93;color:white;padding:12px 20px;text-decoration:none;border-radius:7px;font-weight:bold">Open Seller Holding</a></p></div></div>`;
  return { subject, text, html };
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return gate.res;
    const orderId = orderIdFromUrl(req);
    if (!orderId) return NextResponse.json({ ok: false, error: "MISSING_ORDER_ID", message: "Missing order id." }, { status: 400 });

    const validation = await validateRequest(schemas.adminReviewTransferProof)(req);
    if (!validation.success) return validation.response;
    const { action, note } = validation.data;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        buyerConfirmationStatus: true,
        transferVerificationStatus: true,
        transferProofData: true,
        seller: { select: { user: { select: { id: true, email: true, firstName: true } } } },
        buyerSeller: { select: { user: { select: { id: true } } } },
        items: { select: { id: true } },
      },
    });
    if (!order) return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Order not found." }, { status: 404 });
    if (order.status !== "PAID" || order.buyerConfirmationStatus !== "PENDING" || order.transferVerificationStatus !== "MANUAL_REVIEW") {
      return NextResponse.json({ ok: false, error: "INVALID_STATE", message: "This transfer proof is no longer awaiting human review." }, { status: 409 });
    }

    const decidedAt = new Date();
    const decision = { id: crypto.randomUUID(), action, note, decidedAt: decidedAt.toISOString(), decidedByUserId: gate.user.id };
    const existingProof = parseProofData(order.transferProofData);
    const history = Array.isArray((existingProof as { adminReviews?: unknown }).adminReviews)
      ? (existingProof as { adminReviews: unknown[] }).adminReviews
      : [];
    const disputeWindowEndsAt = action === "APPROVE" ? addHours(decidedAt, BUYER_CONFIRMATION_DEADLINE_HOURS) : undefined;
    const updated = await prisma.order.updateMany({
      where: { id: order.id, transferVerificationStatus: "MANUAL_REVIEW" },
      data: {
        ...(action === "APPROVE" ? {} : { transferProofType: null }),
        transferVerificationStatus: transferProofStatusForAdminAction(action),
        transferVerificationReason: JSON.stringify({ type: "TRANSFER_PROOF_ADMIN_REVIEW", ...decision }),
        transferProofData: JSON.stringify({ ...existingProof, adminReviews: [...history, decision] }),
        ...(disputeWindowEndsAt ? { disputeWindowEndsAt } : {}),
      },
    });
    if (updated.count !== 1) return NextResponse.json({ ok: false, error: "STALE_REVIEW", message: "Another Admin already updated this review. Refresh the order." }, { status: 409 });

    const sellerUser = order.seller.user;
    let sellerEmailSent = false;
    if (sellerUser?.email) {
      const email = actionEmail(action, order.id, sellerUser.firstName, note);
      const result = await sendEmail({ to: sellerUser.email, ...email });
      sellerEmailSent = result.ok;
      await prisma.emailDelivery.create({ data: { orderId: order.id, emailType: `TRANSFER_PROOF_ADMIN_${action}_${decision.id}`, recipient: sellerUser.email, provider: process.env.RESEND_API_KEY ? "RESEND" : process.env.SENDGRID_API_KEY ? "SENDGRID" : "CONSOLE", status: result.ok ? "SENT" : "FAILED", error: result.error || null } });
      await createNotification({ userId: sellerUser.id, type: action === "APPROVE" ? "TRANSFER_RECEIVED" : "VERIFICATION_NEEDED", message: action === "APPROVE" ? `Support approved the transfer proof for order ${order.id}.` : action === "REJECT" ? `Support rejected the transfer proof for order ${order.id}. Upload corrected documentation.` : `Support requested more transfer information for order ${order.id}: ${note}`, link: "/account/tickets/seller-holding" });
    }
    if (action === "APPROVE" && order.buyerSeller.user?.id && disputeWindowEndsAt) {
      await notifyBuyerTransferConfirmationRequired({ buyerUserId: order.buyerSeller.user.id, orderId: order.id, ticketCount: order.items.length, deadline: disputeWindowEndsAt, sendEmail: true, now: decidedAt });
    }
    await auditLog({ action: "TRANSFER_PROOF_VERIFY", userId: gate.user.id, targetType: "Order", targetId: order.id, metadata: { ...decision, sellerEmailSent }, ...createAuditContext(req) });

    return NextResponse.json({ ok: true, message: transferProofAdminActionMessage(action), warning: Boolean(sellerUser?.email) && !sellerEmailSent });
  } catch (err) {
    console.error("POST /api/admin/orders/[id]/review-transfer-proof failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: "Could not update the transfer-proof review." }, { status: 500 });
  }
}
