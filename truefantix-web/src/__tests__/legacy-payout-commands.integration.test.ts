/** @jest-environment node */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
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

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) describe.skip("legacy payout PostgreSQL boundary", () => {
  it("requires an isolated database", () => undefined);
}); else describe("legacy payout PostgreSQL boundary", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const runId = `${Date.now()}-${process.pid}`;
  const sellerId = `payout-seller-${runId}`;
  const buyerSellerId = `payout-buyer-${runId}`;
  const orderId = `payout-order-${runId}`;
  const paymentId = `payout-payment-${runId}`;
  const payoutId = `payout-${runId}`;
  const actorUserId = `payout-actor-${runId}`;
  const amountCents = 5_000;
  const connectedAccountId = `acct_synthetic_${runId}`;

  const transferEvidence: LegacyPayoutTransferEvidence = {
    id: `tr_synthetic_${runId}`,
    amountCents,
    currency: "cad",
    destination: connectedAccountId,
    sourceTransaction: `ch_synthetic_${runId}`,
    fundingMode: "SOURCE_TRANSACTION",
    settlementCurrency: "cad",
  };

  const instantEvidence: LegacyInstantPayoutEvidence = {
    id: `po_synthetic_${runId}`,
    status: "paid",
    amountCents,
    currency: "cad",
    destination: `ba_synthetic_${runId}`,
    createdAt: new Date("2026-09-15T23:00:00.000Z"),
  };

  function transferAuthorization() {
    return {
      payoutId,
      orderId,
      paymentId,
      sellerId,
      connectedAccountId,
      paymentProviderRef: `pi_synthetic_${runId}`,
      amountCents,
      currency: "CAD",
      transferAmountCents: amountCents,
      transferCurrency: "cad",
      sourceTransaction: transferEvidence.sourceTransaction,
      fundingMode: transferEvidence.fundingMode,
      settlementCurrency: "cad",
      actorUserId,
      automatic: true,
      authorizedAt: new Date(),
    };
  }

  async function stageTransfer() {
    return db.$transaction((tx) => stageLegacyPayoutTransferCommand(tx, transferAuthorization()), {
      isolationLevel: "Serializable",
    });
  }

  async function succeedTransfer() {
    const command = await stageTransfer();
    await db.$transaction((tx) => claimLegacyPayoutTransferCommand(tx, command.id));
    await db.$transaction((tx) => finalizeLegacyPayoutTransferCommand(tx, {
      commandId: command.id,
      evidence: transferEvidence,
      completedAt: new Date("2026-09-15T22:59:00.000Z"),
    }));
    return db.legacyPayoutTransferCommand.findUniqueOrThrow({ where: { id: command.id } });
  }

  async function forceDeleteCommands() {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.legacyInstantPayoutCommand.deleteMany({ where: { payoutId } });
      await tx.legacyPayoutTransferCommand.deleteMany({ where: { payoutId } });
    });
  }

  beforeAll(async () => {
    await db.seller.createMany({ data: [
      {
        id: sellerId,
        name: "Synthetic Payout Seller",
        status: "APPROVED",
        stripeAccountId: connectedAccountId,
        stripeDetailsSubmitted: true,
        stripePayoutsEnabled: true,
      },
      { id: buyerSellerId, name: "Synthetic Payout Buyer" },
    ] });
    await db.order.create({ data: {
      id: orderId,
      sellerId,
      buyerSellerId,
      status: "COMPLETED",
      amountCents,
      adminFeeCents: 0,
      totalCents: amountCents,
      currency: "CAD",
      buyerConfirmationStatus: "CONFIRMED",
      buyerConfirmationAt: new Date(),
      transferVerificationStatus: "MATCHED",
    } });
    await db.payment.create({ data: {
      id: paymentId,
      orderId,
      amountCents,
      currency: "CAD",
      status: "SUCCEEDED",
      provider: "STRIPE",
      providerRef: `pi_synthetic_${runId}`,
    } });
    await db.payout.create({ data: {
      id: payoutId,
      sellerId,
      amountCents,
      feeCents: 0,
      netCents: amountCents,
      status: "PENDING",
      provider: "ESCROW_INTERNAL",
      providerRef: `order:${orderId}`,
    } });
  });

  beforeEach(async () => {
    await forceDeleteCommands();
    await db.payout.update({ where: { id: payoutId }, data: {
      status: "PENDING",
      provider: "ESCROW_INTERNAL",
      stripeTransferId: null,
      stripeInstantPayoutId: null,
      instantPayoutStatus: null,
      instantPayoutAt: null,
      instantPayoutFailure: null,
      failureReason: null,
      attemptCount: 0,
      lastAttemptAt: null,
      paidAt: null,
    } });
  });

  afterAll(async () => {
    await forceDeleteCommands();
    await db.payout.delete({ where: { id: payoutId } });
    await db.payment.delete({ where: { id: paymentId } });
    await db.order.delete({ where: { id: orderId } });
    await db.seller.deleteMany({ where: { id: { in: [sellerId, buyerSellerId] } } });
    await db.$disconnect();
    await pool.end();
  });

  it("commits authorization before one concurrent dispatch winner and never reclaims it", async () => {
    const command = await stageTransfer();
    await expect(db.payout.findUniqueOrThrow({ where: { id: payoutId } }))
      .resolves.toMatchObject({ status: "PROCESSING", attemptCount: 0 });
    const claims = await Promise.all([
      db.$transaction((tx) => claimLegacyPayoutTransferCommand(tx, command.id)),
      db.$transaction((tx) => claimLegacyPayoutTransferCommand(tx, command.id)),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await expect(db.$transaction((tx) => claimLegacyPayoutTransferCommand(
      tx,
      command.id,
      new Date("2099-01-01T00:00:00.000Z"),
    ))).resolves.toBeNull();
    await expect(db.payout.findUniqueOrThrow({ where: { id: payoutId } }))
      .resolves.toMatchObject({ status: "PROCESSING", attemptCount: 1 });
  });

  it("rejects automatic/manual provenance adoption before a claim", async () => {
    await stageTransfer();
    await expect(db.$transaction((tx) => stageLegacyPayoutTransferCommand(tx, {
      ...transferAuthorization(),
      actorUserId: null,
      automatic: false,
    }))).rejects.toBeInstanceOf(LegacyPayoutAuthorizationChangedError);
    await expect(db.legacyPayoutTransferCommand.findUniqueOrThrow({ where: { payoutId } }))
      .resolves.toMatchObject({ status: "NOT_SENT", automatic: true, actorUserId });
  });

  it("rejects changed provider transfer scope after staging", async () => {
    await stageTransfer();
    await expect(db.$transaction((tx) => stageLegacyPayoutTransferCommand(tx, {
      ...transferAuthorization(),
      sourceTransaction: `ch_changed_${runId}`,
    }))).rejects.toBeInstanceOf(LegacyPayoutAuthorizationChangedError);
    await expect(db.legacyPayoutTransferCommand.findUniqueOrThrow({ where: { payoutId } }))
      .resolves.toMatchObject({
        status: "NOT_SENT",
        transferAmountCents: amountCents,
        transferCurrency: "cad",
        sourceTransaction: transferEvidence.sourceTransaction,
        fundingMode: transferEvidence.fundingMode,
        settlementCurrency: "cad",
      });
  });

  it("keeps authenticated pre-provider failure terminal and non-dispatchable", async () => {
    const command = await stageTransfer();
    await db.$transaction((tx) => claimLegacyPayoutTransferCommand(tx, command.id));
    await db.$transaction((tx) => markLegacyPayoutTransferFailed(tx, command.id, "synthetic pre-provider refusal"));
    await expect(db.legacyPayoutTransferCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({ status: "FAILED", providerTransferId: null });
    await expect(db.payout.findUniqueOrThrow({ where: { id: payoutId } }))
      .resolves.toMatchObject({ status: "PROCESSING", stripeTransferId: null });
    await expect(db.$transaction((tx) => claimLegacyPayoutTransferCommand(tx, command.id))).resolves.toBeNull();
  });

  it("quarantines an unknown transfer outcome without changing the legacy payout to retryable FAILED", async () => {
    const command = await stageTransfer();
    await db.$transaction((tx) => claimLegacyPayoutTransferCommand(tx, command.id));
    await db.$transaction((tx) => markLegacyPayoutTransferReconciliationRequired(
      tx,
      command.id,
      "synthetic provider timeout",
    ));
    await expect(db.legacyPayoutTransferCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({ status: "RECONCILIATION_REQUIRED", providerTransferId: null });
    await expect(db.payout.findUniqueOrThrow({ where: { id: payoutId } }))
      .resolves.toMatchObject({ status: "PROCESSING", stripeTransferId: null });
  });

  it("rejects partial immutable transfer reconciliation evidence", async () => {
    const command = await stageTransfer();
    await db.$transaction((tx) => claimLegacyPayoutTransferCommand(tx, command.id));
    await expect(db.legacyPayoutTransferCommand.update({
      where: { id: command.id },
      data: {
        status: "RECONCILIATION_REQUIRED",
        providerTransferId: `tr_partial_${runId}`,
        failureReason: "synthetic partial transfer evidence",
        completedAt: new Date(),
      },
    })).rejects.toThrow("Invalid legacy payout transfer terminal evidence");
    await expect(db.legacyPayoutTransferCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({ status: "ATTEMPTING", providerTransferId: null });
  });

  it("finalizes exact transfer evidence once and replays without another claim", async () => {
    const command = await succeedTransfer();
    await expect(db.payout.findUniqueOrThrow({ where: { id: payoutId } })).resolves.toMatchObject({
      status: "PAID",
      stripeTransferId: transferEvidence.id,
      attemptCount: 1,
    });
    const replay = await db.$transaction((tx) => stageLegacyPayoutTransferCommand(tx, {
      ...transferAuthorization(),
      authorizedAt: new Date(),
    }));
    expect(replay.id).toBe(command.id);
    expect(replay.status).toBe("SUCCEEDED");
    await expect(db.$transaction((tx) => claimLegacyPayoutTransferCommand(tx, command.id))).resolves.toBeNull();
  });

  it("refuses mismatched returned transfer evidence and preserves it for reconciliation", async () => {
    const command = await stageTransfer();
    await db.$transaction((tx) => claimLegacyPayoutTransferCommand(tx, command.id));
    const mismatchedEvidence = {
      ...transferEvidence,
      currency: "usd",
      sourceTransaction: `ch_returned_other_${runId}`,
    };
    await expect(db.$transaction((tx) => finalizeLegacyPayoutTransferCommand(tx, {
      commandId: command.id,
      evidence: mismatchedEvidence,
    }))).rejects.toThrow("LEGACY_PAYOUT_TRANSFER_PROVIDER_EVIDENCE_MISMATCH");
    await db.$transaction((tx) => markLegacyPayoutTransferReconciliationRequired(
      tx,
      command.id,
      "synthetic returned evidence mismatch",
      mismatchedEvidence,
    ));
    await expect(db.legacyPayoutTransferCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({
        status: "RECONCILIATION_REQUIRED",
        providerCurrency: "usd",
        providerSourceTransaction: `ch_returned_other_${runId}`,
      });
    await expect(db.payout.findUniqueOrThrow({ where: { id: payoutId } }))
      .resolves.toMatchObject({ status: "PROCESSING", stripeTransferId: null });
  });

  it("preserves the completed transfer when instant payout becomes ambiguous", async () => {
    const transfer = await succeedTransfer();
    const instant = await db.$transaction((tx) => stageLegacyInstantPayoutCommand(tx, {
      payoutId,
      transferCommandId: transfer.id,
      orderId,
      paymentId,
      sellerId,
      connectedAccountId,
      amountCents,
      currency: "CAD",
      destinationId: instantEvidence.destination,
      actorUserId,
      automatic: true,
      authorizedAt: new Date(),
    }));
    await db.$transaction((tx) => claimLegacyInstantPayoutCommand(tx, instant.id));
    await db.$transaction((tx) => markLegacyInstantPayoutReconciliationRequired(
      tx,
      instant.id,
      "synthetic instant payout timeout",
    ));
    await expect(db.payout.findUniqueOrThrow({ where: { id: payoutId } })).resolves.toMatchObject({
      status: "PAID",
      stripeTransferId: transferEvidence.id,
      stripeInstantPayoutId: null,
      instantPayoutStatus: "RECONCILIATION_REQUIRED",
    });
  });

  it("rejects partial instant evidence and accepts complete mismatched reconciliation evidence", async () => {
    const transfer = await succeedTransfer();
    const instant = await db.$transaction((tx) => stageLegacyInstantPayoutCommand(tx, {
      payoutId,
      transferCommandId: transfer.id,
      orderId,
      paymentId,
      sellerId,
      connectedAccountId,
      amountCents,
      currency: "CAD",
      destinationId: instantEvidence.destination,
      actorUserId,
      automatic: true,
      authorizedAt: new Date(),
    }));
    await db.$transaction((tx) => claimLegacyInstantPayoutCommand(tx, instant.id));
    await expect(db.legacyInstantPayoutCommand.update({
      where: { id: instant.id },
      data: {
        status: "RECONCILIATION_REQUIRED",
        providerPayoutId: `po_partial_${runId}`,
        failureReason: "synthetic partial instant evidence",
        completedAt: new Date(),
      },
    })).rejects.toThrow("Invalid legacy instant payout terminal evidence");
    const mismatchedEvidence = {
      ...instantEvidence,
      id: `po_mismatched_${runId}`,
      amountCents: amountCents + 1,
      currency: "usd",
      destination: `ba_other_${runId}`,
    };
    await db.$transaction((tx) => markLegacyInstantPayoutReconciliationRequired(
      tx,
      instant.id,
      "synthetic complete instant mismatch",
      mismatchedEvidence,
    ));
    await expect(db.legacyInstantPayoutCommand.findUniqueOrThrow({ where: { id: instant.id } }))
      .resolves.toMatchObject({
        status: "RECONCILIATION_REQUIRED",
        providerPayoutId: mismatchedEvidence.id,
        providerAmountCents: amountCents + 1,
        providerCurrency: "usd",
        providerDestination: mismatchedEvidence.destination,
      });
  });

  it("finalizes instant payout only under the succeeded transfer provenance", async () => {
    const transfer = await succeedTransfer();
    const instant = await db.$transaction((tx) => stageLegacyInstantPayoutCommand(tx, {
      payoutId,
      transferCommandId: transfer.id,
      orderId,
      paymentId,
      sellerId,
      connectedAccountId,
      amountCents,
      currency: "CAD",
      destinationId: instantEvidence.destination,
      actorUserId,
      automatic: true,
      authorizedAt: new Date(),
    }));
    await db.$transaction((tx) => claimLegacyInstantPayoutCommand(tx, instant.id));
    await db.$transaction((tx) => finalizeLegacyInstantPayoutCommand(tx, {
      commandId: instant.id,
      evidence: instantEvidence,
    }));
    await expect(db.payout.findUniqueOrThrow({ where: { id: payoutId } })).resolves.toMatchObject({
      status: "PAID",
      stripeTransferId: transferEvidence.id,
      stripeInstantPayoutId: instantEvidence.id,
      instantPayoutStatus: "PAID",
    });
  });

  it("rejects immutable evidence changes, delete, truncate, and legacy status reclaim", async () => {
    const command = await stageTransfer();
    await expect(db.legacyPayoutTransferCommand.update({
      where: { id: command.id },
      data: { actorUserId: `different-${actorUserId}` },
    })).rejects.toThrow();
    await expect(db.legacyPayoutTransferCommand.delete({ where: { id: command.id } })).rejects.toThrow();
    await expect(db.$executeRawUnsafe('TRUNCATE TABLE "LegacyPayoutTransferCommand"')).rejects.toThrow();
    await expect(db.payout.update({
      where: { id: payoutId },
      data: { status: "FAILED" },
    })).rejects.toThrow();
    await db.$transaction((tx) => claimLegacyPayoutTransferCommand(tx, command.id));
    await expect(db.$transaction((tx) => tx.payout.update({
      where: { id: payoutId },
      data: { status: "PAID", stripeTransferId: transferEvidence.id, paidAt: new Date() },
    }))).rejects.toThrow("Command-owned payout success projection is incomplete");
    await expect(db.payout.findUniqueOrThrow({ where: { id: payoutId } }))
      .resolves.toMatchObject({ status: "PROCESSING", stripeTransferId: null });
  });

  it("rejects an instant payout projection without the matching command success", async () => {
    const transfer = await succeedTransfer();
    const instant = await db.$transaction((tx) => stageLegacyInstantPayoutCommand(tx, {
      payoutId,
      transferCommandId: transfer.id,
      orderId,
      paymentId,
      sellerId,
      connectedAccountId,
      amountCents,
      currency: "CAD",
      destinationId: instantEvidence.destination,
      actorUserId,
      automatic: true,
      authorizedAt: new Date(),
    }));
    await db.$transaction((tx) => claimLegacyInstantPayoutCommand(tx, instant.id));
    await expect(db.$transaction((tx) => tx.payout.update({
      where: { id: payoutId },
      data: {
        stripeInstantPayoutId: instantEvidence.id,
        instantPayoutStatus: "PAID",
        instantPayoutAt: instantEvidence.createdAt,
      },
    }))).rejects.toThrow("Command-owned instant payout success projection is incomplete");
  });
});
