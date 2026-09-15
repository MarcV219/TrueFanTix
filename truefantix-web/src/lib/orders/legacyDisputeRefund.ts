import { createHash } from "node:crypto";
import type { LegacyDisputeRefundIntent, Prisma } from "@prisma/client";
import { refundOrderAccessTokens } from "@/lib/accessTokenHolds";

type Tx = Prisma.TransactionClient;

export class LegacyDisputeRefundAuthorizationChangedError extends Error {}

export type LegacyDisputeRefundProviderEvidence = {
  id: string;
  status: string;
  paymentIntent: string;
  amountCents: number;
  currency: string;
};

export type LegacyDisputeRefundAuthorization = {
  orderId: string;
  paymentId: string;
  authorizedByUserId: string;
  providerPaymentRef: string;
  expectedAmountCents: number;
  currency: string;
  authorizationReason: string;
  authorizationIpAddress?: string | null;
  authorizationUserAgent?: string | null;
  authorizedAt: Date;
};

function normalizeReason(value: string) {
  return value.trim();
}

function normalizeContext(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function digestAuthorization(input: LegacyDisputeRefundAuthorization) {
  return createHash("sha256").update(JSON.stringify([
    "legacy-dispute-refund-v1",
    input.orderId,
    input.paymentId,
    input.authorizedByUserId,
    "STRIPE",
    input.providerPaymentRef,
    input.expectedAmountCents,
    input.currency.toUpperCase(),
    normalizeReason(input.authorizationReason),
    normalizeContext(input.authorizationIpAddress),
    normalizeContext(input.authorizationUserAgent),
    input.authorizedAt.toISOString(),
    `dispute-refund:${input.orderId}`,
  ])).digest("hex");
}

function storedAuthorization(intent: LegacyDisputeRefundIntent): LegacyDisputeRefundAuthorization {
  return {
    orderId: intent.orderId,
    paymentId: intent.paymentId,
    authorizedByUserId: intent.authorizedByUserId,
    providerPaymentRef: intent.providerPaymentRef,
    expectedAmountCents: intent.expectedAmountCents,
    currency: intent.currency,
    authorizationReason: intent.authorizationReason,
    authorizationIpAddress: intent.authorizationIpAddress,
    authorizationUserAgent: intent.authorizationUserAgent,
    authorizedAt: intent.authorizedAt,
  };
}

function assertStoredAuthorizationDigest(intent: LegacyDisputeRefundIntent) {
  if (intent.commandDigest !== digestAuthorization(storedAuthorization(intent))) {
    throw new LegacyDisputeRefundAuthorizationChangedError(
      "The persisted refund authorization digest does not match its immutable snapshot.",
    );
  }
}

export async function stageLegacyDisputeRefundIntent(
  tx: Tx,
  input: LegacyDisputeRefundAuthorization,
) {
  const existing = await tx.legacyDisputeRefundIntent.findUnique({
    where: { orderId: input.orderId },
  });
  if (existing) {
    assertStoredAuthorizationDigest(existing);
    if (
      existing.paymentId !== input.paymentId
      || existing.authorizedByUserId !== input.authorizedByUserId
      || existing.provider !== "STRIPE"
      || existing.providerPaymentRef !== input.providerPaymentRef
      || existing.expectedAmountCents !== input.expectedAmountCents
      || existing.currency !== input.currency.toUpperCase()
      || existing.authorizationReason !== normalizeReason(input.authorizationReason)
      || existing.authorizationIpAddress !== normalizeContext(input.authorizationIpAddress)
      || existing.authorizationUserAgent !== normalizeContext(input.authorizationUserAgent)
    ) {
      throw new LegacyDisputeRefundAuthorizationChangedError(
        "The persisted refund authorization no longer matches the payment snapshot.",
      );
    }
    return existing;
  }

  return tx.legacyDisputeRefundIntent.create({
    data: {
      orderId: input.orderId,
      paymentId: input.paymentId,
      authorizedByUserId: input.authorizedByUserId,
      provider: "STRIPE",
      providerPaymentRef: input.providerPaymentRef,
      expectedAmountCents: input.expectedAmountCents,
      currency: input.currency.toUpperCase(),
      authorizationReason: normalizeReason(input.authorizationReason),
      authorizationIpAddress: normalizeContext(input.authorizationIpAddress),
      authorizationUserAgent: normalizeContext(input.authorizationUserAgent),
      authorizedAt: input.authorizedAt,
      commandDigest: digestAuthorization(input),
      idempotencyKey: `dispute-refund:${input.orderId}`,
    },
  });
}

export async function claimLegacyDisputeRefundIntent(
  tx: Tx,
  intentId: string,
  dispatchStartedAt = new Date(),
) {
  const current = await tx.legacyDisputeRefundIntent.findUnique({ where: { id: intentId } });
  if (!current || current.status !== "NOT_SENT") return null;
  assertStoredAuthorizationDigest(current);
  const claimed = await tx.legacyDisputeRefundIntent.updateMany({
    where: { id: intentId, status: "NOT_SENT", commandDigest: current.commandDigest },
    data: { status: "ATTEMPTING", dispatchStartedAt },
  });
  if (claimed.count !== 1) return null;
  return tx.legacyDisputeRefundIntent.findUniqueOrThrow({ where: { id: intentId } });
}

export async function markLegacyDisputeRefundReconciliationRequired(
  tx: Tx,
  intentId: string,
  failureReason: string,
  evidence?: LegacyDisputeRefundProviderEvidence,
  completedAt = new Date(),
) {
  return tx.legacyDisputeRefundIntent.updateMany({
    where: { id: intentId, status: "ATTEMPTING" },
    data: {
      status: "RECONCILIATION_REQUIRED",
      providerRefundId: evidence?.id,
      providerStatus: evidence?.status,
      failureReason,
      completedAt,
    },
  });
}

export async function markLegacyDisputeRefundFailed(
  tx: Tx,
  intentId: string,
  evidence: LegacyDisputeRefundProviderEvidence,
  failureReason: string,
  completedAt = new Date(),
) {
  return tx.legacyDisputeRefundIntent.updateMany({
    where: { id: intentId, status: "ATTEMPTING" },
    data: {
      status: "FAILED",
      providerRefundId: evidence.id,
      providerStatus: evidence.status,
      failureReason,
      completedAt,
    },
  });
}

export function assertLegacyDisputeRefundProviderEvidence(
  intent: LegacyDisputeRefundIntent,
  evidence: LegacyDisputeRefundProviderEvidence,
) {
  if (
    !evidence.id.trim()
    || evidence.status !== "succeeded"
    || evidence.paymentIntent !== intent.providerPaymentRef
    || evidence.amountCents !== intent.expectedAmountCents
    || evidence.currency.toUpperCase() !== intent.currency
  ) {
    throw new Error("LEGACY_DISPUTE_REFUND_PROVIDER_EVIDENCE_MISMATCH");
  }
}

export async function finalizeLegacyDisputeRefund(
  tx: Tx,
  params: {
    intentId: string;
    authorizedByUserId: string;
    evidence: LegacyDisputeRefundProviderEvidence;
    now?: Date;
  },
) {
  const now = params.now ?? new Date();
  await tx.$queryRaw`SELECT "id" FROM "LegacyDisputeRefundIntent" WHERE "id" = ${params.intentId} FOR UPDATE`;
  const intent = await tx.legacyDisputeRefundIntent.findUniqueOrThrow({
    where: { id: params.intentId },
  });
  if (intent.status !== "ATTEMPTING") {
    throw new Error("LEGACY_DISPUTE_REFUND_NOT_OWNED");
  }
  if (intent.authorizedByUserId !== params.authorizedByUserId) {
    throw new Error("LEGACY_DISPUTE_REFUND_AUTHORIZER_MISMATCH");
  }
  assertStoredAuthorizationDigest(intent);
  assertLegacyDisputeRefundProviderEvidence(intent, params.evidence);

  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${intent.orderId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${intent.paymentId} FOR UPDATE`;
  const order = await tx.order.findUnique({
    where: { id: intent.orderId },
    include: {
      items: { include: { ticket: true } },
      payment: true,
      seller: { include: { user: true } },
      buyerSeller: { include: { user: true } },
    },
  });
  if (!order || !order.payment) throw new Error("LEGACY_DISPUTE_REFUND_SCOPE_MISSING");
  if (
    order.buyerConfirmationStatus !== "DISPUTED"
    || order.payment.id !== intent.paymentId
    || order.payment.status !== "SUCCEEDED"
    || order.payment.provider !== intent.provider
    || order.payment.providerRef !== intent.providerPaymentRef
    || order.payment.amountCents !== intent.expectedAmountCents
    || order.payment.currency.toUpperCase() !== intent.currency
    || order.totalCents !== intent.expectedAmountCents
    || order.currency.toUpperCase() !== intent.currency
  ) {
    throw new Error("LEGACY_DISPUTE_REFUND_SCOPE_CHANGED");
  }

  const ticketIds = order.items.map((item) => item.ticketId);
  await tx.payment.update({
    where: { id: intent.paymentId },
    data: { status: "REFUNDED" },
  });
  await tx.payout.updateMany({
    where: {
      sellerId: order.sellerId,
      providerRef: `order:${order.id}`,
      status: "PENDING",
    },
    data: { status: "CANCELED" },
  });
  await tx.ticket.updateMany({
    where: { id: { in: ticketIds } },
    data: {
      status: "WITHDRAWN",
      reservedByOrderId: null,
      reservedUntil: null,
    },
  });
  await tx.ticketEscrow.updateMany({
    where: { orderId: order.id },
    data: {
      state: "RELEASED_BACK_TO_SELLER",
      releasedTo: order.sellerId,
      releasedAt: now,
      failureReason: null,
    },
  });
  await refundOrderAccessTokens(tx, order.id);

  const resolution = {
    type: "ADMIN_DISPUTE_RESOLUTION",
    action: "MARK_REFUND_REQUIRED",
    note: intent.authorizationReason,
    resolvedAt: now.toISOString(),
    resolvedByUserId: params.authorizedByUserId,
    stripeRefundId: params.evidence.id,
    stripeRefundStatus: params.evidence.status,
    refundIntentId: intent.id,
    refundCommandDigest: intent.commandDigest,
  };
  const updatedOrder = await tx.order.update({
    where: { id: order.id },
    data: {
      status: "REFUNDED",
      buyerConfirmationStatus: "REFUNDED",
      buyerConfirmationAt: now,
      transferVerificationStatus: "REFUNDED",
      transferVerificationReason: JSON.stringify({
        dispute: (() => {
          if (!order.transferVerificationReason) return null;
          try { return JSON.parse(order.transferVerificationReason); }
          catch { return { previousReason: order.transferVerificationReason }; }
        })(),
        resolution,
      }),
    },
    select: {
      id: true,
      status: true,
      buyerConfirmationStatus: true,
      transferVerificationStatus: true,
    },
  });

  await tx.auditLog.create({
    data: {
      action: "DISPUTE_RESOLVE",
      userId: params.authorizedByUserId,
      targetType: "Order",
      targetId: order.id,
      metadata: JSON.stringify(resolution),
      ipAddress: intent.authorizationIpAddress ?? undefined,
      userAgent: intent.authorizationUserAgent ?? undefined,
    },
  });
  const finalized = await tx.legacyDisputeRefundIntent.updateMany({
    where: { id: intent.id, status: "ATTEMPTING" },
    data: {
      status: "SUCCEEDED",
      providerRefundId: params.evidence.id,
      providerStatus: params.evidence.status,
      completedAt: now,
    },
  });
  if (finalized.count !== 1) throw new Error("LEGACY_DISPUTE_REFUND_FINALIZE_FENCE_LOST");

  return { intent, order, updatedOrder, resolution };
}
