import { createHash } from "node:crypto";
import type {
  LegacyInstantPayoutCommand,
  LegacyPayoutTransferCommand,
  Prisma,
} from "@prisma/client";

type Tx = Prisma.TransactionClient;

export class LegacyPayoutAuthorizationChangedError extends Error {}

export type LegacyPayoutTransferAuthorization = {
  payoutId: string;
  orderId: string;
  paymentId: string;
  sellerId: string;
  connectedAccountId: string;
  paymentProviderRef: string;
  amountCents: number;
  currency: string;
  transferAmountCents: number;
  transferCurrency: string;
  sourceTransaction: string;
  fundingMode: string;
  settlementCurrency: string;
  actorUserId: string | null;
  automatic: boolean;
  authorizedAt: Date;
};

export type LegacyPayoutTransferEvidence = {
  id: string;
  amountCents: number;
  currency: string;
  destination: string;
  sourceTransaction: string;
  fundingMode: string;
  settlementCurrency: string | null;
};

export type LegacyInstantPayoutAuthorization = {
  payoutId: string;
  transferCommandId: string;
  orderId: string;
  paymentId: string;
  sellerId: string;
  connectedAccountId: string;
  amountCents: number;
  currency: string;
  destinationId: string;
  actorUserId: string | null;
  automatic: boolean;
  authorizedAt: Date;
};

export type LegacyInstantPayoutEvidence = {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
  destination: string;
  createdAt: Date;
};

