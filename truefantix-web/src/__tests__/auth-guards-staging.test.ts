/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";
import { enforceOriginAndCsrf } from "@/lib/security/csrf";
import { requireAdmin, requireUser, requireVerifiedUser } from "@/lib/auth/guards";

jest.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: jest.fn() } },
}));

jest.mock("@/lib/auth/session", () => ({
  getUserIdFromSessionCookie: jest.fn(),
}));

jest.mock("@/lib/security/csrf", () => ({
  enforceOriginAndCsrf: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
};
const mockedSession = getUserIdFromSessionCookie as jest.MockedFunction<typeof getUserIdFromSessionCookie>;
const mockedCsrf = enforceOriginAndCsrf as jest.MockedFunction<typeof enforceOriginAndCsrf>;

function request() {
  return new Request("https://preview.example/api/ordinary", { method: "POST" });
}

function stagingUser(email: string, role: "USER" | "ADMIN") {
  return {
    id: `staging-${role.toLowerCase()}`,
    email,
    phone: "+14165550123",
    termsVersion: "v1",
    privacyVersion: "v1",
    role,
    isBanned: false,
    emailVerifiedAt: new Date(),
    phoneVerifiedAt: new Date(),
    seller: null,
  };
}

async function expectConsoleOnly(result: Awaited<ReturnType<typeof requireUser>>) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected staging console restriction.");
  expect(result.res.status).toBe(403);
  expect(result.res.headers.get("cache-control")).toBe("private, no-store");
  await expect(result.res.json()).resolves.toMatchObject({
    ok: false,
    error: "STAGING_CONSOLE_ONLY",
  });
}

describe("ordinary auth guards reject reserved staging personas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSession.mockResolvedValue("reserved-user");
    mockedCsrf.mockResolvedValue({ ok: true } as never);
  });

  it.each([
    ["organizer", "organizer@primary-staging.example.invalid", "USER"],
    ["administrator", "admin@primary-staging.example.invalid", "ADMIN"],
    ["refund buyer", "refund-buyer@primary-staging.example.invalid", "USER"],
  ] as const)("blocks the reserved %s from requireUser routes", async (_persona, email, role) => {
    mockedPrisma.user.findUnique.mockResolvedValue(stagingUser(email, role));

    await expectConsoleOnly(await requireUser(request()));
  });

  it("blocks the reserved organizer from verified purchase and seller routes", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(
      stagingUser("organizer@primary-staging.example.invalid", "USER"),
    );

    await expectConsoleOnly(await requireVerifiedUser(request()));
  });

  it("blocks the reserved administrator from ordinary admin routes", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(
      stagingUser("admin@primary-staging.example.invalid", "ADMIN"),
    );

    await expectConsoleOnly(await requireAdmin(request()));
  });

  it("blocks a managed administrator whose email drifted away from the reserved address", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      ...stagingUser("drifted-reviewer@example.test", "ADMIN"),
      phone: "+15550001002",
      termsVersion: "primary-staging-only",
      privacyVersion: "primary-staging-only",
    });

    await expectConsoleOnly(await requireAdmin(request()));
  });

  it("does not change ordinary verified administrator access", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(
      stagingUser("ordinary-admin@example.test", "ADMIN"),
    );

    await expect(requireAdmin(request())).resolves.toMatchObject({
      ok: true,
      user: { email: "ordinary-admin@example.test", role: "ADMIN" },
    });
  });
});
