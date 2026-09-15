/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import {
  claimLegacyPayoutTransferCommand,
  finalizeLegacyPayoutTransferCommand,
  markLegacyPayoutTransferFailed,
  markLegacyPayoutTransferReconciliationRequired,
  stageLegacyPayoutTransferCommand,
} from "@/lib/payouts/legacyPayoutCommands";
import { processStripePayout } from "@/lib/payouts/processStripePayout";

const mockRetrieve = jest.fn();
const mockTransferCreate = jest.fn();
const mockPayoutCreate = jest.fn();
const mockListExternalAccounts = jest.fn();

jest.mock("stripe", () => jest.fn().mockImplementation(() => ({
  paymentIntents: { retrieve: mockRetrieve },
  transfers: { create: mockTransferCreate },
  payouts: { create: mockPayoutCreate },
  accounts: { listExternalAccounts: mockListExternalAccounts },
})));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    payout: { findUnique: jest.fn(), update: jest.fn() },
    order: { findUnique: jest.fn() },
    legacyPayoutTransferCommand: { findUniqueOrThrow: jest.fn() },
    legacyInstantPayoutCommand: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/payouts/legacyPayoutCommands", () => ({
  LegacyPayoutAuthorizationChangedError: class LegacyPayoutAuthorizationChangedError extends Error {},
  stageLegacyPayoutTransferCommand: jest.fn(),
  claimLegacyPayoutTransferCommand: jest.fn(),
  finalizeLegacyPayoutTransferCommand: jest.fn(),
  markLegacyPayoutTransferFailed: jest.fn(),
  markLegacyPayoutTransferReconciliationRequired: jest.fn(),
  stageLegacyInstantPayoutCommand: jest.fn(),
  claimLegacyInstantPayoutCommand: jest.fn(),
  finalizeLegacyInstantPayoutCommand: jest.fn(),
  markLegacyInstantPayoutReconciliationRequired: jest.fn(),
}));

