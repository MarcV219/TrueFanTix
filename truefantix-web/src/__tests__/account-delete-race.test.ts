/** @jest-environment node */

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { clearSessionCookie } from "@/lib/auth/session";
import { validateRequest } from "@/lib/validation";
import { POST } from "@/app/api/account/delete/route";

jest.mock("bcryptjs", () => ({ compare: jest.fn() }));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({ requireUser: jest.fn() }));

jest.mock("@/lib/auth/session", () => ({ clearSessionCookie: jest.fn() }));

jest.mock("@/lib/validation", () => ({
  schemas: { accountDelete: {} },
  validateRequest: jest.fn(),
}));

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;
const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; deleteMany: jest.Mock };
  $transaction: jest.Mock;
};
const mockedRequireUser = requireUser as jest.MockedFunction<typeof requireUser>;
const mockedClearSessionCookie = clearSessionCookie as jest.MockedFunction<
  typeof clearSessionCookie
>;
const mockedValidateRequest = validateRequest as jest.MockedFunction<typeof validateRequest>;

function request() {
  return new Request("https://preview.example/api/account/delete", { method: "POST" });
}

const ordinaryUser = {
  id: "user-1",
  email: "ordinary@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
  passwordHash: "old-password-hash",
  isBanned: false,
};

describe("account deletion staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireUser.mockResolvedValue({ ok: true, user: ordinaryUser } as never);
    mockedValidateRequest.mockReturnValue(jest.fn().mockResolvedValue({
      success: true,
      data: { password: "CurrentPassword123!" },
    }) as never);
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedBcrypt.compare.mockResolvedValue(true as never);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
  });

  it("deletes an ordinary account only while its observed password and identity still match", async () => {
    mockedPrisma.user.deleteMany.mockResolvedValue({ count: 1 });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mockedPrisma.user.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "user-1",
        passwordHash: "old-password-hash",
        NOT: expect.any(Object),
      },
    });
    expect(mockedClearSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("fails closed if persona restoration wins while bcrypt is running", async () => {
    mockedPrisma.user.deleteMany.mockResolvedValue({ count: 0 });
    mockedPrisma.user.findUnique
      .mockReset()
      .mockResolvedValueOnce(ordinaryUser)
      .mockResolvedValueOnce({
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
    expect(mockedClearSessionCookie).not.toHaveBeenCalled();
  });

  it("does not misclassify an ordinary concurrent password change as staging", async () => {
    mockedPrisma.user.deleteMany.mockResolvedValue({ count: 0 });

    const response = await POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "INVALID_CREDENTIALS",
    });
    expect(mockedClearSessionCookie).not.toHaveBeenCalled();
  });

  it("rechecks a managed identity that was restored before password verification", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      ...ordinaryUser,
      email: "drifted-reviewer@example.test",
      phone: "+15550001002",
      termsVersion: "primary-staging-only",
      privacyVersion: "primary-staging-only",
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mockedBcrypt.compare).not.toHaveBeenCalled();
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });
});
