import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditLog } from "@/lib/audit";
import { payoutReadinessError } from "@/lib/payouts/readiness";
import { sourceSettlementCurrency, stripeTransferFunding } from "@/lib/payouts/stripeTransfer";
import { instantPayoutDestination } from "@/lib/payouts/instantPayout";
import {
  claimLegacyInstantPayoutCommand,
  claimLegacyPayoutTransferCommand,
  finalizeLegacyInstantPayoutCommand,
  finalizeLegacyPayoutTransferCommand,
  LegacyPayoutAuthorizationChangedError,
  markLegacyInstantPayoutReconciliationRequired,
  markLegacyPayoutTransferFailed,
  markLegacyPayoutTransferReconciliationRequired,
  stageLegacyInstantPayoutCommand,
  stageLegacyPayoutTransferCommand,
  type LegacyInstantPayoutEvidence,
  type LegacyPayoutTransferEvidence,
} from "@/lib/payouts/legacyPayoutCommands";

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY in environment.");
  return new Stripe(key, { apiVersion: "2026-01-28.clover" });
}

function orderIdFromProviderRef(providerRef: string | null) {
  return providerRef?.startsWith("order:") ? providerRef.slice("order:".length) : null;
}

function failureMessage(error: unknown, fallback: string) {
  return String(error instanceof Error ? error.message : fallback).slice(0, 1000);
}

async function bestEffortAudit(input: Parameters<typeof auditLog>[0]) {
  try {
    await auditLog(input);
  } catch (error) {
    console.error("Payout audit persistence failed after durable command finalization.", error);
  }
}

export type ProcessPayoutResult =
  | {
    ok: true;
    replay?: boolean;
    payoutId: string;
    stripeTransferId: string;
    status: "PAID";
    paidAt?: Date;
    instantPayoutStatus?: string;
  }
  | {
    ok: false;
    code: "NOT_FOUND" | "NOT_READY" | "ALREADY_PROCESSING" | "STRIPE_FAILED" | "RECONCILIATION_REQUIRED";
    message: string;
    payoutId: string;
    orderId?: string | null;
  };

type Invocation = { actorUserId: string | null; automatic: boolean };

function commandFailureResult(
  payoutId: string,
  orderId: string | null,
  status: string,
  failureReason: string | null,
): ProcessPayoutResult {
  if (status === "ATTEMPTING") {
    return {
      ok: false,
      code: "ALREADY_PROCESSING",
      message: "This payout has a claimed provider command and cannot be resent automatically.",
      payoutId,
      orderId,
    };
  }
  if (status === "RECONCILIATION_REQUIRED") {
    return {
      ok: false,
      code: "RECONCILIATION_REQUIRED",
      message: failureReason || "This payout requires provider reconciliation and cannot be resent automatically.",
      payoutId,
      orderId,
    };
  }
  return {
    ok: false,
    code: "STRIPE_FAILED",
    message: failureReason || "This payout command failed before provider mutation and is closed.",
    payoutId,
    orderId,
  };
}

