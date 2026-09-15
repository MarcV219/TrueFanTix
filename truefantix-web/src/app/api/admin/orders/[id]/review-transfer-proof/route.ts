export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { auditLog, createAuditContext } from "@/lib/audit";
import { BUYER_CONFIRMATION_DEADLINE_HOURS, addHours } from "@/lib/orders/transferWorkflow";
import { transferProofAdminActionMessage, transferProofStatusForAdminAction } from "@/lib/orders/transferProofAdminReview";
import {
  drainTransferProofDeliveryIntents,
  stageTransferProofAdminDecisionDeliveryIntent,
  stageTransferProofDeliveryIntent,
} from "@/lib/orders/transferProofDelivery";
import { schemas, validateRequest } from "@/lib/validation";
import {
  AdminOperationAccessChangedError,
  ManagedAccountAdminOperationError,
  runOrdinaryAdminOperation,
} from "@/lib/admin/ordinary-admin";

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

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return gate.res;
    const orderId = orderIdFromUrl(req);
    if (!orderId) return NextResponse.json({ ok: false, error: "MISSING_ORDER_ID", message: "Missing order id." }, { status: 400 });

    const validation = await validateRequest(schemas.adminReviewTransferProof)(req);
    if (!validation.success) return validation.response;
    const { action, note } = validation.data;
    const decisionId = crypto.randomUUID();
    let shouldDrainDelivery = false;
    const response = await runOrdinaryAdminOperation(gate.user.id, async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          buyerConfirmationStatus: true,
          transferVerificationStatus: true,
          transferProofType: true,
          transferProofData: true,
          seller: { select: { user: { select: { id: true, email: true, firstName: true } } } },
          buyerSeller: { select: { user: { select: { id: true, email: true, firstName: true } } } },
          items: { select: { id: true } },
        },
      });
      if (!order) return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Order not found." }, { status: 404 });
      if (order.status !== "PAID" || order.buyerConfirmationStatus !== "PENDING" || order.transferVerificationStatus !== "MANUAL_REVIEW") {
        return NextResponse.json({ ok: false, error: "INVALID_STATE", message: "This transfer proof is no longer awaiting human review." }, { status: 409 });
      }
      const sellerUser = order.seller.user;
      if (!sellerUser?.id || !sellerUser.email) {
        return NextResponse.json({ ok: false, error: "SELLER_IDENTITY_MISSING", message: "The order seller cannot receive this review decision." }, { status: 409 });
      }
      if (action === "APPROVE" && !order.transferProofType?.trim()) {
        return NextResponse.json({ ok: false, error: "TRANSFER_PROOF_TYPE_MISSING", message: "The reviewed transfer proof has no durable type." }, { status: 409 });
      }

      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`
        SELECT statement_timestamp() AT TIME ZONE 'UTC' AS now
      `;
      const decidedAt = clock.now;
      const decision = { id: decisionId, action, note, decidedAt: decidedAt.toISOString(), decidedByUserId: gate.user.id };
      const existingProof = parseProofData(order.transferProofData);
      const history = Array.isArray((existingProof as { adminReviews?: unknown }).adminReviews)
        ? (existingProof as { adminReviews: unknown[] }).adminReviews
        : [];
      const disputeWindowEndsAt = action === "APPROVE" ? addHours(decidedAt, BUYER_CONFIRMATION_DEADLINE_HOURS) : undefined;
      const updated = await tx.order.updateMany({
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

      if (action === "APPROVE" && disputeWindowEndsAt) {
        await stageTransferProofDeliveryIntent(tx, {
          buyerUserId: order.buyerSeller.user?.id ?? null,
          buyerEmail: order.buyerSeller.user?.email ?? null,
          buyerFirstName: order.buyerSeller.user?.firstName ?? null,
          sellerEmail: sellerUser.email,
          orderId: order.id,
          ticketCount: order.items.length,
          transferProofType: order.transferProofType!,
          deadline: disputeWindowEndsAt,
          now: decidedAt,
        });
      }
      await stageTransferProofAdminDecisionDeliveryIntent(tx, {
        orderId: order.id,
        decisionId: decision.id,
        action,
        note,
        decidedAt,
        decidedByUserId: gate.user.id,
        sellerUserId: sellerUser.id,
        sellerEmail: sellerUser.email,
        sellerFirstName: sellerUser.firstName,
      });
      shouldDrainDelivery = true;
      await auditLog({ action: "TRANSFER_PROOF_VERIFY", userId: gate.user.id, targetType: "Order", targetId: order.id, metadata: { ...decision, deliveryQueued: true }, ...createAuditContext(req) }, tx);

      return NextResponse.json({ ok: true, message: transferProofAdminActionMessage(action), warning: false });
    });
    if (shouldDrainDelivery) {
      try {
        await drainTransferProofDeliveryIntents({ orderId });
      } catch (deliveryError) {
        console.error("Post-commit transfer-proof review-decision delivery dispatch failed:", deliveryError);
      }
    }
    return response;
  } catch (err) {
    if (err instanceof ManagedAccountAdminOperationError) {
      return NextResponse.json(
        {
          ok: false,
          error: "STAGING_CONSOLE_ONLY",
          message: "This managed account is restricted to the staging console.",
        },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    if (err instanceof AdminOperationAccessChangedError) {
      const responses = {
        NOT_AUTHENTICATED: [401, "Please log in."],
        BANNED: [403, "This account is restricted."],
        NOT_VERIFIED: [403, "Please verify your email and phone number."],
        FORBIDDEN: [403, "Not authorized."],
      } as const;
      const [status, message] = responses[err.code];
      return NextResponse.json({ ok: false, error: err.code, message }, { status });
    }

    console.error("POST /api/admin/orders/[id]/review-transfer-proof failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: "Could not update the transfer-proof review." }, { status: 500 });
  }
}
