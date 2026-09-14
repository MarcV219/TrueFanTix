export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";
import { auditLog, createAuditContext } from "@/lib/audit";
import { DISPUTE_SUPPORT_EMAIL } from "@/lib/disputes";
import {
  ManagedAccountOrderOperationError,
  OrderOperationAccessChangedError,
  runOrdinaryOrderOperation,
} from "@/lib/orders/ordinary-user";
import {
  drainTransferProofReviewDeliveryIntents,
  stageTransferProofReviewDeliveryIntent,
} from "@/lib/orders/transferProofReviewDelivery";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]
    || character
  ));
}

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

    let shouldDrainDelivery = false;
    const response = await runOrdinaryOrderOperation(gate.user.id, async (tx, current) => {
      // Serialize the current seller identity with the proof state. In
      // particular, an already accepted proof must not be replaced through
      // the manual-review fallback after its buyer deadline and deliveries
      // have become durable.
      const [orderLock] = await tx.$queryRaw<Array<{ now: Date }>>`
        SELECT statement_timestamp() AT TIME ZONE 'UTC' AS now
        FROM "Order"
        WHERE "id" = ${orderId}
        FOR UPDATE
      `;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          sellerId: true,
          status: true,
          buyerConfirmationStatus: true,
          transferVerificationStatus: true,
          disputeWindowEndsAt: true,
          items: { take: 1, select: { ticket: { select: { title: true } } } },
          seller: { select: { name: true, user: { select: { email: true, firstName: true, lastName: true } } } },
        },
      });

      if (!order) {
        return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Order not found." }, { status: 404 });
      }
      if (order.sellerId !== current.sellerId) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN", message: "User is not the seller for this order." }, { status: 403 });
      }
      if (order.status !== "PAID" || order.buyerConfirmationStatus !== "PENDING") {
        return NextResponse.json(
          { ok: false, error: "INVALID_STATE", message: "This order is no longer awaiting transfer proof." },
          { status: 409 }
        );
      }
      if (order.disputeWindowEndsAt !== null) {
        return NextResponse.json(
          {
            ok: false,
            error: "TRANSFER_PROOF_ALREADY_SUBMITTED",
            message: "Transfer proof has already been accepted for this order.",
          },
          { status: 409 },
        );
      }

      const alreadyRequested = order.transferVerificationStatus === "MANUAL_REVIEW";
      if (!transferProofImage) {
        return NextResponse.json(
          { ok: false, error: "TRANSFER_PROOF_UPLOAD_REQUIRED", message: "Upload the documentation you want Support to review." },
          { status: 400 }
        );
      }

      const requestedAt = orderLock.now;
      const requestId = crypto.randomUUID();
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_ORIGIN || "https://truefantix-web.vercel.app").replace(/\/$/, "");
      const reviewUrl = `${appUrl}/admin/orders/${encodeURIComponent(orderId)}`;
      const sellerName =
        [order.seller.user?.firstName, order.seller.user?.lastName].filter(Boolean).join(" ") ||
        order.seller.name ||
        "Seller";
      const eventTitle = order.items[0]?.ticket.title || "Ticket order";
      const subject = `ACTION REQUIRED: Human Review Requested for Transfer Proof — ${orderId}`;
      const sellerEmail = order.seller.user?.email || "email unavailable";
      const textBody = `${sellerName} (${order.seller.user?.email || "email unavailable"}) requested a human review of transfer documentation.

Order: ${orderId}
Event: ${eventTitle}
Requested: ${requestedAt.toISOString()}

Review the stored documentation:
${reviewUrl}`;
      const htmlBody = `<p><strong>${escapeHtml(sellerName)}</strong> (${escapeHtml(sellerEmail)}) requested a human review of transfer documentation.</p>
<p><strong>Order:</strong> ${escapeHtml(orderId)}<br><strong>Event:</strong> ${escapeHtml(eventTitle)}<br><strong>Requested:</strong> ${requestedAt.toISOString()}</p>
<p><a href="${escapeHtml(reviewUrl)}">Review the order and documentation</a></p>`;
      if (!alreadyRequested) {
        await tx.order.update({
          where: { id: orderId },
          data: {
            transferProofType,
            transferProofData: JSON.stringify({
              sellerNote: transferProofData ?? "",
              fileName: transferProofFileName ?? null,
              proofUpload: transferProofImage,
              manualReviewRequestId: requestId,
              manualReviewRequestedAt: requestedAt.toISOString(),
              requestedByUserId: current.id,
            }),
            transferVerificationStatus: "MANUAL_REVIEW",
            transferVerificationReason: JSON.stringify({
              type: "SELLER_TRANSFER_PROOF_REVIEW_REQUESTED",
              requestedAt: requestedAt.toISOString(),
              requestedByUserId: current.id,
            }),
          },
        });
        await stageTransferProofReviewDeliveryIntent(tx, {
          orderId,
          requestId,
          recipient: DISPUTE_SUPPORT_EMAIL,
          subject,
          textBody,
          htmlBody,
          requestedAt,
        });
      }

      await auditLog({
        action: "TRANSFER_PROOF_VERIFY",
        userId: current.id,
        targetType: "Order",
        targetId: orderId,
        metadata: {
          result: "MANUAL_REVIEW_REQUESTED",
          supportEmailQueued: true,
        },
        ...createAuditContext(req),
      }, tx);

      shouldDrainDelivery = true;
      return NextResponse.json({
        ok: true,
        alreadyRequested,
        supportEmailQueued: true,
        message: "Human review requested and queued for Support. The order is in the Admin Queue.",
      });
    });
    if (shouldDrainDelivery) {
      try {
        await drainTransferProofReviewDeliveryIntents({ orderId });
      } catch (deliveryError) {
        console.error("Post-commit transfer-proof review delivery dispatch failed:", deliveryError);
      }
    }
    return response;
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
    console.error("POST /api/orders/transfer-proof/human-review failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not request human review." },
      { status: 500 }
    );
  }
}
