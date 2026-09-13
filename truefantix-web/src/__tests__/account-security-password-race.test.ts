/** @jest-environment node */

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  getCurrentSessionTokenHash,
  getUserIdFromSessionCookie,
} from "@/lib/auth/session";
import { validateRequest } from "@/lib/validation";
import { POST } from "@/app/api/account/security/password/route";

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    session: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/session", () => ({
  getCurrentSessionTokenHash: jest.fn(),
  getUserIdFromSessionCookie: jest.fn(),
}));

jest.mock("@/lib/validation", () => ({
  schemas: { passwordChange: {} },
  validateRequest: jest.fn(),
}));

jest.mock("@/lib/security/csrf", () => ({
  enforceOriginAndCsrf: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock("@/lib/rate-limit", () => ({
  applyRateLimit: jest.fn().mockResolvedValue({ ok: true }),
}));

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;
const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; updateMany: jest.Mock };
  session: { deleteMany: jest.Mock };
  $transaction: jest.Mock;
};
const mockedGetUserId = getUserIdFromSessionCookie as jest.MockedFunction<
  typeof getUserIdFromSessionCookie
>;
const mockedGetTokenHash = getCurrentSessionTokenHash as jest.MockedFunction<
  typeof getCurrentSessionTokenHash
>;
const mockedValidateRequest = validateRequest as jest.MockedFunction<typeof validateRequest>;

function request() {
  return new Request("https://preview.example/api/account/security/password", { method: "POST" });
}

describe("account password staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetUserId.mockResolvedValue("user-1");
    mockedGetTokenHash.mockResolvedValue("current-session-hash");
    mockedValidateRequest.mockReturnValue(jest.fn().mockResolvedValue({
      success: true,
      data: { currentPassword: "CurrentPassword123!", newPassword: "NewPassword123!" },
    }) as never);
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "ordinary@example.test",
      phone: "+14165550199",
      termsVersion: "v1",
      privacyVersion: "v1",
      passwordHash: "old-password-hash",
      isBanned: false,
    });
    mockedBcrypt.compare.mockResolvedValue(true as never);
    mockedBcrypt.hash.mockResolvedValue("new-password-hash" as never);
    mockedPrisma.$transaction.mockImplementation(async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma));
  });

  it("changes an ordinary password and preserves only its current bearer", async () => {
    mockedPrisma.user.updateMany.mockResolvedValue({ count: 1 });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mockedPrisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: "user-1",
        passwordHash: "old-password-hash",
        NOT: expect.any(Object),
      },
      data: { passwordHash: "new-password-hash" },
    });
    expect(mockedPrisma.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", tokenHash: { not: "current-session-hash" } },
    });
  });

  it("fails closed if persona restoration wins while bcrypt is running", async () => {
    mockedPrisma.user.updateMany.mockResolvedValue({ count: 0 });
    mockedPrisma.user.findUnique
      .mockReset()
      .mockResolvedValueOnce({
        id: "user-1",
        email: "ordinary@example.test",
        phone: "+14165550199",
        termsVersion: "v1",
        privacyVersion: "v1",
        passwordHash: "old-password-hash",
        isBanned: false,
      })
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
    expect(mockedPrisma.session.deleteMany).not.toHaveBeenCalled();
  });

  it("does not misclassify an ordinary concurrent password change as staging", async () => {
    mockedPrisma.user.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "INVALID_PASSWORD",
    });
    expect(mockedPrisma.session.deleteMany).not.toHaveBeenCalled();
  });
});
