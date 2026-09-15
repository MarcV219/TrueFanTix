export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { awardLaunchSale } from "@/lib/launchPromotion";
import { requireAdmin } from "@/lib/auth/guards";
import { auditLog, createAuditContext } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/service";
import { DISPUTE_SUPPORT_EMAIL, parseDisputeCase, sendDisputeEmails } from "@/lib/disputes";
import { schemas, validateRequest } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import {
  AdminOperationAccessChangedError,
  ManagedAccountAdminOperationError,
  runOrdinaryAdminOperation,
} from "@/lib/admin/ordinary-admin";
import {
  assertLegacyDisputeRefundProviderEvidence,
  claimLegacyDisputeRefundIntent,
  finalizeLegacyDisputeRefund,
  LegacyDisputeRefundAuthorizationChangedError,
  markLegacyDisputeRefundFailed,
  markLegacyDisputeRefundReconciliationRequired,
  stageLegacyDisputeRefundIntent,
  type LegacyDisputeRefundProviderEvidence,
} from "@/lib/orders/legacyDisputeRefund";

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
  let refundActionRequested = false;
  let refundProviderContacted = false;
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
    refundActionRequested = action === "MARK_REFUND_REQUIRED";
    const result = await runOrdinaryAdminOperation(gate.user.id, async (tx) => {
      // Serialize resolution for one dispute before any irreversible provider
      // call or customer delivery. A competing administrator must re-read the
      // closed state instead of repeating the resolution.
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      if (action === "MARK_REFUND_REQUIRED") {
        await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "orderId" = ${orderId} FOR UPDATE`;
      }
      const order = await tx.order.findUnique({
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

      if (
        action === "MARK_REFUND_REQUIRED"
        && order.buyerConfirmationStatus === "REFUNDED"
        && order.status === "REFUNDED"
        && order.payment?.status === "REFUNDED"
      ) {
        const completedIntent = await tx.legacyDisputeRefundIntent.findUnique({
          where: { orderId: order.id },
        });
        if (completedIntent?.status === "SUCCEEDED") {
          return NextResponse.json({
            ok: true,
            order: {
              id: order.id,
              status: order.status,
              buyerConfirmationStatus: order.buyerConfirmationStatus,
              transferVerificationStatus: order.transferVerificationStatus,
            },
            message: `Admin refund for order ${order.id} was already completed.`,
            replayed: true,
          }, { status: 200 });
        }
      }

      if (order.buyerConfirmationStatus !== "DISPUTED") {
        return NextResponse.json(
          { ok: false, error: "INVALID_STATE", message: "Order is not currently disputed." },
          { status: 409 }
        );
      }

      const now = new Date();
      const auditContext = createAuditContext(req);
      const resolution = {
        type: "ADMIN_DISPUTE_RESOLUTION",
        action,
        note,
        resolvedAt: now.toISOString(),
        resolvedByUserId: gate.user.id,
      };

      let updatedOrder;
      if (action === "RELEASE_PAYOUT") {
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

        const completedOrder = await tx.order.update({
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
        await awardLaunchSale(tx, { orderId: order.id, sellerId: order.sellerId, ticketCount: order.items.length, occurredAt: now });
        updatedOrder = completedOrder;
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
        if (
          order.payment.amountCents !== order.totalCents
          || order.payment.currency.toUpperCase() !== order.currency.toUpperCase()
        ) {
          return NextResponse.json(
            { ok: false, error: "PAYMENT_NOT_REFUNDABLE", message: "The payment snapshot no longer matches this order." },
            { status: 409 },
          );
        }

        const intent = await stageLegacyDisputeRefundIntent(tx, {
          orderId: order.id,
          paymentId: order.payment.id,
          authorizedByUserId: gate.user.id,
          providerPaymentRef: order.payment.providerRef,
          expectedAmountCents: order.payment.amountCents,
          currency: order.payment.currency,
          authorizationReason: note,
          authorizationIpAddress: auditContext.ipAddress,
          authorizationUserAgent: auditContext.userAgent,
          authorizedAt: now,
        });
        const dispute = parseDisputeCase(order.transferVerificationReason);
        const tickets = order.items
          .filter((item) => !dispute?.ticketIds?.length || dispute.ticketIds.includes(item.ticketId))
          .map((item) => {
            const location = [item.ticket.row ? `Row ${item.ticket.row}` : null, item.ticket.seat ? `Seat ${item.ticket.seat}` : null]
              .filter(Boolean)
              .join(", ");
            return `${item.ticket.title} — ${item.ticket.venue} — ${item.ticket.date}${location ? ` — ${location}` : ""} (ticket ${item.ticketId})`;
          });
        return {
          refundIntent: intent,
          email: {
            orderId: order.id,
            kind: "REFUNDED" as const,
            submittedBy: "TrueFanTix Support",
            comments: intent.authorizationReason,
            ticketCount: dispute?.ticketCount || dispute?.ticketIds?.length || order.items.length,
            tickets,
            fileNames: [],
            parties: [
              ...(order.buyerSeller.user?.email ? [{ email: order.buyerSeller.user.email, firstName: order.buyerSeller.user.firstName, role: "Buyer" as const }] : []),
              ...(order.seller.user?.email ? [{ email: order.seller.user.email, firstName: order.seller.user.firstName, role: "Seller" as const }] : []),
              { email: DISPUTE_SUPPORT_EMAIL, role: "TrueFanTix Support" as const },
            ],
            idempotencyKeyPrefix: `dispute-refunded:${order.id}`,
          },
          notifications: [
            ...(order.seller.user?.id ? [{ userId: order.seller.user.id, link: "/account/tickets/seller-holding" }] : []),
            ...(order.buyerSeller.user?.id ? [{ userId: order.buyerSeller.user.id, link: "/account/tickets/holding" }] : []),
          ],
        };
      } else {
        updatedOrder = await tx.order.update({
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
        }, tx),
        ...[order.seller.user?.id, order.buyerSeller.user?.id]
          .filter((userId): userId is string => Boolean(userId))
          .map((userId) =>
            createNotification({
              userId,
              type: "DISPUTE_OPENED",
              message,
              link: userId === order.seller.user?.id ? "/account/tickets/seller-holding" : "/account/tickets/holding",
            }, tx)
          ),
      ];
      const followUpResults = await Promise.allSettled(followUps);
      followUpResults.forEach((result, index) => {
        if (result.status === "rejected") {
          console.error(`Dispute resolution follow-up ${index + 1} failed for order ${order.id}:`, result.reason);
        }
      });

      const resolutionEmailKind = action === "RELEASE_PAYOUT" ? "RESOLVED" as const : null;
      const response = NextResponse.json({ ok: true, order: updatedOrder, message }, { status: 200 });
      if (!resolutionEmailKind) return { response };

      return {
        response,
        postCommitEmail: {
          orderId: order.id,
          kind: resolutionEmailKind,
          submittedBy: "TrueFanTix Support",
          comments: note,
          ticketCount: dispute?.ticketCount || dispute?.ticketIds?.length || order.items.length,
          tickets: disputedTicketDetails,
          fileNames: [],
          parties: [
            ...(order.buyerSeller.user?.email ? [{ email: order.buyerSeller.user.email, firstName: order.buyerSeller.user.firstName, role: "Buyer" as const }] : []),
            ...(order.seller.user?.email ? [{ email: order.seller.user.email, firstName: order.seller.user.firstName, role: "Seller" as const }] : []),
            { email: DISPUTE_SUPPORT_EMAIL, role: "TrueFanTix Support" as const },
          ],
          idempotencyKeyPrefix: `dispute-resolved:${order.id}`,
        },
      };
    });

    if (result instanceof NextResponse) return result;

    if (
      "refundIntent" in result
      && result.refundIntent
      && result.email
      && result.notifications
    ) {
      if (result.refundIntent.status === "FAILED") {
        return NextResponse.json({
          ok: false,
          error: "REFUND_PROVIDER_REJECTED",
          message: "The provider definitively rejected this refund. Manual review is required.",
          retrySafe: false,
        }, { status: 422 });
      }
      if (result.refundIntent.status !== "NOT_SENT") {
        return NextResponse.json({
          ok: false,
          error: "REFUND_RECONCILIATION_REQUIRED",
          message: "This refund may already have reached the provider. Do not retry it automatically; reconcile the recorded attempt.",
          retrySafe: false,
        }, { status: 409 });
      }

      let stripe;
      try {
        stripe = await getStripe();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Refund provider is unavailable.";
        return NextResponse.json({
          ok: false,
          error: "REFUND_PROVIDER_UNAVAILABLE",
          message,
          retrySafe: true,
        }, { status: 503 });
      }

      const claimed = await prisma.$transaction(
        (tx) => claimLegacyDisputeRefundIntent(tx, result.refundIntent.id),
        { isolationLevel: "Serializable" },
      );
      if (!claimed) {
        const current = await prisma.legacyDisputeRefundIntent.findUnique({
          where: { id: result.refundIntent.id },
        });
        if (current?.status === "SUCCEEDED") {
          const order = await prisma.order.findUnique({
            where: { id: current.orderId },
            select: { id: true, status: true, buyerConfirmationStatus: true, transferVerificationStatus: true },
          });
          return NextResponse.json({
            ok: true,
            order,
            message: `Admin refund for order ${current.orderId} was already completed.`,
            replayed: true,
          }, { status: 200 });
        }
        if (current?.status === "FAILED") {
          return NextResponse.json({
            ok: false,
            error: "REFUND_PROVIDER_REJECTED",
            message: "The provider definitively rejected this refund. Manual review is required.",
            retrySafe: false,
          }, { status: 422 });
        }
        return NextResponse.json({
          ok: false,
          error: "REFUND_RECONCILIATION_REQUIRED",
          message: "This refund may already have reached the provider. Do not retry it automatically; reconcile the recorded attempt.",
          retrySafe: false,
        }, { status: 409 });
      }

      let providerRefund: {
        id?: string;
        status?: string;
        payment_intent?: string | { id?: string } | null;
        amount?: number;
        currency?: string;
      };
      try {
        refundProviderContacted = true;
        providerRefund = await stripe.refunds.create({
          payment_intent: claimed.providerPaymentRef,
          amount: claimed.expectedAmountCents,
          reason: "requested_by_customer",
          metadata: {
            orderId: claimed.orderId,
            disputeResolution: "REFUND_REQUIRED",
            resolvedByUserId: claimed.authorizedByUserId,
            refundIntentId: claimed.id,
            commandDigest: claimed.commandDigest,
          },
        }, { idempotencyKey: claimed.idempotencyKey });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown provider outcome";
        await prisma.$transaction((tx) => (
          markLegacyDisputeRefundReconciliationRequired(
            tx,
            claimed.id,
            `PROVIDER_OUTCOME_UNKNOWN: ${reason}`,
          )
        ));
        return NextResponse.json({
          ok: false,
          error: "REFUND_RECONCILIATION_REQUIRED",
          message: "The provider outcome is unknown. Do not retry automatically; reconcile the recorded attempt.",
          retrySafe: false,
        }, { status: 409 });
      }

      const paymentIntent = typeof providerRefund.payment_intent === "string"
        ? providerRefund.payment_intent
        : providerRefund.payment_intent?.id ?? "";
      const evidence: LegacyDisputeRefundProviderEvidence = {
        id: typeof providerRefund.id === "string" ? providerRefund.id : "",
        status: typeof providerRefund.status === "string" ? providerRefund.status : "",
        paymentIntent,
        amountCents: Number(providerRefund.amount),
        currency: typeof providerRefund.currency === "string" ? providerRefund.currency : "",
      };
      const exactProviderScope = Boolean(evidence.id.trim())
        && evidence.paymentIntent === claimed.providerPaymentRef
        && evidence.amountCents === claimed.expectedAmountCents
        && evidence.currency.toUpperCase() === claimed.currency;

      if ((evidence.status === "failed" || evidence.status === "canceled") && exactProviderScope) {
        await prisma.$transaction((tx) => markLegacyDisputeRefundFailed(
          tx,
          claimed.id,
          evidence,
          `Provider returned terminal ${evidence.status} evidence.`,
        ));
        return NextResponse.json({
          ok: false,
          error: "REFUND_PROVIDER_REJECTED",
          message: `The provider returned a terminal ${evidence.status} refund result. Manual review is required.`,
          retrySafe: false,
        }, { status: 422 });
      }

      try {
        assertLegacyDisputeRefundProviderEvidence(claimed, evidence);
      } catch {
        await prisma.$transaction((tx) => (
          markLegacyDisputeRefundReconciliationRequired(
            tx,
            claimed.id,
            "PROVIDER_EVIDENCE_MISMATCH_OR_NONTERMINAL_STATUS",
            exactProviderScope ? evidence : undefined,
          )
        ));
        return NextResponse.json({
          ok: false,
          error: "REFUND_RECONCILIATION_REQUIRED",
          message: "The provider response did not match the authorized refund. Do not retry automatically; reconcile the recorded attempt.",
          retrySafe: false,
        }, { status: 409 });
      }

      let finalized;
      try {
        finalized = await runOrdinaryAdminOperation(gate.user.id, (tx) => (
          finalizeLegacyDisputeRefund(tx, {
            intentId: claimed.id,
            authorizedByUserId: claimed.authorizedByUserId,
            evidence,
          })
        ));
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown local finalization failure";
        await prisma.$transaction((tx) => (
          markLegacyDisputeRefundReconciliationRequired(
            tx,
            claimed.id,
            `PROVIDER_SUCCEEDED_LOCAL_FINALIZE_FAILED: ${reason}`,
            evidence,
          )
        ));
        return NextResponse.json({
          ok: false,
          error: "REFUND_RECONCILIATION_REQUIRED",
          message: "The provider accepted the refund but local finalization did not commit. Do not retry automatically; reconciliation is required.",
          retrySafe: false,
        }, { status: 409 });
      }

      const message = `Admin refunded the buyer and closed dispute for order ${claimed.orderId}.`;
      await Promise.allSettled(result.notifications.map((notification) => createNotification({
        ...notification,
        type: "DISPUTE_OPENED",
        message,
      })));
      try {
        await sendDisputeEmails({
          ...result.email,
          comments: `${result.email.comments}\nStripe refund reference: ${evidence.id}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown dispute email error";
        console.error(
          "[EMAIL] Dispute-resolution notifications failed after commit:",
          `EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: ${message}`,
        );
      }
      return NextResponse.json({
        ok: true,
        order: finalized.updatedOrder,
        message,
      }, { status: 200 });
    }

    if ("postCommitEmail" in result && result.postCommitEmail) {
      try {
        await sendDisputeEmails(result.postCommitEmail);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown dispute email error";
        console.error(
          "[EMAIL] Dispute-resolution notifications failed after commit:",
          `EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: ${message}`,
        );
      }
    }
    return result.response;
  } catch (err) {
    if (err instanceof LegacyDisputeRefundAuthorizationChangedError) {
      return NextResponse.json({
        ok: false,
        error: "REFUND_AUTHORIZATION_CHANGED",
        message: err.message,
        retrySafe: false,
      }, { status: 409 });
    }
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

    if (refundProviderContacted) {
      console.error("Legacy dispute refund failed after provider contact; reconciliation required:", err);
      return NextResponse.json({
        ok: false,
        error: "REFUND_RECONCILIATION_REQUIRED",
        message: "The refund provider may have been contacted. Do not retry automatically; reconciliation is required.",
        retrySafe: false,
      }, { status: 409 });
    }

    if (refundActionRequested) {
      console.error("Legacy dispute refund failed before provider contact:", err);
      return NextResponse.json({
        ok: false,
        error: "REFUND_AUTHORIZATION_FAILED",
        message: "The refund was not sent to the provider. The authorization may be retried after reviewing the local error.",
        retrySafe: true,
      }, { status: 503 });
    }

    console.error("POST /api/admin/orders/[id]/resolve-dispute failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not resolve dispute." },
      { status: 500 }
    );
  }
}
