/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { applyRateLimit } from "@/lib/rate-limit";
import {
  assertLegacyPaymentIntentProviderEvidence,
  claimLegacyPaymentIntentCommand,
  finalizeLegacyPaymentIntentCommand,
  markLegacyPaymentIntentReconciliationRequired,
  stageLegacyPaymentIntentCommand,
} from "@/lib/payments/legacyPaymentIntent";
import { POST } from "@/app/api/payments/create-intent/route";

const mockRetrieve = jest.fn();
const mockCreate = jest.fn();

jest.mock("stripe", () => jest.fn().mockImplementation(() => ({
  paymentIntents: {
    retrieve: mockRetrieve,
    create: mockCreate,
  },
})));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    order: { findUnique: jest.fn(), updateMany: jest.fn() },
    ticket: { updateMany: jest.fn() },
    payment: { upsert: jest.fn() },
    legacyPaymentIntentCommand: { findUnique: jest.fn() },
    accessTokenTransaction: { findMany: jest.fn(), updateMany: jest.fn() },
    seller: { update: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/payments/legacyPaymentIntent", () => ({
  LegacyPaymentIntentAuthorizationChangedError: class LegacyPaymentIntentAuthorizationChangedError extends Error {},
  stageLegacyPaymentIntentCommand: jest.fn(),
  claimLegacyPaymentIntentCommand: jest.fn(),
  finalizeLegacyPaymentIntentCommand: jest.fn(),
  markLegacyPaymentIntentReconciliationRequired: jest.fn(),
  assertLegacyPaymentIntentProviderEvidence: jest.fn(),
}));

