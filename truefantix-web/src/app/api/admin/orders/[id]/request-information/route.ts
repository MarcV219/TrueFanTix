export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { auditLog, createAuditContext } from "@/lib/audit";
import { generateDisputeInformationRequestEmail, sendEmail } from "@/lib/email";
import { parseDisputeCase } from "@/lib/disputes";
import { createNotification } from "@/lib/notifications/service";
import { schemas, validateRequest } from "@/lib/validation";

function orderIdFromUrl(req: Request) {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const ordersIndex = parts.indexOf("orders");
  return ordersIndex >= 0 ? decodeURIComponent(parts[ordersIndex + 1] || "").trim() : "";
}

function appOrigin() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_ORIGIN || "https://truefantix-web.vercel.app").replace(/\/$/, "");
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return gate.res;

    const orderId = orderIdFromUrl(req);
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "MISSING_ORDER_ID", message: "Missing order id." }, { status: 400 });
    }

    const validation = await validateRequest(schemas.adminRequestDisputeInformation)(req);
    if (!validation.success) return validation.response;
    const { recipient, message } = validation.data;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        seller: { include: { user: true } },
        buyerSeller: { include: { user: true } },
      },
    });
    if (!order) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Order not found." }, { status: 404 });
    }
    if (order.buyerConfirmationStatus !== "DISPUTED") {
      return NextResponse.json({ ok: false, error: "INVALID_STATE", message: "This dispute is no longer open." }, { status: 409 });
    }

    const dispute = parseDisputeCase(order.transferVerificationReason);
    if (!dispute) {
      return NextResponse.json({ ok: false, error: "INVALID_CASE", message: "Dispute case details could not be found." }, { status: 409 });
    }

    const targets = [
      ...(recipient !== "SELLER" && order.buyerSeller.user?.email
        ? [{
            role: "BUYER" as const,
            email: order.buyerSeller.user.email,
            firstName: order.buyerSeller.user.firstName,
            userId: order.buyerSeller.user.id,
            link: `${appOrigin()}/account/tickets/holding`,
          }]
        : []),
      ...(recipient !== "BUYER" && order.seller.user?.email
        ? [{
            role: "SELLER" as const,
            email: order.seller.user.email,
            firstName: order.seller.user.firstName,
            userId: order.seller.user.id,
            link: `${appOrigin()}/account/tickets/seller-holding`,
          }]
        : []),
    ];
    if (!targets.length) {
      return NextResponse.json({ ok: false, error: "NO_RECIPIENT", message: "The selected party has no email address." }, { status: 409 });
    }

    const requestId = crypto.randomUUID();
    const requestedAt = new Date().toISOString();
    const deliveries = await Promise.all(targets.map(async (target) => {
      const email = generateDisputeInformationRequestEmail({
        orderId: order.id,
        firstName: target.firstName || (target.role === "BUYER" ? "Buyer" : "Seller"),
        requestMessage: message,
        responseUrl: target.link,
      });
      const result = await sendEmail({ to: target.email, ...email });
      const status = result.ok ? "SENT" as const : "FAILED" as const;
      await prisma.emailDelivery.create({
        data: {
          orderId: order.id,
          emailType: `DISPUTE_INFO_REQUEST_${requestId}_${target.role}`,
          recipient: target.email,
          provider: process.env.RESEND_API_KEY ? "RESEND" : process.env.SENDGRID_API_KEY ? "SENDGRID" : "CONSOLE",
          status,
          error: result.error || null,
        },
      });
      await createNotification({
        userId: target.userId,
        type: "DISPUTE_OPENED",
        message: `TrueFanTix Support requested more information for dispute ${order.id}.`,
        link: target.role === "BUYER" ? "/account/tickets/holding" : "/account/tickets/seller-holding",
      });
      return { role: target.role, email: target.email, status };
    }));

    const adminRequest = {
      id: requestId,
      requestedAt,
      requestedByUserId: gate.user.id,
      recipient,
      message,
      deliveries,
    };
    const updatedDispute = {
      ...dispute,
      adminRequests: [...(Array.isArray(dispute.adminRequests) ? dispute.adminRequests : []), adminRequest],
    };
    await prisma.order.update({
      where: { id: order.id },
      data: {
        transferVerificationStatus: "MANUAL_REVIEW",
        transferVerificationReason: JSON.stringify(updatedDispute),
      },
    });
    await auditLog({
      action: "DISPUTE_INFO_REQUEST",
      userId: gate.user.id,
      targetType: "Order",
      targetId: order.id,
      metadata: adminRequest,
      ...createAuditContext(req),
    });

    const failed = deliveries.filter((delivery) => delivery.status === "FAILED").length;
    return NextResponse.json({
      ok: true,
      message: failed
        ? `Request recorded, but ${failed} email${failed === 1 ? "" : "s"} failed to send.`
        : `Information request sent to ${recipient === "BOTH" ? "the buyer and seller" : `the ${recipient.toLowerCase()}`}.`,
      warning: failed > 0,
    });
  } catch (err) {
    console.error("POST /api/admin/orders/[id]/request-information failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not send the information request." },
      { status: 500 }
    );
  }
}
