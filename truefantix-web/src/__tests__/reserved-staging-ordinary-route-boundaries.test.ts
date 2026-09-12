/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";
import { requireUser } from "@/lib/auth/guards";
import { GET as getMe } from "@/app/api/auth/me/route";
import { POST as changePassword } from "@/app/api/account/security/password/route";
import { GET as getSellerOnboardingStatus } from "@/app/api/sellers/onboarding/status/route";
import { POST as debugVerifyMe } from "@/app/api/debug/verify-me/route";
import { POST as debugApproveSeller } from "@/app/api/debug/approve-me-as-seller/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    seller: { update: jest.fn() },
    session: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/session", () => ({
  getUserIdFromSessionCookie: jest.fn(),
  clearSessionCookie: jest.fn(),
  getCurrentSessionTokenHash: jest.fn(),
}));

jest.mock("@/lib/auth/guards", () => ({
  requireUser: jest.fn(),
}));

jest.mock("@/lib/security/csrf", () => ({
  enforceOriginAndCsrf: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock("@/lib/rate-limit", () => ({
  applyRateLimit: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock("@/lib/validation", () => ({
  schemas: { passwordChange: {} },
  validateRequest: jest.fn(),
}));

jest.mock("@/lib/security/debug-access", () => ({
  requireDebugAccess: jest.fn().mockReturnValue({ ok: true }),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock };
  seller: { update: jest.Mock };
};
const mockedSession = getUserIdFromSessionCookie as jest.MockedFunction<
  typeof getUserIdFromSessionCookie
>;
const mockedRequireUser = requireUser as jest.MockedFunction<typeof requireUser>;

function consoleOnlyResponse() {
  return Response.json(
    {
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
      message: "This managed account is restricted to the staging console.",
    },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}

function request(path: string) {
  return new Request(`https://preview.example${path}`, { method: "POST" });
}

async function expectConsoleOnly(response: Response) {
  expect(response.status).toBe(403);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("cache-control")).toContain("private");
  await expect(response.json()).resolves.toMatchObject({
    ok: false,
    error: "STAGING_CONSOLE_ONLY",
  });
}

describe("reserved staging personas cannot enter direct ordinary session routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSession.mockResolvedValue("staging-admin");
    mockedRequireUser.mockResolvedValue({
      ok: false,
      res: consoleOnlyResponse(),
    } as never);
  });

  it("does not expose a reserved persona through ordinary session introspection", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "staging-admin",
      email: "admin@primary-staging.example.invalid",
      phone: "+15550001002",
      firstName: "Staging",
      lastName: "Reviewer",
      displayName: "Staging Reviewer",
      sellerId: null,
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      role: "ADMIN",
      isBanned: false,
      canBuy: false,
      canComment: false,
      canSell: false,
      seller: null,
    });

    await expectConsoleOnly(await getMe());
  });

  it("does not expose a managed persona whose email drifted", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "staging-admin",
      email: "drifted-reviewer@example.test",
      phone: "+15550001002",
      termsVersion: "primary-staging-only",
      privacyVersion: "primary-staging-only",
      firstName: "Staging",
      lastName: "Reviewer",
      displayName: "Staging Reviewer",
      sellerId: null,
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      role: "ADMIN",
      isBanned: false,
      canBuy: false,
      canComment: false,
      canSell: false,
      seller: null,
    });

    await expectConsoleOnly(await getMe());
  });

  it("blocks ordinary password verification and mutation", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "staging-admin",
      email: "admin@primary-staging.example.invalid",
      passwordHash: "synthetic-no-login",
      isBanned: false,
    });

    await expectConsoleOnly(
      await changePassword(request("/api/account/security/password")),
    );

    expect(mockedPrisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("blocks password mutation after a managed persona email drift", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "staging-admin",
      email: "drifted-reviewer@example.test",
      phone: "+15550001002",
      termsVersion: "primary-staging-only",
      privacyVersion: "primary-staging-only",
      passwordHash: "synthetic-no-login",
      isBanned: false,
    });

    await expectConsoleOnly(
      await changePassword(request("/api/account/security/password")),
    );
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("blocks seller onboarding before calling a provider account", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "staging-admin",
      email: "admin@primary-staging.example.invalid",
      isBanned: false,
      seller: {
        id: "contaminated-seller",
        stripeAccountId: "acct_must_not_be_retrieved",
      },
    });

    await expectConsoleOnly(await getSellerOnboardingStatus());

    expect(mockedPrisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.seller.update).not.toHaveBeenCalled();
  });

  it("blocks provider access after a managed persona email drift", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "staging-admin",
      email: "drifted-reviewer@example.test",
      phone: "+15550001002",
      termsVersion: "primary-staging-only",
      privacyVersion: "primary-staging-only",
      isBanned: false,
      seller: {
        id: "contaminated-seller",
        stripeAccountId: "acct_must_not_be_retrieved",
      },
    });

    await expectConsoleOnly(await getSellerOnboardingStatus());
    expect(mockedPrisma.seller.update).not.toHaveBeenCalled();
  });

  it.each([
    ["verification", debugVerifyMe, "/api/debug/verify-me"],
    ["seller approval", debugApproveSeller, "/api/debug/approve-me-as-seller"],
  ] as const)("blocks debug %s before mutation", async (_label, handler, path) => {
    await expectConsoleOnly(await handler(request(path)));

    expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    expect(mockedPrisma.seller.update).not.toHaveBeenCalled();
  });
});
