/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { validateRequest } from "@/lib/validation";
import { GET, PATCH, POST } from "@/app/api/referrals/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    referral: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    seller: { update: jest.fn() },
    accessTokenTransaction: { create: jest.fn() },
    notification: { create: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({
  requireUser: jest.fn(),
  requireAdmin: jest.fn(),
}));

jest.mock("@/lib/validation", () => ({
  schemas: {
    referralClaimApi: { kind: "claim" },
    referralCompleteApi: { kind: "complete" },
  },
  validateRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock };
  referral: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    aggregate: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  seller: { update: jest.Mock };
  accessTokenTransaction: { create: jest.Mock };
  notification: { create: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireUser = requireUser as jest.MockedFunction<typeof requireUser>;
const mockedRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockedValidateRequest = validateRequest as jest.Mock;

const ordinaryUser = {
  id: "user-1",
  email: "ordinary@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
};

const referrer = {
  id: "referrer-1",
  email: "referrer@example.test",
  phone: "+14165550200",
  termsVersion: "v1",
  privacyVersion: "v1",
  firstName: "Referrer",
  sellerId: "seller-1",
};

const admin = {
  id: "admin-1",
  email: "admin@example.test",
  phone: "+14165550201",
  termsVersion: "v1",
  privacyVersion: "v1",
  role: "ADMIN",
};

const managedUser = {
  ...ordinaryUser,
  email: "admin@primary-staging.example.invalid",
  phone: "+15550001002",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
};

const referral = {
  id: "referral-1",
  referrerId: referrer.id,
  referredId: ordinaryUser.id,
  code: "REFCODE123",
  status: "PENDING",
  accessTokensAwarded: 0,
};

function request(method: string) {
  return new Request("https://preview.example/api/referrals", { method });
}

describe("referral staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.REFERRAL_SECRET = "r".repeat(32);
    process.env.NEXT_PUBLIC_APP_URL = "https://preview.example";

    mockedRequireUser.mockResolvedValue({ ok: true, user: ordinaryUser } as never);
    mockedRequireAdmin.mockResolvedValue({ ok: true, user: admin } as never);
    mockedValidateRequest.mockImplementation((schema: { kind: string }) => async () => ({
      success: true,
      data: schema.kind === "claim"
        ? { newUserId: ordinaryUser.id, referralCode: referral.code }
        : { referredId: ordinaryUser.id },
    }));
    mockedPrisma.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string; referralCode?: string } }) => {
      if (where.referralCode) return referrer;
      if (where.id === referrer.id) return referrer;
      if (where.id === admin.id) return admin;
      return ordinaryUser;
    });
    mockedPrisma.user.update.mockResolvedValue({ id: ordinaryUser.id, referralCode: "GENERATED1" });
    mockedPrisma.referral.findUnique.mockImplementation(async ({ where }: { where: { id?: string; referredId?: string } }) => {
      if (where.id) return { ...referral, referrer: { sellerId: referrer.sellerId } };
      if (where.referredId) return null;
      return null;
    });
    mockedPrisma.referral.findMany.mockResolvedValue([]);
    mockedPrisma.referral.aggregate.mockResolvedValue({ _count: { id: 0 } });
    mockedPrisma.referral.create.mockResolvedValue(referral);
    mockedPrisma.referral.update.mockResolvedValue({ ...referral, status: "COMPLETED" });
    mockedPrisma.seller.update.mockResolvedValue({ id: referrer.sellerId });
    mockedPrisma.accessTokenTransaction.create.mockResolvedValue({ id: "token-tx-1" });
    mockedPrisma.notification.create.mockResolvedValue({ id: "notification-1" });
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
  });

  afterEach(() => {
    delete process.env.REFERRAL_SECRET;
    delete process.env.NEXT_PUBLIC_APP_URL;
    jest.restoreAllMocks();
  });

  it("locks and rechecks before generating a referral code", async () => {
    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ordinaryUser.id },
    }));
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
  });

  it("claims atomically after locking and rechecking both participants", async () => {
    const response = await POST(request("POST"));

    expect(response.status).toBe(200);
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.referral.create).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it("completes and rewards atomically using the referrer's seller identity", async () => {
    mockedPrisma.referral.findUnique.mockImplementation(async ({ where }: { where: { id?: string; referredId?: string } }) => {
      if (where.id) return { ...referral, referrer: { sellerId: referrer.sellerId } };
      return referral;
    });

    const response = await PATCH(request("PATCH"));

    expect(response.status).toBe(200);
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(4);
    expect(mockedPrisma.seller.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: referrer.sellerId },
    }));
    expect(mockedPrisma.accessTokenTransaction.create).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["code generation", GET, "GET"],
    ["claim", POST, "POST"],
  ] as const)("refuses a restored managed user before referral %s residue", async (_label, handler, method) => {
    mockedPrisma.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string; referralCode?: string } }) => {
      if (where.referralCode) return referrer;
      if (where.id === referrer.id) return referrer;
      return managedUser;
    });

    const response = await handler(request(method));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    expect(mockedPrisma.referral.create).not.toHaveBeenCalled();
    expect(mockedPrisma.notification.create).not.toHaveBeenCalled();
  });

  it("refuses completion when a referral participant has become managed", async () => {
    mockedPrisma.referral.findUnique.mockResolvedValue(referral);
    mockedPrisma.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) => (
      where.id === ordinaryUser.id ? managedUser : where.id === referrer.id ? referrer : admin
    ));

    const response = await PATCH(request("PATCH"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.referral.update).not.toHaveBeenCalled();
    expect(mockedPrisma.seller.update).not.toHaveBeenCalled();
    expect(mockedPrisma.notification.create).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.$transaction.mockRejectedValue(Object.assign(new Error("serialization failure"), { code: "P2034" }));
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await GET(request("GET"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });
});