function digest(parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function transferDigest(input: LegacyPayoutTransferAuthorization) {
  return digest([
    "legacy-payout-transfer-v1",
    input.payoutId,
    input.orderId,
    input.paymentId,
    input.sellerId,
    input.connectedAccountId,
    input.paymentProviderRef,
    input.amountCents,
    input.currency.toUpperCase(),
    input.transferAmountCents,
    input.transferCurrency.toLowerCase(),
    input.sourceTransaction,
    input.fundingMode,
    input.settlementCurrency.toLowerCase(),
    input.actorUserId,
    input.automatic,
    input.authorizedAt.toISOString(),
    `truefantix:payout:${input.payoutId}`,
  ]);
}

function instantDigest(input: LegacyInstantPayoutAuthorization) {
  return digest([
    "legacy-instant-payout-v1",
    input.payoutId,
    input.transferCommandId,
    input.orderId,
    input.paymentId,
    input.sellerId,
    input.connectedAccountId,
    input.amountCents,
    input.currency.toUpperCase(),
    input.destinationId,
    input.actorUserId,
    input.automatic,
    input.authorizedAt.toISOString(),
    `truefantix:instant-payout:${input.payoutId}`,
  ]);
}

function storedTransferAuthorization(command: LegacyPayoutTransferCommand): LegacyPayoutTransferAuthorization {
  return {
    payoutId: command.payoutId,
    orderId: command.orderId,
    paymentId: command.paymentId,
    sellerId: command.sellerId,
    connectedAccountId: command.connectedAccountId,
    paymentProviderRef: command.paymentProviderRef,
    amountCents: command.amountCents,
    currency: command.currency,
    transferAmountCents: command.transferAmountCents,
    transferCurrency: command.transferCurrency,
    sourceTransaction: command.sourceTransaction,
    fundingMode: command.fundingMode,
    settlementCurrency: command.settlementCurrency,
    actorUserId: command.actorUserId,
    automatic: command.automatic,
    authorizedAt: command.authorizedAt,
  };
}

function storedInstantAuthorization(command: LegacyInstantPayoutCommand): LegacyInstantPayoutAuthorization {
  return {
    payoutId: command.payoutId,
    transferCommandId: command.transferCommandId,
    orderId: command.orderId,
    paymentId: command.paymentId,
    sellerId: command.sellerId,
    connectedAccountId: command.connectedAccountId,
    amountCents: command.amountCents,
    currency: command.currency,
    destinationId: command.destinationId,
    actorUserId: command.actorUserId,
    automatic: command.automatic,
    authorizedAt: command.authorizedAt,
  };
}

function assertTransferDigest(command: LegacyPayoutTransferCommand) {
  if (command.commandDigest !== transferDigest(storedTransferAuthorization(command))) {
    throw new LegacyPayoutAuthorizationChangedError("The payout transfer command digest is invalid.");
  }
}

function assertInstantDigest(command: LegacyInstantPayoutCommand) {
  if (command.commandDigest !== instantDigest(storedInstantAuthorization(command))) {
    throw new LegacyPayoutAuthorizationChangedError("The instant payout command digest is invalid.");
  }
}

function sameTransferAuthorization(command: LegacyPayoutTransferCommand, input: LegacyPayoutTransferAuthorization) {
  return command.payoutId === input.payoutId
    && command.orderId === input.orderId
    && command.paymentId === input.paymentId
    && command.sellerId === input.sellerId
    && command.connectedAccountId === input.connectedAccountId
    && command.paymentProviderRef === input.paymentProviderRef
    && command.amountCents === input.amountCents
    && command.currency === input.currency.toUpperCase()
    && command.transferAmountCents === input.transferAmountCents
    && command.transferCurrency === input.transferCurrency.toLowerCase()
    && command.sourceTransaction === input.sourceTransaction
    && command.fundingMode === input.fundingMode
    && command.settlementCurrency === input.settlementCurrency.toLowerCase()
    && command.actorUserId === input.actorUserId
    && command.automatic === input.automatic;
}

function sameInstantAuthorization(command: LegacyInstantPayoutCommand, input: LegacyInstantPayoutAuthorization) {
  return command.payoutId === input.payoutId
    && command.transferCommandId === input.transferCommandId
    && command.orderId === input.orderId
    && command.paymentId === input.paymentId
    && command.sellerId === input.sellerId
    && command.connectedAccountId === input.connectedAccountId
    && command.amountCents === input.amountCents
    && command.currency === input.currency.toUpperCase()
    && command.destinationId === input.destinationId
    && command.actorUserId === input.actorUserId
    && command.automatic === input.automatic;
}

export async function stageLegacyPayoutTransferCommand(tx: Tx, input: LegacyPayoutTransferAuthorization) {
  const existing = await tx.legacyPayoutTransferCommand.findUnique({ where: { payoutId: input.payoutId } });
  if (existing) {
    assertTransferDigest(existing);
    if (!sameTransferAuthorization(existing, input)) {
      throw new LegacyPayoutAuthorizationChangedError(
        "The payout transfer request does not match its persisted authorization provenance.",
      );
    }
    return existing;
  }

  const staged = await tx.payout.updateMany({
    where: { id: input.payoutId, status: "PENDING", stripeTransferId: null },
    data: { status: "PROCESSING", failureReason: null },
  });
  if (staged.count !== 1) {
    throw new LegacyPayoutAuthorizationChangedError(
      "The legacy payout state is not eligible for a new provider command.",
    );
  }
  return tx.legacyPayoutTransferCommand.create({
    data: {
      ...input,
      currency: input.currency.toUpperCase(),
      transferCurrency: input.transferCurrency.toLowerCase(),
      settlementCurrency: input.settlementCurrency.toLowerCase(),
      commandDigest: transferDigest(input),
      idempotencyKey: `truefantix:payout:${input.payoutId}`,
    },
  });
}

export async function claimLegacyPayoutTransferCommand(
  tx: Tx,
  commandId: string,
  dispatchStartedAt = new Date(),
) {
  const current = await tx.legacyPayoutTransferCommand.findUnique({ where: { id: commandId } });
  if (!current || current.status !== "NOT_SENT") return null;
  assertTransferDigest(current);
  const claimed = await tx.legacyPayoutTransferCommand.updateMany({
    where: { id: current.id, status: "NOT_SENT", commandDigest: current.commandDigest },
    data: { status: "ATTEMPTING", dispatchStartedAt },
  });
  if (claimed.count !== 1) return null;
  await tx.payout.update({
    where: { id: current.payoutId },
    data: { attemptCount: { increment: 1 }, lastAttemptAt: dispatchStartedAt },
  });
  return tx.legacyPayoutTransferCommand.findUniqueOrThrow({ where: { id: current.id } });
}

export function assertLegacyPayoutTransferEvidence(
  command: LegacyPayoutTransferCommand,
  evidence: LegacyPayoutTransferEvidence,
) {
  assertLegacyPayoutTransferEvidenceShape(evidence);
  if (evidence.amountCents !== command.transferAmountCents
    || evidence.currency !== command.transferCurrency
    || !evidence.currency.match(/^[a-z]{3}$/)
    || evidence.destination !== command.connectedAccountId
    || evidence.sourceTransaction !== command.sourceTransaction
    || evidence.fundingMode !== command.fundingMode
    || evidence.settlementCurrency !== command.settlementCurrency) {
    throw new Error("LEGACY_PAYOUT_TRANSFER_PROVIDER_EVIDENCE_MISMATCH");
  }
}

function assertLegacyPayoutTransferEvidenceShape(evidence: LegacyPayoutTransferEvidence) {
  if (!evidence.id.trim()
    || evidence.amountCents <= 0
    || !evidence.currency.match(/^[a-z]{3}$/)
    || !evidence.destination.trim()
    || !evidence.sourceTransaction.trim()
    || !evidence.fundingMode.trim()
    || (evidence.settlementCurrency !== null && !evidence.settlementCurrency.match(/^[a-z]{3}$/))) {
    throw new Error("LEGACY_PAYOUT_TRANSFER_PROVIDER_EVIDENCE_INVALID");
  }
}

export async function markLegacyPayoutTransferFailed(
  tx: Tx,
  commandId: string,
  failureReason: string,
  completedAt = new Date(),
) {
  const command = await tx.legacyPayoutTransferCommand.findUnique({ where: { id: commandId } });
  if (!command) return { count: 0 };
  const updated = await tx.legacyPayoutTransferCommand.updateMany({
    where: { id: commandId, status: "ATTEMPTING" },
    data: { status: "FAILED", failureReason, completedAt },
  });
  if (updated.count === 1) {
    await tx.payout.update({ where: { id: command.payoutId }, data: { failureReason } });
  }
  return updated;
}

export async function markLegacyPayoutTransferReconciliationRequired(
  tx: Tx,
  commandId: string,
  failureReason: string,
  evidence?: LegacyPayoutTransferEvidence,
  completedAt = new Date(),
) {
  const command = await tx.legacyPayoutTransferCommand.findUnique({ where: { id: commandId } });
  if (!command) return { count: 0 };
  if (evidence) assertLegacyPayoutTransferEvidenceShape(evidence);
  const updated = await tx.legacyPayoutTransferCommand.updateMany({
    where: { id: commandId, status: "ATTEMPTING" },
    data: {
      status: "RECONCILIATION_REQUIRED",
      providerTransferId: evidence?.id,
      providerAmountCents: evidence?.amountCents,
      providerCurrency: evidence?.currency,
      providerDestination: evidence?.destination,
      providerSourceTransaction: evidence?.sourceTransaction,
      providerFundingMode: evidence?.fundingMode,
      providerSettlementCurrency: evidence?.settlementCurrency,
      failureReason,
      completedAt,
    },
  });
  if (updated.count === 1) {
    await tx.payout.update({ where: { id: command.payoutId }, data: { failureReason } });
  }
  return updated;
}

export async function finalizeLegacyPayoutTransferCommand(
  tx: Tx,
  params: { commandId: string; evidence: LegacyPayoutTransferEvidence; completedAt?: Date },
) {
  const completedAt = params.completedAt ?? new Date();
  await tx.$queryRaw`SELECT "id" FROM "LegacyPayoutTransferCommand" WHERE "id" = ${params.commandId} FOR UPDATE`;
  const command = await tx.legacyPayoutTransferCommand.findUniqueOrThrow({ where: { id: params.commandId } });
  if (command.status !== "ATTEMPTING") throw new Error("LEGACY_PAYOUT_TRANSFER_NOT_OWNED");
  assertTransferDigest(command);
  assertLegacyPayoutTransferEvidence(command, params.evidence);

  await tx.$queryRaw`SELECT "id" FROM "Payout" WHERE "id" = ${command.payoutId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${command.orderId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${command.paymentId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Seller" WHERE "id" = ${command.sellerId} FOR UPDATE`;
  const [payout, order, payment, seller] = await Promise.all([
    tx.payout.findUnique({ where: { id: command.payoutId } }),
    tx.order.findUnique({ where: { id: command.orderId } }),
    tx.payment.findUnique({ where: { id: command.paymentId } }),
    tx.seller.findUnique({ where: { id: command.sellerId } }),
  ]);
  if (!payout || !order || !payment || !seller
    || payout.status !== "PROCESSING"
    || payout.stripeTransferId !== null
    || payout.sellerId !== command.sellerId
    || payout.netCents !== command.amountCents
    || payout.providerRef !== `order:${command.orderId}`
    || order.status !== "COMPLETED"
    || order.sellerId !== command.sellerId
    || payment.orderId !== command.orderId
    || payment.status !== "SUCCEEDED"
    || payment.provider !== "STRIPE"
    || payment.providerRef !== command.paymentProviderRef
    || payment.currency.toUpperCase() !== command.currency
    || seller.stripeAccountId !== command.connectedAccountId) {
    throw new Error("LEGACY_PAYOUT_TRANSFER_SCOPE_CHANGED");
  }

  await tx.payout.update({
    where: { id: command.payoutId },
    data: {
      status: "PAID",
      provider: "STRIPE_CONNECT_TRANSFER",
      stripeTransferId: params.evidence.id,
      failureReason: null,
      paidAt: completedAt,
    },
  });
  const finalized = await tx.legacyPayoutTransferCommand.updateMany({
    where: { id: command.id, status: "ATTEMPTING" },
    data: {
      status: "SUCCEEDED",
      providerTransferId: params.evidence.id,
      providerAmountCents: params.evidence.amountCents,
      providerCurrency: params.evidence.currency,
      providerDestination: params.evidence.destination,
      providerSourceTransaction: params.evidence.sourceTransaction,
      providerFundingMode: params.evidence.fundingMode,
      providerSettlementCurrency: params.evidence.settlementCurrency,
      completedAt,
    },
  });
  if (finalized.count !== 1) throw new Error("LEGACY_PAYOUT_TRANSFER_FINALIZE_FENCE_LOST");
  return { command, payout, order, payment, seller };
}

export async function stageLegacyInstantPayoutCommand(tx: Tx, input: LegacyInstantPayoutAuthorization) {
  const existing = await tx.legacyInstantPayoutCommand.findUnique({ where: { payoutId: input.payoutId } });
  if (existing) {
    assertInstantDigest(existing);
    if (!sameInstantAuthorization(existing, input)) {
      throw new LegacyPayoutAuthorizationChangedError(
        "The instant payout request does not match its persisted transfer provenance.",
      );
    }
    return existing;
  }
  return tx.legacyInstantPayoutCommand.create({
    data: {
      ...input,
      currency: input.currency.toUpperCase(),
      commandDigest: instantDigest(input),
      idempotencyKey: `truefantix:instant-payout:${input.payoutId}`,
    },
  });
}

export async function claimLegacyInstantPayoutCommand(
  tx: Tx,
  commandId: string,
  dispatchStartedAt = new Date(),
) {
  const current = await tx.legacyInstantPayoutCommand.findUnique({ where: { id: commandId } });
  if (!current || current.status !== "NOT_SENT") return null;
  assertInstantDigest(current);
  const claimed = await tx.legacyInstantPayoutCommand.updateMany({
    where: { id: current.id, status: "NOT_SENT", commandDigest: current.commandDigest },
    data: { status: "ATTEMPTING", dispatchStartedAt },
  });
  if (claimed.count !== 1) return null;
  return tx.legacyInstantPayoutCommand.findUniqueOrThrow({ where: { id: current.id } });
}

function assertLegacyInstantPayoutEvidence(
  command: LegacyInstantPayoutCommand,
  evidence: LegacyInstantPayoutEvidence,
) {
  assertLegacyInstantPayoutEvidenceShape(evidence);
  if (evidence.amountCents !== command.amountCents
    || evidence.currency !== command.currency.toLowerCase()
    || evidence.destination !== command.destinationId) {
    throw new Error("LEGACY_INSTANT_PAYOUT_PROVIDER_EVIDENCE_MISMATCH");
  }
}

function assertLegacyInstantPayoutEvidenceShape(evidence: LegacyInstantPayoutEvidence) {
  if (!evidence.id.trim()
    || !evidence.status.trim()
    || evidence.amountCents <= 0
    || !evidence.currency.match(/^[a-z]{3}$/)
    || !evidence.destination.trim()) {
    throw new Error("LEGACY_INSTANT_PAYOUT_PROVIDER_EVIDENCE_INVALID");
  }
}

export async function markLegacyInstantPayoutFailed(
  tx: Tx,
  commandId: string,
  failureReason: string,
  completedAt = new Date(),
) {
  const command = await tx.legacyInstantPayoutCommand.findUnique({ where: { id: commandId } });
  if (!command) return { count: 0 };
  const updated = await tx.legacyInstantPayoutCommand.updateMany({
    where: { id: commandId, status: "ATTEMPTING" },
    data: { status: "FAILED", failureReason, completedAt },
  });
  if (updated.count === 1) {
    await tx.payout.update({
      where: { id: command.payoutId },
      data: { instantPayoutStatus: "FAILED", instantPayoutFailure: failureReason },
    });
  }
  return updated;
}

export async function markLegacyInstantPayoutReconciliationRequired(
  tx: Tx,
  commandId: string,
  failureReason: string,
  evidence?: LegacyInstantPayoutEvidence,
  completedAt = new Date(),
) {
  const command = await tx.legacyInstantPayoutCommand.findUnique({ where: { id: commandId } });
  if (!command) return { count: 0 };
  if (evidence) assertLegacyInstantPayoutEvidenceShape(evidence);
  const updated = await tx.legacyInstantPayoutCommand.updateMany({
    where: { id: commandId, status: "ATTEMPTING" },
    data: {
      status: "RECONCILIATION_REQUIRED",
      providerPayoutId: evidence?.id,
      providerStatus: evidence?.status,
      providerAmountCents: evidence?.amountCents,
      providerCurrency: evidence?.currency,
      providerDestination: evidence?.destination,
      failureReason,
      completedAt,
    },
  });
  if (updated.count === 1) {
    await tx.payout.update({
      where: { id: command.payoutId },
      data: { instantPayoutStatus: "RECONCILIATION_REQUIRED", instantPayoutFailure: failureReason },
    });
  }
  return updated;
}

export async function finalizeLegacyInstantPayoutCommand(
  tx: Tx,
  params: { commandId: string; evidence: LegacyInstantPayoutEvidence; completedAt?: Date },
) {
  const completedAt = params.completedAt ?? new Date();
  await tx.$queryRaw`SELECT "id" FROM "LegacyInstantPayoutCommand" WHERE "id" = ${params.commandId} FOR UPDATE`;
  const command = await tx.legacyInstantPayoutCommand.findUniqueOrThrow({ where: { id: params.commandId } });
  if (command.status !== "ATTEMPTING") throw new Error("LEGACY_INSTANT_PAYOUT_NOT_OWNED");
  assertInstantDigest(command);
  assertLegacyInstantPayoutEvidence(command, params.evidence);
  const transfer = await tx.legacyPayoutTransferCommand.findUniqueOrThrow({
    where: { id: command.transferCommandId },
  });
  if (transfer.status !== "SUCCEEDED"
    || transfer.payoutId !== command.payoutId
    || transfer.actorUserId !== command.actorUserId
    || transfer.automatic !== command.automatic) {
    throw new Error("LEGACY_INSTANT_PAYOUT_TRANSFER_CHANGED");
  }
  const payout = await tx.payout.findUniqueOrThrow({ where: { id: command.payoutId } });
  if (payout.status !== "PAID"
    || payout.stripeTransferId !== transfer.providerTransferId
    || payout.stripeInstantPayoutId !== null) {
    throw new Error("LEGACY_INSTANT_PAYOUT_SCOPE_CHANGED");
  }
  await tx.payout.update({
    where: { id: command.payoutId },
    data: {
      stripeInstantPayoutId: params.evidence.id,
      instantPayoutStatus: params.evidence.status.toUpperCase(),
      instantPayoutAt: params.evidence.createdAt,
      instantPayoutFailure: null,
    },
  });
  const finalized = await tx.legacyInstantPayoutCommand.updateMany({
    where: { id: command.id, status: "ATTEMPTING" },
    data: {
      status: "SUCCEEDED",
      providerPayoutId: params.evidence.id,
      providerStatus: params.evidence.status,
      providerAmountCents: params.evidence.amountCents,
      providerCurrency: params.evidence.currency,
      providerDestination: params.evidence.destination,
      completedAt,
    },
  });
  if (finalized.count !== 1) throw new Error("LEGACY_INSTANT_PAYOUT_FINALIZE_FENCE_LOST");
  return { command, transfer, payout };
}