async function attemptInstantPayout(
  getStripe: () => Stripe,
  transferCommandId: string,
  transferId: string,
  invocation: Invocation,
) {
  const transfer = await prisma.legacyPayoutTransferCommand.findUniqueOrThrow({
    where: { id: transferCommandId },
    include: { payout: true },
  });
  const existing = await prisma.legacyInstantPayoutCommand.findUnique({
    where: { payoutId: transfer.payoutId },
  });
  if (existing) {
    if (existing.actorUserId !== invocation.actorUserId || existing.automatic !== invocation.automatic) {
      return "PROVENANCE_MISMATCH";
    }
    if (existing.status === "SUCCEEDED") return existing.providerStatus?.toUpperCase() || "SUCCEEDED";
    if (existing.status !== "NOT_SENT") return existing.status;
  }

  const stripe = getStripe();
  let destination;
  try {
    const externalAccounts = await stripe.accounts.listExternalAccounts(transfer.connectedAccountId, { limit: 100 });
    destination = instantPayoutDestination(externalAccounts.data as Array<{ id: string; object: string; available_payout_methods?: string[]; currency?: string }>, transfer.currency);
  } catch (error) {
    const message = failureMessage(error, "Could not check Stripe Instant Payout eligibility.");
    await prisma.payout.update({
      where: { id: transfer.payoutId },
      data: { instantPayoutStatus: "FAILED", instantPayoutFailure: message },
    });
    return "FAILED";
  }
  if (!destination) {
    await prisma.payout.update({
      where: { id: transfer.payoutId },
      data: { instantPayoutStatus: "STANDARD_ONLY", instantPayoutFailure: null },
    });
    return "STANDARD_ONLY";
  }

  let command;
  try {
    command = await prisma.$transaction((tx) => stageLegacyInstantPayoutCommand(tx, {
      payoutId: transfer.payoutId,
      transferCommandId: transfer.id,
      orderId: transfer.orderId,
      paymentId: transfer.paymentId,
      sellerId: transfer.sellerId,
      connectedAccountId: transfer.connectedAccountId,
      amountCents: transfer.amountCents,
      currency: transfer.currency,
      destinationId: destination.id,
      actorUserId: invocation.actorUserId,
      automatic: invocation.automatic,
      authorizedAt: new Date(),
    }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof LegacyPayoutAuthorizationChangedError) return "PROVENANCE_MISMATCH";
    throw error;
  }
  if (command.status === "SUCCEEDED") return command.providerStatus?.toUpperCase() || "SUCCEEDED";
  if (command.status !== "NOT_SENT") return command.status;

  const claimed = await prisma.$transaction(
    (tx) => claimLegacyInstantPayoutCommand(tx, command.id),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (!claimed) return "ATTEMPTING";

  let instant: Stripe.Payout;
  try {
    instant = await stripe.payouts.create({
      amount: claimed.amountCents,
      currency: claimed.currency.toLowerCase(),
      method: "instant",
      destination: claimed.destinationId,
      metadata: {
        payoutId: claimed.payoutId,
        orderId: claimed.orderId,
        stripeTransferId: transferId,
        feePaidBy: "TRUEFANTIX",
      },
    }, {
      stripeAccount: claimed.connectedAccountId,
      idempotencyKey: claimed.idempotencyKey,
    });
  } catch (error) {
    const message = failureMessage(error, "Stripe Instant Payout outcome is unknown.");
    await prisma.$transaction((tx) => markLegacyInstantPayoutReconciliationRequired(tx, claimed.id, message));
    await bestEffortAudit({
      action: "PAYOUT_FAILED",
      userId: claimed.actorUserId || undefined,
      targetType: "Payout",
      targetId: claimed.payoutId,
      metadata: {
        action: "INSTANT_PAYOUT_RECONCILIATION_REQUIRED",
        orderId: claimed.orderId,
        stripeTransferId: transferId,
        error: message,
        automatic: claimed.automatic,
      },
    });
    return "RECONCILIATION_REQUIRED";
  }

  const evidence: LegacyInstantPayoutEvidence = {
    id: instant.id,
    status: instant.status,
    amountCents: instant.amount,
    currency: instant.currency,
    destination: typeof instant.destination === "string" ? instant.destination : instant.destination?.id || "",
    createdAt: new Date(instant.created * 1000),
  };
  try {
    await prisma.$transaction(
      (tx) => finalizeLegacyInstantPayoutCommand(tx, { commandId: claimed.id, evidence }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    const message = `Stripe Instant Payout ${instant.id} succeeded but local finalization failed: ${failureMessage(error, "unknown local error")}`;
    try {
      await prisma.$transaction((tx) => markLegacyInstantPayoutReconciliationRequired(tx, claimed.id, message, evidence));
    } catch (recordError) {
      console.error("Instant payout reconciliation evidence could not be persisted; command remains non-retryable.", recordError);
    }
    return "RECONCILIATION_REQUIRED";
  }

  await bestEffortAudit({
    action: "PAYOUT_COMPLETE",
    userId: claimed.actorUserId || undefined,
    targetType: "Payout",
    targetId: claimed.payoutId,
    metadata: {
      action: "INSTANT_PAYOUT_SENT",
      orderId: claimed.orderId,
      stripeTransferId: transferId,
      stripeInstantPayoutId: instant.id,
      amountCents: claimed.amountCents,
      currency: claimed.currency,
      feePaidBy: "TRUEFANTIX",
      automatic: claimed.automatic,
    },
  });
  return instant.status.toUpperCase();
}

export async function processStripePayout(
  payoutId: string,
  options: { actorUserId?: string; automatic?: boolean } = {},
): Promise<ProcessPayoutResult> {
  const invocation: Invocation = {
    actorUserId: options.actorUserId ?? null,
    automatic: !!options.automatic,
  };
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    include: { seller: true, legacyPayoutTransferCommand: true },
  });
  if (!payout) return { ok: false, code: "NOT_FOUND", message: "Payout not found.", payoutId };

  const orderId = orderIdFromProviderRef(payout.providerRef);
  const order = orderId
    ? await prisma.order.findUnique({ where: { id: orderId }, include: { payment: true } })
    : null;
  const existing = payout.legacyPayoutTransferCommand;
  if (existing) {
    if (existing.actorUserId !== invocation.actorUserId || existing.automatic !== invocation.automatic) {
      return {
        ok: false,
        code: "NOT_READY",
        message: "This payout command belongs to a different authorization provenance.",
        payoutId,
        orderId,
      };
    }
    if (existing.status === "SUCCEEDED" && existing.providerTransferId) {
      const instantPayoutStatus = await attemptInstantPayout(
        stripeClient,
        existing.id,
        existing.providerTransferId,
        invocation,
      );
      return {
        ok: true,
        replay: true,
        payoutId,
        stripeTransferId: existing.providerTransferId,
        status: "PAID",
        paidAt: payout.paidAt || existing.completedAt || undefined,
        instantPayoutStatus,
      };
    }
    if (existing.status !== "NOT_SENT") {
      return commandFailureResult(payoutId, orderId, existing.status, existing.failureReason);
    }
  }

  const readinessError = payoutReadinessError({ ...payout, order });
  if (readinessError) return { ok: false, code: "NOT_READY", message: readinessError, payoutId, orderId };
  if (!order?.payment || !orderId || !payout.seller.stripeAccountId) {
    return { ok: false, code: "NOT_READY", message: "Payout authorization snapshot is incomplete.", payoutId, orderId };
  }

  let stripe: Stripe | null = null;
  let command = existing;
  if (!command) {
    let funding;
    let settlementCurrency: string | null;
    try {
      stripe = stripeClient();
      const paymentIntent = await stripe.paymentIntents.retrieve(order.payment.providerRef, {
        expand: ["latest_charge.balance_transaction"],
      });
      const latestCharge = typeof paymentIntent.latest_charge === "object" ? paymentIntent.latest_charge : null;
      if (!latestCharge) throw new Error("The original Stripe charge could not be identified.");
      const payoutCurrency = order.payment.currency.toLowerCase();
      if (paymentIntent.currency !== payoutCurrency || latestCharge.currency !== payoutCurrency) {
        throw new Error(
          `Currency reconciliation required: the order is ${order.payment.currency.toUpperCase()}, but Stripe charged ${latestCharge.currency.toUpperCase()}. No payout was sent.`,
        );
      }
      funding = stripeTransferFunding(latestCharge, payoutCurrency, payout.netCents);
      settlementCurrency = sourceSettlementCurrency(latestCharge);
      if (!settlementCurrency) throw new Error("Stripe settlement currency is unavailable. No payout was sent.");
    } catch (error) {
      const message = failureMessage(error, "Stripe transfer authorization discovery failed.");
      await bestEffortAudit({
        action: "PAYOUT_FAILED",
        userId: invocation.actorUserId || undefined,
        targetType: "Payout",
        targetId: payoutId,
        metadata: { orderId, error: message, automatic: invocation.automatic, providerMutationAttempted: false },
      });
      return { ok: false, code: "STRIPE_FAILED", message, payoutId, orderId };
    }

    try {
      command = await prisma.$transaction((tx) => stageLegacyPayoutTransferCommand(tx, {
        payoutId,
        orderId,
        paymentId: order.payment!.id,
        sellerId: payout.sellerId,
        connectedAccountId: payout.seller.stripeAccountId!,
        paymentProviderRef: order.payment!.providerRef,
        amountCents: payout.netCents,
        currency: order.payment!.currency,
        transferAmountCents: funding.amount,
        transferCurrency: funding.currency,
        sourceTransaction: funding.source_transaction,
        fundingMode: funding.fundingMode,
        settlementCurrency,
        actorUserId: invocation.actorUserId,
        automatic: invocation.automatic,
        authorizedAt: new Date(),
      }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof LegacyPayoutAuthorizationChangedError) {
        return { ok: false, code: "NOT_READY", message: error.message, payoutId, orderId };
      }
      throw error;
    }
  }
  if (command.status === "SUCCEEDED" && command.providerTransferId) {
    return {
      ok: true,
      replay: true,
      payoutId,
      stripeTransferId: command.providerTransferId,
      status: "PAID",
    };
  }
  if (command.status !== "NOT_SENT") {
    return commandFailureResult(payoutId, orderId, command.status, command.failureReason);
  }

  const claimed = await prisma.$transaction(
    (tx) => claimLegacyPayoutTransferCommand(tx, command.id),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (!claimed) {
    return {
      ok: false,
      code: "ALREADY_PROCESSING",
      message: "This payout provider command has already been claimed.",
      payoutId,
      orderId,
    };
  }

  try {
    stripe ??= stripeClient();
  } catch (error) {
    const message = failureMessage(error, "Stripe transfer client initialization failed before provider mutation.");
    await prisma.$transaction((tx) => markLegacyPayoutTransferFailed(tx, claimed.id, message));
    await bestEffortAudit({
      action: "PAYOUT_FAILED",
      userId: claimed.actorUserId || undefined,
      targetType: "Payout",
      targetId: claimed.payoutId,
      metadata: { orderId: claimed.orderId, error: message, automatic: claimed.automatic, providerMutationAttempted: false },
    });
    return { ok: false, code: "STRIPE_FAILED", message, payoutId, orderId };
  }

  let transfer: Stripe.Transfer;
  try {
    transfer = await stripe.transfers.create({
      amount: claimed.transferAmountCents,
      currency: claimed.transferCurrency,
      destination: claimed.connectedAccountId,
      source_transaction: claimed.sourceTransaction,
      transfer_group: `ORDER_${claimed.orderId}`,
      metadata: {
        payoutId: claimed.payoutId,
        orderId: claimed.orderId,
        sellerId: claimed.sellerId,
        fundingMode: claimed.fundingMode,
        obligationAmount: String(claimed.amountCents),
        obligationCurrency: claimed.currency.toLowerCase(),
      },
    }, { idempotencyKey: claimed.idempotencyKey });
  } catch (error) {
    const message = failureMessage(error, "Stripe transfer outcome is unknown.");
    await prisma.$transaction((tx) => markLegacyPayoutTransferReconciliationRequired(tx, claimed.id, message));
    await bestEffortAudit({
      action: "PAYOUT_FAILED",
      userId: claimed.actorUserId || undefined,
      targetType: "Payout",
      targetId: claimed.payoutId,
      metadata: {
        action: "PAYOUT_RECONCILIATION_REQUIRED",
        orderId: claimed.orderId,
        error: message,
        automatic: claimed.automatic,
      },
    });
    return { ok: false, code: "RECONCILIATION_REQUIRED", message, payoutId, orderId };
  }

  const evidence: LegacyPayoutTransferEvidence = {
    id: transfer.id,
    amountCents: transfer.amount,
    currency: transfer.currency,
    destination: typeof transfer.destination === "string" ? transfer.destination : transfer.destination?.id || "",
    sourceTransaction: typeof transfer.source_transaction === "string"
      ? transfer.source_transaction
      : transfer.source_transaction?.id || "",
    fundingMode: claimed.fundingMode,
    settlementCurrency: claimed.settlementCurrency,
  };
  const paidAt = new Date();
  try {
    await prisma.$transaction(
      (tx) => finalizeLegacyPayoutTransferCommand(tx, { commandId: claimed.id, evidence, completedAt: paidAt }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    const message = `Stripe transfer ${transfer.id} succeeded but local finalization failed: ${failureMessage(error, "unknown local error")}`;
    try {
      await prisma.$transaction((tx) => markLegacyPayoutTransferReconciliationRequired(tx, claimed.id, message, evidence));
    } catch (recordError) {
      console.error("Payout reconciliation evidence could not be persisted; command remains non-retryable.", recordError);
    }
    return { ok: false, code: "RECONCILIATION_REQUIRED", message, payoutId, orderId };
  }

  await bestEffortAudit({
    action: "PAYOUT_COMPLETE",
    userId: claimed.actorUserId || undefined,
    targetType: "Payout",
    targetId: claimed.payoutId,
    metadata: {
      action: "PAYOUT_RELEASED",
      orderId: claimed.orderId,
      stripeTransferId: transfer.id,
      amountCents: claimed.amountCents,
      payoutCurrency: claimed.currency,
      stripeTransferAmount: claimed.transferAmountCents,
      stripeTransferCurrency: claimed.transferCurrency.toUpperCase(),
      sourceSettlementCurrency: claimed.settlementCurrency.toUpperCase(),
      fundingMode: claimed.fundingMode,
      automatic: claimed.automatic,
    },
  });

  const instantPayoutStatus = await attemptInstantPayout(
    () => stripe,
    claimed.id,
    transfer.id,
    invocation,
  );
  return {
    ok: true,
    payoutId,
    stripeTransferId: transfer.id,
    status: "PAID",
    paidAt,
    instantPayoutStatus,
  };
}