jest.mock("@/lib/audit", () => ({ auditLog: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  payout: { findUnique: jest.Mock; update: jest.Mock };
  order: { findUnique: jest.Mock };
  legacyPayoutTransferCommand: { findUniqueOrThrow: jest.Mock };
  legacyInstantPayoutCommand: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};
const mockedStage = stageLegacyPayoutTransferCommand as jest.MockedFunction<typeof stageLegacyPayoutTransferCommand>;
const mockedClaim = claimLegacyPayoutTransferCommand as jest.MockedFunction<typeof claimLegacyPayoutTransferCommand>;
const mockedFinalize = finalizeLegacyPayoutTransferCommand as jest.MockedFunction<typeof finalizeLegacyPayoutTransferCommand>;
const mockedFailed = markLegacyPayoutTransferFailed as jest.MockedFunction<typeof markLegacyPayoutTransferFailed>;
const mockedReconciliation = markLegacyPayoutTransferReconciliationRequired as jest.MockedFunction<typeof markLegacyPayoutTransferReconciliationRequired>;

const payoutId = "payout-command-test";
const orderId = "order-command-test";
const actorUserId = "actor-command-test";
const command = {
  id: "command-1",
  payoutId,
  orderId,
  paymentId: "payment-1",
  sellerId: "seller-1",
  connectedAccountId: "acct_synthetic",
  paymentProviderRef: "pi_synthetic",
  amountCents: 5_000,
  currency: "CAD",
  transferAmountCents: 5_000,
  transferCurrency: "cad",
  sourceTransaction: "ch_synthetic",
  fundingMode: "SOURCE_LINKED",
  settlementCurrency: "cad",
  actorUserId,
  automatic: true,
  commandDigest: "a".repeat(64),
  idempotencyKey: `truefantix:payout:${payoutId}`,
  status: "NOT_SENT",
  dispatchStartedAt: null,
  providerTransferId: null,
  providerAmountCents: null,
  providerCurrency: null,
  providerDestination: null,
  providerSourceTransaction: null,
  providerFundingMode: null,
  providerSettlementCurrency: null,
  failureReason: null,
  authorizedAt: new Date("2026-09-15T23:00:00.000Z"),
  completedAt: null,
  createdAt: new Date("2026-09-15T23:00:00.000Z"),
  updatedAt: new Date("2026-09-15T23:00:00.000Z"),
} as const;

const payout = {
  id: payoutId,
  sellerId: "seller-1",
  amountCents: 5_000,
  feeCents: 0,
  netCents: 5_000,
  status: "PENDING",
  provider: "ESCROW_INTERNAL",
  providerRef: `order:${orderId}`,
  stripeTransferId: null,
  stripeInstantPayoutId: null,
  instantPayoutStatus: null,
  instantPayoutAt: null,
  instantPayoutFailure: null,
  failureReason: null,
  attemptCount: 0,
  lastAttemptAt: null,
  paidAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  seller: {
    id: "seller-1",
    status: "APPROVED",
    payoutHold: false,
    stripeAccountId: "acct_synthetic",
    stripeDetailsSubmitted: true,
    stripePayoutsEnabled: true,
  },
  legacyPayoutTransferCommand: null,
};

const order = {
  id: orderId,
  sellerId: "seller-1",
  status: "COMPLETED",
  amountCents: 5_000,
  buyerConfirmationStatus: "CONFIRMED",
  buyerConfirmationAt: new Date(),
  transferVerificationStatus: "MATCHED",
  payment: {
    id: "payment-1",
    orderId,
    amountCents: 5_000,
    status: "SUCCEEDED",
    provider: "STRIPE",
    providerRef: "pi_synthetic",
    currency: "CAD",
  },
};

describe("durable Stripe payout command", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    process.env = { ...originalEnv, STRIPE_SECRET_KEY: "sk_test_isolated" };
    mockedPrisma.$transaction.mockImplementation(async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma));
    mockedPrisma.payout.findUnique.mockResolvedValue(payout);
    mockedPrisma.order.findUnique.mockResolvedValue(order);
    mockedPrisma.legacyPayoutTransferCommand.findUniqueOrThrow.mockResolvedValue({
      ...command,
      status: "SUCCEEDED",
      providerTransferId: "tr_synthetic",
      payout,
    });
    mockedPrisma.legacyInstantPayoutCommand.findUnique.mockResolvedValue(null);
    mockedStage.mockResolvedValue(command as never);
    mockedClaim.mockResolvedValue({ ...command, status: "ATTEMPTING" } as never);
    mockedFinalize.mockResolvedValue({} as never);
    mockedFailed.mockResolvedValue({ count: 1 } as never);
    mockedReconciliation.mockResolvedValue({ count: 1 } as never);
    mockRetrieve.mockResolvedValue({
      id: "pi_synthetic",
      currency: "cad",
      latest_charge: {
        id: "ch_synthetic",
        currency: "cad",
        balance_transaction: { currency: "cad" },
      },
    });
    mockTransferCreate.mockResolvedValue({
      id: "tr_synthetic",
      amount: 5_000,
      currency: "cad",
      destination: "acct_synthetic",
      source_transaction: "ch_synthetic",
    });
    mockListExternalAccounts.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("does zero provider I/O for a provenance mismatch", async () => {
    mockedPrisma.payout.findUnique.mockResolvedValue({
      ...payout,
      status: "PROCESSING",
      legacyPayoutTransferCommand: { ...command, status: "ATTEMPTING", actorUserId: "another-actor" },
    });

    await expect(processStripePayout(payoutId, { actorUserId, automatic: true }))
      .resolves.toMatchObject({ ok: false, code: "NOT_READY" });
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockTransferCreate).not.toHaveBeenCalled();
    expect(mockPayoutCreate).not.toHaveBeenCalled();
  });

  it("never reclaims an already attempted command", async () => {
    mockedPrisma.payout.findUnique.mockResolvedValue({
      ...payout,
      status: "PROCESSING",
      lastAttemptAt: new Date("2000-01-01T00:00:00.000Z"),
      legacyPayoutTransferCommand: { ...command, status: "ATTEMPTING" },
    });

    await expect(processStripePayout(payoutId, { actorUserId, automatic: true }))
      .resolves.toMatchObject({ ok: false, code: "ALREADY_PROCESSING" });
    expect(mockedClaim).not.toHaveBeenCalled();
    expect(mockTransferCreate).not.toHaveBeenCalled();
  });

  it("dispatches a staged command only from its frozen provider scope", async () => {
    mockedPrisma.payout.findUnique.mockResolvedValue({
      ...payout,
      status: "PROCESSING",
      legacyPayoutTransferCommand: command,
    });

    await processStripePayout(payoutId, { actorUserId, automatic: true });

    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockTransferCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: command.transferAmountCents,
        currency: command.transferCurrency,
        destination: command.connectedAccountId,
        source_transaction: command.sourceTransaction,
        metadata: expect.objectContaining({ fundingMode: command.fundingMode }),
      }),
      { idempotencyKey: command.idempotencyKey },
    );
  });

  it("quarantines a thrown transfer call instead of rewriting it as retryable failure", async () => {
    mockTransferCreate.mockRejectedValue(new Error("synthetic provider timeout"));

    await expect(processStripePayout(payoutId, { actorUserId, automatic: true }))
      .resolves.toMatchObject({ ok: false, code: "RECONCILIATION_REQUIRED" });
    expect(mockedFailed).not.toHaveBeenCalled();
    expect(mockedReconciliation).toHaveBeenCalledWith(
      mockedPrisma,
      command.id,
      "synthetic provider timeout",
    );
    expect(mockTransferCreate).toHaveBeenCalledTimes(1);
  });

  it("records exact transfer evidence when local success finalization rolls back", async () => {
    mockedFinalize.mockRejectedValue(new Error("synthetic local rollback"));

    await expect(processStripePayout(payoutId, { actorUserId, automatic: true }))
      .resolves.toMatchObject({ ok: false, code: "RECONCILIATION_REQUIRED" });
    expect(mockTransferCreate).toHaveBeenCalledTimes(1);
    expect(mockedReconciliation).toHaveBeenCalledWith(
      mockedPrisma,
      command.id,
      expect.stringContaining("local finalization failed"),
      expect.objectContaining({
        id: "tr_synthetic",
        amountCents: 5_000,
        currency: "cad",
        destination: "acct_synthetic",
        sourceTransaction: "ch_synthetic",
      }),
    );
  });

  it("quarantines the exact wrong currency and source returned by Stripe", async () => {
    mockTransferCreate.mockResolvedValue({
      id: "tr_mismatched",
      amount: 5_000,
      currency: "usd",
      destination: "acct_synthetic",
      source_transaction: "ch_returned_other",
    });
    mockedFinalize.mockRejectedValue(new Error("LEGACY_PAYOUT_TRANSFER_PROVIDER_EVIDENCE_MISMATCH"));

    await expect(processStripePayout(payoutId, { actorUserId, automatic: true }))
      .resolves.toMatchObject({ ok: false, code: "RECONCILIATION_REQUIRED" });
    expect(mockedReconciliation).toHaveBeenCalledWith(
      mockedPrisma,
      command.id,
      expect.stringContaining("local finalization failed"),
      expect.objectContaining({
        id: "tr_mismatched",
        currency: "usd",
        sourceTransaction: "ch_returned_other",
      }),
    );
  });

  it("replays recorded success without retrieving or creating a transfer", async () => {
    mockedPrisma.payout.findUnique.mockResolvedValue({
      ...payout,
      status: "PAID",
      stripeTransferId: "tr_synthetic",
      legacyPayoutTransferCommand: {
        ...command,
        status: "SUCCEEDED",
        providerTransferId: "tr_synthetic",
        completedAt: new Date(),
      },
    });
    mockedPrisma.legacyPayoutTransferCommand.findUniqueOrThrow.mockResolvedValue({
      ...command,
      status: "SUCCEEDED",
      providerTransferId: "tr_synthetic",
      payout,
    });
    mockedPrisma.legacyInstantPayoutCommand.findUnique.mockResolvedValue({
      payoutId,
      actorUserId,
      automatic: true,
      status: "SUCCEEDED",
      providerStatus: "paid",
    });

    await expect(processStripePayout(payoutId, { actorUserId, automatic: true }))
      .resolves.toMatchObject({ ok: true, replay: true, stripeTransferId: "tr_synthetic" });
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockTransferCreate).not.toHaveBeenCalled();
    expect(mockPayoutCreate).not.toHaveBeenCalled();
  });
});
