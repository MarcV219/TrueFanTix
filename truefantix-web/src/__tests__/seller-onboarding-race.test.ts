/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";
import { GET } from "@/app/api/sellers/onboarding/status/route";

const mockRetrieve = jest.fn();
const mockListExternalAccounts = jest.fn();

jest.mock("stripe", () => jest.fn().mockImplementation(() => ({
  accounts: {
    retrieve: mockRetrieve,
    listExternalAccounts: mockListExternalAccounts,
  },
})));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), updateMany: jest.fn() },
    seller: { updateMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/session", () => ({
  getUserIdFromSessionCookie: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; updateMany: jest.Mock };
  seller: { updateMany: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedSessionUserId = getUserIdFromSessionCookie as jest.MockedFunction<
  typeof getUserIdFromSessionCookie
>;

const ordinaryUser = {
  id: "user-1",
  email: "ordinary@example.test",
  emailVerifiedAt: new Date("2026-09-16T00:00:00.000Z"),
  phone: "+14165550199",
  phoneVerifiedAt: new Date("2026-09-16T00:00:00.000Z"),
  termsVersion: "v1",
  privacyVersion: "v1",
  isBanned: false,
  canSell: false,
  seller: { id: "seller-1", stripeAccountId: "acct_test_only" },
};

const managedUser = {
  ...ordinaryUser,
  email: "admin@primary-staging.example.invalid",
  phone: "+15550001002",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
  seller: null,
};

describe("seller onboarding staging-persona boundary", () => {
  const originalEnv = process.env;
  let transactionDepth = 0;
  let transactionCommits = 0;
  let timeline: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    process.env = { ...originalEnv, STRIPE_SECRET_KEY: "sk_test_isolated" };
    transactionDepth = 0;
    transactionCommits = 0;
    timeline = [];
    mockedSessionUserId.mockResolvedValue(ordinaryUser.id);
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => {
        transactionDepth += 1;
        timeline.push("transaction:start");
        try {
          const result = await work(mockedPrisma);
          transactionCommits += 1;
          timeline.push("transaction:commit");
          return result;
        } finally {
          transactionDepth -= 1;
        }
      },
    );
    mockedPrisma.seller.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.user.updateMany.mockResolvedValue({ count: 1 });
    mockRetrieve.mockImplementation(async () => {
      timeline.push("provider:retrieve");
      expect(transactionDepth).toBe(0);
      expect(transactionCommits).toBe(1);
      return {
        id: ordinaryUser.seller.stripeAccountId,
        details_submitted: true,
        charges_enabled: false,
        payouts_enabled: false,
        capabilities: { card_payments: "active", transfers: "active" },
        requirements: { currently_due: [], eventually_due: [], past_due: [] },
      };
    });
    mockListExternalAccounts.mockImplementation(async () => {
      timeline.push("provider:list-external-accounts");
      expect(transactionDepth).toBe(0);
      expect(transactionCommits).toBe(1);
      return { data: [] };
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("commits authorization before provider reads and revalidates before atomic seller approval", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(4);
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.$transaction).toHaveBeenNthCalledWith(1, expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockedPrisma.$transaction).toHaveBeenNthCalledWith(2, expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockRetrieve).toHaveBeenCalledWith("acct_test_only");
    expect(mockListExternalAccounts).toHaveBeenCalledWith("acct_test_only", { limit: 100 });
    expect(timeline).toEqual([
      "transaction:start",
      "transaction:commit",
      "provider:retrieve",
      "provider:list-external-accounts",
      "transaction:start",
      "transaction:commit",
    ]);
    expect(mockedPrisma.seller.updateMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.seller.updateMany).toHaveBeenCalledWith({
      where: { id: ordinaryUser.seller.id, stripeAccountId: ordinaryUser.seller.stripeAccountId },
      data: expect.objectContaining({
        stripeDetailsSubmitted: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        status: "APPROVED",
      }),
    });
    expect(mockedPrisma.user.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: ordinaryUser.id, sellerId: ordinaryUser.seller.id }),
      data: { canSell: true },
    });
  });

  it("refuses a restored managed user before provider access or seller mutation", async () => {
    mockedPrisma.user.findUnique
      .mockResolvedValueOnce({ sellerId: null, seller: null })
      .mockResolvedValueOnce(managedUser);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("private");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockListExternalAccounts).not.toHaveBeenCalled();
    expect(mockedPrisma.seller.updateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("fails a Tx1 serialization abort without a second identity read or provider access", async () => {
    mockedPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" }),
    );

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "SERVER_ERROR" });
    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockedPrisma.seller.updateMany).not.toHaveBeenCalled();
  });

  it("does not cross the provider boundary when authorization rolls back after its callback", async () => {
    mockedPrisma.$transaction.mockImplementationOnce(
      async (work: (tx: typeof mockedPrisma) => unknown) => {
        await work(mockedPrisma);
        throw new Error("synthetic authorization rollback");
      },
    );

    const response = await GET();

    expect(response.status).toBe(500);
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockListExternalAccounts).not.toHaveBeenCalled();
    expect(mockedPrisma.seller.updateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("does not persist or repeat provider reads when the persistence transaction aborts", async () => {
    mockedPrisma.$transaction
      .mockImplementationOnce(async (work: (tx: typeof mockedPrisma) => unknown) => {
        transactionDepth += 1;
        try {
          const result = await work(mockedPrisma);
          transactionCommits += 1;
          return result;
        } finally {
          transactionDepth -= 1;
        }
      })
      .mockRejectedValueOnce(Object.assign(new Error("synthetic persistence serialization failure"), {
        code: "P2034",
      }));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(mockRetrieve).toHaveBeenCalledTimes(1);
    expect(mockListExternalAccounts).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.seller.updateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("does not persist provider status after the seller account binding changes", async () => {
    mockedPrisma.user.findUnique
      .mockResolvedValueOnce({ sellerId: ordinaryUser.seller.id, seller: { id: ordinaryUser.seller.id } })
      .mockResolvedValueOnce(ordinaryUser)
      .mockResolvedValueOnce({ sellerId: ordinaryUser.seller.id, seller: { id: ordinaryUser.seller.id } })
      .mockResolvedValueOnce({
        ...ordinaryUser,
        seller: { ...ordinaryUser.seller, stripeAccountId: "acct_changed_before_persist" },
      });

    const response = await GET();

    expect(response.status).toBe(500);
    expect(mockRetrieve).toHaveBeenCalledTimes(1);
    expect(mockListExternalAccounts).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.seller.updateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("does not persist provider status after the identity becomes managed", async () => {
    mockedPrisma.user.findUnique
      .mockResolvedValueOnce({ sellerId: ordinaryUser.seller.id, seller: { id: ordinaryUser.seller.id } })
      .mockResolvedValueOnce(ordinaryUser)
      .mockResolvedValueOnce({ sellerId: ordinaryUser.seller.id, seller: { id: ordinaryUser.seller.id } })
      .mockResolvedValueOnce(managedUser)
      .mockResolvedValue(managedUser);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mockRetrieve).toHaveBeenCalledTimes(1);
    expect(mockListExternalAccounts).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.seller.updateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("rejects mismatched returned account evidence before external-account reads or persistence", async () => {
    mockRetrieve.mockResolvedValue({
      id: "acct_different",
      details_submitted: true,
      capabilities: { transfers: "active" },
    });

    const response = await GET();

    expect(response.status).toBe(500);
    expect(mockListExternalAccounts).not.toHaveBeenCalled();
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.seller.updateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("rejects deleted account evidence before external-account reads or persistence", async () => {
    mockRetrieve.mockResolvedValue({ id: ordinaryUser.seller.stripeAccountId, deleted: true });

    const response = await GET();

    expect(response.status).toBe(500);
    expect(mockListExternalAccounts).not.toHaveBeenCalled();
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.seller.updateMany).not.toHaveBeenCalled();
  });

  it("does not initialize Stripe when the current ordinary identity has no seller account", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryUser, seller: null });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      stripe: { hasAccount: false },
    });
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockedPrisma.seller.updateMany).not.toHaveBeenCalled();
  });

  it("returns the existing configuration refusal only after an authorized account snapshot", async () => {
    delete process.env.STRIPE_SECRET_KEY;

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "STRIPE_NOT_CONFIGURED" });
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockedPrisma.seller.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an unverified current identity before provider configuration or access", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryUser, phoneVerifiedAt: null });

    const response = await GET();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "NOT_VERIFIED" });
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockedPrisma.seller.updateMany).not.toHaveBeenCalled();
  });

  it("returns unauthorized without starting authorization or provider access", async () => {
    mockedSessionUserId.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockRetrieve).not.toHaveBeenCalled();
  });

  it("preserves the unauthorized response when the current database identity is banned", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryUser, isBanned: true });

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "UNAUTHORIZED" });
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockedPrisma.seller.updateMany).not.toHaveBeenCalled();
  });

  it("retains the server-error response for an unrelated provider failure", async () => {
    mockRetrieve.mockRejectedValue(new Error("provider unavailable"));

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "SERVER_ERROR" });
    expect(mockedPrisma.seller.updateMany).not.toHaveBeenCalled();
  });

  it("does not persist when the external-account provider read fails", async () => {
    mockListExternalAccounts.mockRejectedValue(new Error("external accounts unavailable"));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(mockRetrieve).toHaveBeenCalledTimes(1);
    expect(mockListExternalAccounts).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.seller.updateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("rolls back the projection path when the exact seller fence matches no row", async () => {
    mockedPrisma.seller.updateMany.mockResolvedValue({ count: 0 });

    const response = await GET();

    expect(response.status).toBe(500);
    expect(mockedPrisma.seller.updateMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.user.updateMany).not.toHaveBeenCalled();
  });
});
