/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { applyRateLimit } from "@/lib/rate-limit";
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
    accessTokenTransaction: { findMany: jest.fn(), updateMany: jest.fn() },
    seller: { update: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({ requireVerifiedUser: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ applyRateLimit: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  order: { findUnique: jest.Mock; updateMany: jest.Mock };
  ticket: { updateMany: jest.Mock };
  payment: { upsert: jest.Mock };
  accessTokenTransaction: { findMany: jest.Mock; updateMany: jest.Mock };
  seller: { update: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireVerifiedUser = requireVerifiedUser as jest.MockedFunction<
  typeof requireVerifiedUser
>;
const mockedApplyRateLimit = applyRateLimit as jest.MockedFunction<typeof applyRateLimit>;

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
          status: "RESERVED",
          reservedByOrderId: orderId,
          reservedUntil: futureReservation,
        },
      }],
    });
    mockCreate.mockResolvedValue({
      id: "pi_test_isolated",
      amount: 5495,
      client_secret: "pi_test_isolated_secret",
    });
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
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5495,
        metadata: expect.objectContaining({ buyerId: ordinaryUser.id, orderId }),
      }),
      { idempotencyKey: `truefantix-order-${orderId}` },
    );
    expect(mockedPrisma.payment.upsert).toHaveBeenCalledTimes(1);
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
