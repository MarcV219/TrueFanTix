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
    user: { findUnique: jest.fn(), update: jest.fn() },
    seller: { update: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/session", () => ({
  getUserIdFromSessionCookie: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock };
  seller: { update: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedSessionUserId = getUserIdFromSessionCookie as jest.MockedFunction<
  typeof getUserIdFromSessionCookie
>;

const ordinaryUser = {
  id: "user-1",
  email: "ordinary@example.test",
  phone: "+14165550199",
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

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    process.env = { ...originalEnv, STRIPE_SECRET_KEY: "sk_test_isolated" };
    mockedSessionUserId.mockResolvedValue(ordinaryUser.id);
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedPrisma.seller.update.mockResolvedValue({});
    mockedPrisma.user.update.mockResolvedValue({});
    mockRetrieve.mockResolvedValue({
      details_submitted: true,
      charges_enabled: false,
      payouts_enabled: false,
      capabilities: { card_payments: "active", transfers: "active" },
      requirements: { currently_due: [], eventually_due: [], past_due: [] },
    });
    mockListExternalAccounts.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("locks the current user through provider reads and atomic seller approval", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockRetrieve).toHaveBeenCalledWith("acct_test_only");
    expect(mockListExternalAccounts).toHaveBeenCalledWith("acct_test_only", { limit: 100 });
    expect(mockedPrisma.seller.update).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: { id: ordinaryUser.id },
      data: { canSell: true },
    });
  });

  it("refuses a restored managed user before provider access or seller mutation", async () => {
    mockedPrisma.user.findUnique
      .mockResolvedValueOnce(ordinaryUser)
      .mockResolvedValueOnce(managedUser);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("private");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockListExternalAccounts).not.toHaveBeenCalled();
    expect(mockedPrisma.seller.update).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.user.findUnique
      .mockResolvedValueOnce(ordinaryUser)
      .mockResolvedValueOnce(managedUser);
    mockedPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" }),
    );

    const response = await GET();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockedPrisma.seller.update).not.toHaveBeenCalled();
  });

  it("does not initialize Stripe when the current ordinary identity has no seller account", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryUser, seller: null });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      stripe: { hasAccount: false },
    });
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockedPrisma.seller.update).not.toHaveBeenCalled();
  });

  it("retains the server-error response for an unrelated provider failure", async () => {
    mockRetrieve.mockRejectedValue(new Error("provider unavailable"));

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "SERVER_ERROR" });
    expect(mockedPrisma.seller.update).not.toHaveBeenCalled();
  });
});
