export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";
import { auditLog, createAuditContext } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { DISPUTE_SUPPORT_EMAIL } from "@/lib/disputes";

export async function POST(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const validation = await validateRequest(schemas.orderTransferProof)(req);
    if (!validation.success) return validation.response;
    const {
      orderId,
      transferProofType,
      transferProofData,
      transferProofImage,
      transferProofFileName,
    } = validation.data;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        sellerId: true,
        status: true,
        buyerConfirmationStatus: true,
        transferVerificationStatus: true,
        items: { take: 1, select: { ticket: { select: { title: true } } } },
        seller: { select: { name: true, user: { select: { email: true, firstName: true, lastName: true } } } },
      },
    });

    if (!order) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Order not found." }, { status: 404 });
    }
    if (order.sellerId !== gate.user.sellerId) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN", message: "User is not the seller for this order." }, { status: 403 });
    }
    if (order.status !== "PAID" || order.buyerConfirmationStatus !== "PENDING") {
      return NextResponse.json(
        { ok: false, error: "INVALID_STATE", message: "This order is no longer awaiting transfer proof." },
        { status: 409 }
      );
    }
    const alreadyRequested = order.transferVerificationStatus === "MANUAL_REVIEW";
    if (!transferProofImage) {
      return NextResponse.json(
        { ok: false, error: "TRANSFER_PROOF_UPLOAD_REQUIRED", message: "Upload the documentation you want Support to review." },
        { status: 400 }
      );
    }

    const requestedAt = new Date();
    if (!alreadyRequested) {
      await prisma.order.update({
        where: { id: orderId },
        data: {
          transferProofType,
          transferProofData: JSON.stringify({
            sellerNote: transferProofData ?? "",
            fileName: transferProofFileName ?? null,
            proofUpload: transferProofImage,
            manualReviewRequestedAt: requestedAt.toISOString(),
          }),
          transferVerificationStatus: "MANUAL_REVIEW",
          transferVerificationReason: JSON.stringify({
            type: "SELLER_TRANSFER_PROOF_REVIEW_REQUESTED",
            requestedAt: requestedAt.toISOString(),
            requestedByUserId: gate.user.id,
          }),
        },
      });
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_ORIGIN || "https://truefantix-web.vercel.app").replace(/\/$/, "");
    const reviewUrl = `${appUrl}/admin/orders/${encodeURIComponent(orderId)}`;
    const sellerName =
      [order.seller.user?.firstName, order.seller.user?.lastName].filter(Boolean).join(" ") ||
      order.seller.name ||
      "Seller";
    const eventTitle = order.items[0]?.ticket.title || "Ticket order";
    const subject = `ACTION REQUIRED: Human Review Requested for Transfer Proof — ${orderId}`;
    const text = `${sellerName} (${order.seller.user?.email || "email unavailable"}) requested a human review of transfer documentation.

Order: ${orderId}
Event: ${eventTitle}
Requested: ${requestedAt.toISOString()}

Review the stored documentation:
${reviewUrl}`;
    const html = `<p><strong>${sellerName}</strong> (${order.seller.user?.email || "email unavailable"}) requested a human review of transfer documentation.</p>
<p><strong>Order:</strong> ${orderId}<br><strong>Event:</strong> ${eventTitle}<br><strong>Requested:</strong> ${requestedAt.toISOString()}</p>
<p><a href="${reviewUrl}">Review the order and documentation</a></p>`;
    const existingEmail = await prisma.emailDelivery.findUnique({
      where: {
        orderId_emailType_recipient: {
          orderId,
          emailType: "TRANSFER_PROOF_HUMAN_REVIEW",
          recipient: DISPUTE_SUPPORT_EMAIL,
        },
      },
    });
    const emailResult = existingEmail?.status === "SENT"
      ? { ok: true }
      : await sendEmail({ to: DISPUTE_SUPPORT_EMAIL, subject, text, html });
    if (existingEmail?.status !== "SENT") {
      await prisma.emailDelivery.upsert({
        where: {
          orderId_emailType_recipient: {
            orderId,
            emailType: "TRANSFER_PROOF_HUMAN_REVIEW",
            recipient: DISPUTE_SUPPORT_EMAIL,
          },
        },
        create: {
          orderId,
          emailType: "TRANSFER_PROOF_HUMAN_REVIEW",
          recipient: DISPUTE_SUPPORT_EMAIL,
          provider: process.env.RESEND_API_KEY ? "RESEND" : process.env.SENDGRID_API_KEY ? "SENDGRID" : "CONSOLE",
          status: emailResult.ok ? "SENT" : "FAILED",
          error: emailResult.error ?? null,
        },
        update: {
          sentAt: requestedAt,
          provider: process.env.RESEND_API_KEY ? "RESEND" : process.env.SENDGRID_API_KEY ? "SENDGRID" : "CONSOLE",
          status: emailResult.ok ? "SENT" : "FAILED",
          error: emailResult.error ?? null,
        },
      });
    }

    await auditLog({
      action: "TRANSFER_PROOF_VERIFY",
      userId: gate.user.id,
      targetType: "Order",
      targetId: orderId,
      metadata: {
        result: "MANUAL_REVIEW_REQUESTED",
        supportEmailSent: emailResult.ok,
      },
      ...createAuditContext(req),
    });

    return NextResponse.json({
      ok: true,
      alreadyRequested,
      supportEmailSent: emailResult.ok,
      message: emailResult.ok
        ? "Human review requested. Support has been emailed and the order is in the Admin Queue."
        : "Human review requested and added to the Admin Queue. Support email delivery will be retried by the team.",
    });
  } catch (err) {
    console.error("POST /api/orders/transfer-proof/human-review failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not request human review." },
      { status: 500 }
    );
  }
}
