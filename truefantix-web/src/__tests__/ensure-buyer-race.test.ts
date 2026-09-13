/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { POST } from "@/app/api/auth/ensure-buyer/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({ requireVerifiedUser: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
};
const mockedRequireVerifiedUser = requireVerifiedUser as jest.MockedFunction<
  typeof requireVerifiedUser
>;

const ordinaryUser = {
  id: "user-1",
  email: "ordinary@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
  firstName: "Ordinary",
  lastName: "Buyer",
  sellerId: null,
};

function request() {
  return new Request("https://preview.example/api/auth/ensure-buyer", { method: "POST" });
}

describe("buyer-wallet staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireVerifiedUser.mockResolvedValue({ ok: true, user: ordinaryUser } as never);
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
  });

  it("creates and attaches an ordinary buyer wallet in one managed-excluding write", async () => {
    mockedPrisma.user.update.mockResolvedValue({ sellerId: "seller-1" });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      sellerId: "seller-1",
      created: true,
    });
    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: {
        id: "user-1",
        AND: [
          { sellerId: null },
          { NOT: expect.any(Object) },
        ],
      },
      data: {
        seller: {
          create: {
            name: "Ordinary Buyer",
            status: "NOT_STARTED",
          },
        },
        canSell: false,
      },
      select: { sellerId: true },
    });
  });

  it("returns an existing ordinary wallet only after the transactional identity recheck", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      ...ordinaryUser,
      sellerId: "seller-existing",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      sellerId: "seller-existing",
      created: false,
    });
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses a persona restored before the transactional recheck", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      ...ordinaryUser,
      email: "admin@primary-staging.example.invalid",
      phone: "+15550001002",
      termsVersion: "primary-staging-only",
      privacyVersion: "primary-staging-only",
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
    });
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("rolls back and refuses when restoration wins at the nested write", async () => {
    mockedPrisma.user.findUnique
      .mockResolvedValueOnce(ordinaryUser)
      .mockResolvedValueOnce({
        email: "drifted-reviewer@example.test",
        phone: "+15550001002",
        termsVersion: "primary-staging-only",
        privacyVersion: "primary-staging-only",
      });
    mockedPrisma.user.update.mockRejectedValue(new Error("serialization conflict"));

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
    });
  });

  it("does not misclassify an unrelated wallet failure as staging", async () => {
    const failure = new Error("seller write failed");
    mockedPrisma.user.update.mockRejectedValue(failure);

    await expect(POST(request())).rejects.toBe(failure);
  });
});