jest.mock("@/lib/auth/guards", () => ({ requireVerifiedUser: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ applyRateLimit: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  order: { findUnique: jest.Mock; updateMany: jest.Mock };
  ticket: { updateMany: jest.Mock };
  payment: { upsert: jest.Mock };
  legacyPaymentIntentCommand: { findUnique: jest.Mock };
  accessTokenTransaction: { findMany: jest.Mock; updateMany: jest.Mock };
  seller: { update: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireVerifiedUser = requireVerifiedUser as jest.MockedFunction<
  typeof requireVerifiedUser
>;
const mockedApplyRateLimit = applyRateLimit as jest.MockedFunction<typeof applyRateLimit>;
const mockedAssertEvidence = assertLegacyPaymentIntentProviderEvidence as jest.MockedFunction<typeof assertLegacyPaymentIntentProviderEvidence>;
const mockedStageCommand = stageLegacyPaymentIntentCommand as jest.MockedFunction<typeof stageLegacyPaymentIntentCommand>;
const mockedClaimCommand = claimLegacyPaymentIntentCommand as jest.MockedFunction<typeof claimLegacyPaymentIntentCommand>;
const mockedFinalizeCommand = finalizeLegacyPaymentIntentCommand as jest.MockedFunction<typeof finalizeLegacyPaymentIntentCommand>;
const mockedMarkReconciliation = markLegacyPaymentIntentReconciliationRequired as jest.MockedFunction<typeof markLegacyPaymentIntentReconciliationRequired>;

const orderId = "cm1234567890abcdefghijkl";
const walletId = "cm2234567890abcdefghijkl";
const ordinaryUser = {
  id: "user-1",
  email: "buyer@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
  emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  phoneVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  isBanned: false,
  canBuy: true,
  seller: { id: walletId, accessTokenBalance: 2 },
};
const managedUser = {
  ...ordinaryUser,
  email: "admin@primary-staging.example.invalid",
  phone: "+15550001002",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
  canBuy: false,
  seller: null,
};
const futureReservation = new Date("2099-01-01T00:00:00.000Z");
const command = {
  id: "payment-command-1",
  orderId,
  buyerUserId: ordinaryUser.id,
  buyerSellerId: walletId,
  sellerId: "seller-1",
  expectedAmountCents: 5495,
  currency: "CAD",
  priorPaymentId: null,
  priorPaymentProvider: null,
  priorPaymentRef: null,
  priorPaymentAmountCents: null,
  priorPaymentCurrency: null,
  ticketSnapshot: [],
  commandDigest: "a".repeat(64),
  idempotencyKey: `truefantix-order-${orderId}`,
  status: "NOT_SENT",
  dispatchStartedAt: null,
  providerIntentId: null,
  providerStatus: null,
  providerAmountCents: null,
  providerCurrency: null,
  failureReason: null,
  authorizedAt: new Date("2026-09-15T22:00:00.000Z"),
  completedAt: null,
  createdAt: new Date("2026-09-15T22:00:00.000Z"),
  updatedAt: new Date("2026-09-15T22:00:00.000Z"),
} as const;

function request() {
  return new Request("http://localhost/api/payments/create-intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
}

describe("payment-intent staging-persona boundary", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    process.env = { ...originalEnv, STRIPE_SECRET_KEY: "sk_test_isolated" };
    mockedApplyRateLimit.mockResolvedValue({ ok: true });
    mockedRequireVerifiedUser.mockResolvedValue({
      ok: true,
      user: { id: ordinaryUser.id, sellerId: "stale-wallet", canBuy: true },
    } as never);
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.order.findUnique.mockResolvedValue({
      id: orderId,
      buyerSellerId: walletId,
      sellerId: "seller-1",
      status: "PENDING",
      totalCents: 5495,
      currency: "CAD",
      payment: null,
      seller: { id: "seller-1" },
      items: [{
        ticket: {
          id: "ticket-1",
          status: "RESERVED",
          reservedByOrderId: orderId,
          reservedUntil: futureReservation,
        },
      }],
    });
    mockCreate.mockResolvedValue({
      id: "pi_test_isolated",
      amount: 5495,
      currency: "cad",
      status: "requires_payment_method",
      client_secret: "pi_test_isolated_secret",
    });
    mockRetrieve.mockResolvedValue({
      id: "pi_test_isolated",
      amount: 5495,
      currency: "cad",
      status: "requires_payment_method",
      client_secret: "pi_test_isolated_secret",
    });
    mockedStageCommand.mockResolvedValue(command as never);
    mockedClaimCommand.mockResolvedValue({ ...command, status: "ATTEMPTING" } as never);
    mockedFinalizeCommand.mockResolvedValue({} as never);
    mockedMarkReconciliation.mockResolvedValue({ count: 1 } as never);
    mockedPrisma.payment.upsert.mockResolvedValue({});
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("refuses a restored managed user before order or provider access", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockedPrisma.payment.upsert).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);
    mockedPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" }),
    );

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("uses the current locked wallet and one stable provider idempotency key", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      clientSecret: "pi_test_isolated_secret",
      amount: 5495,
      currency: "CAD",
    });
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockedStageCommand).toHaveBeenCalledWith(mockedPrisma, expect.objectContaining({
      orderId,
      buyerUserId: ordinaryUser.id,
      buyerSellerId: walletId,
      expectedAmountCents: 5495,
      currency: "CAD",
    }));
    expect(mockedClaimCommand).toHaveBeenCalledWith(mockedPrisma, command.id);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5495,
        metadata: expect.objectContaining({
          buyerId: ordinaryUser.id,
          orderId,
          paymentCommandId: command.id,
          commandDigest: command.commandDigest,
        }),
      }),
      { idempotencyKey: `truefantix-order-${orderId}` },
    );
    expect(mockedFinalizeCommand).toHaveBeenCalledWith(mockedPrisma, expect.objectContaining({
      commandId: command.id,
      buyerUserId: ordinaryUser.id,
      evidence: expect.objectContaining({ id: "pi_test_isolated", amountCents: 5495, currency: "cad" }),
    }));
    expect(mockedPrisma.payment.upsert).not.toHaveBeenCalled();
  });

  it("commits the immutable command before provider contact", async () => {
    const events: string[] = [];
    mockedStageCommand.mockImplementationOnce(async () => {
      events.push("staged");
      return command as never;
    });
    mockedPrisma.$transaction.mockImplementation(async (work: (tx: typeof mockedPrisma) => unknown) => {
      const value = await work(mockedPrisma);
      events.push("committed");
      return value;
    });
    mockCreate.mockImplementationOnce(async () => {
      events.push("provider");
      return {
        id: "pi_test_isolated",
        amount: 5495,
        currency: "cad",
        status: "requires_payment_method",
        client_secret: "pi_test_isolated_secret",
      };
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(events.slice(0, 3)).toEqual(["staged", "committed", "committed"]);
    expect(events.indexOf("provider")).toBeGreaterThan(events.indexOf("committed"));
  });

  it("does not contact Stripe when the authorization transaction aborts after staging", async () => {
    mockedPrisma.$transaction.mockImplementationOnce(async (work: (tx: typeof mockedPrisma) => unknown) => {
      await work(mockedPrisma);
      throw Object.assign(new Error("serialization failure"), { code: "P2034" });
    });

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mockedStageCommand).toHaveBeenCalledTimes(1);
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockedClaimCommand).not.toHaveBeenCalled();
  });

  it("does not resend when the provider claim is already owned", async () => {
    mockedClaimCommand.mockResolvedValueOnce(null);
    mockedPrisma.legacyPaymentIntentCommand.findUnique.mockResolvedValueOnce({
      ...command,
      status: "ATTEMPTING",
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "PAYMENT_RECONCILIATION_REQUIRED", retrySafe: false });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("replays committed success with retrieve only and no durable client secret", async () => {
    mockedStageCommand.mockResolvedValueOnce({
      ...command,
      status: "SUCCEEDED",
      providerIntentId: "pi_test_isolated",
      providerStatus: "requires_payment_method",
      providerAmountCents: 5495,
      providerCurrency: "CAD",
    } as never);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      clientSecret: "pi_test_isolated_secret",
      reused: true,
    });
    expect(mockRetrieve).toHaveBeenCalledWith("pi_test_isolated");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockedClaimCommand).not.toHaveBeenCalled();
    expect(mockedFinalizeCommand).not.toHaveBeenCalled();
    expect(command).not.toHaveProperty("providerClientSecret");
  });

  it("does not create or mutate when successful replay retrieval fails", async () => {
    mockedStageCommand.mockResolvedValueOnce({
      ...command,
      status: "SUCCEEDED",
      providerIntentId: "pi_test_isolated",
      providerStatus: "requires_payment_method",
      providerAmountCents: 5495,
      providerCurrency: "CAD",
    } as never);
    mockRetrieve.mockRejectedValueOnce(new Error("synthetic retrieval outage"));

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "PAYMENT_PROVIDER_UNAVAILABLE", retrySafe: true });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockedClaimCommand).not.toHaveBeenCalled();
    expect(mockedMarkReconciliation).not.toHaveBeenCalled();
  });

  it("does not create or downgrade when successful replay evidence mismatches", async () => {
    mockedStageCommand.mockResolvedValueOnce({
      ...command,
      status: "SUCCEEDED",
      providerIntentId: "pi_test_isolated",
      providerStatus: "requires_payment_method",
      providerAmountCents: 5495,
      providerCurrency: "CAD",
    } as never);
    mockedAssertEvidence.mockImplementationOnce(() => {
      throw new Error("synthetic mismatch");
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "PAYMENT_RECONCILIATION_REQUIRED", retrySafe: false });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockedClaimCommand).not.toHaveBeenCalled();
    expect(mockedMarkReconciliation).not.toHaveBeenCalled();
  });

  it("quarantines an ambiguous provider outcome without finalizing Payment", async () => {
    mockCreate.mockRejectedValueOnce(new Error("synthetic timeout"));

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "PAYMENT_RECONCILIATION_REQUIRED", retrySafe: false });
    expect(mockedMarkReconciliation).toHaveBeenCalledWith(
      mockedPrisma,
      command.id,
      "PROVIDER_OUTCOME_UNKNOWN: synthetic timeout",
    );
    expect(mockedFinalizeCommand).not.toHaveBeenCalled();
  });

  it("records provider evidence when local finalization rolls back", async () => {
    mockedFinalizeCommand.mockRejectedValueOnce(new Error("synthetic finalize rollback"));

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "PAYMENT_RECONCILIATION_REQUIRED", retrySafe: false });
    expect(mockedMarkReconciliation).toHaveBeenCalledWith(
      mockedPrisma,
      command.id,
      "PROVIDER_SUCCEEDED_LOCAL_FINALIZE_FAILED: synthetic finalize rollback",
      expect.objectContaining({ id: "pi_test_isolated", amountCents: 5495, currency: "CAD" }),
    );
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses an ordinary buying-capability downgrade before provider access", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryUser, canBuy: false });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "BUYING_DISABLED" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
