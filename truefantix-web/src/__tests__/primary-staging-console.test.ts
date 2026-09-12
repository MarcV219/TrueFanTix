/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import {
  getCurrentSessionTokenHash,
  getUserIdFromSessionCookie,
  setSessionCookie,
} from "@/lib/auth/session";
import {
  establishPrimaryStagingPersonaSession,
  ensurePrimaryStagingPersona,
  getPrimaryStagingConsoleGate,
  isPrimaryStagingManagedUser,
  isPrimaryStagingSyntheticEmail,
  isPrimaryStagingSyntheticPhone,
  primaryStagingSyntheticContactEmail,
  primaryStagingSyntheticContactPhone,
  PrimaryStagingConsoleUnavailableError,
  requirePrimaryStagingActor,
  verifyPrimaryStagingAccessToken,
} from "@/lib/primary/staging-console";

const mockedTx = {
  user: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  session: { deleteMany: jest.fn(), create: jest.fn() },
};

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/session", () => ({
  createSessionExpiry: jest.fn(() => new Date("2037-01-01T00:00:00Z")),
  createSessionToken: jest.fn(() => ({ token: "new-staging-session-token", tokenHash: "new-staging-session-hash" })),
  getCurrentSessionTokenHash: jest.fn(),
  getUserIdFromSessionCookie: jest.fn(),
  setSessionCookie: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};
const mockedSessionUserId = getUserIdFromSessionCookie as jest.MockedFunction<typeof getUserIdFromSessionCookie>;
const mockedCurrentSessionHash = getCurrentSessionTokenHash as jest.MockedFunction<typeof getCurrentSessionTokenHash>;
const mockedSetSessionCookie = setSessionCookie as jest.MockedFunction<typeof setSessionCookie>;
const originalEnv = process.env;
const accessToken = "staging-access-token-that-is-longer-than-thirty-two-characters";
const previewEnv = {
  ...originalEnv,
  NODE_ENV: "production",
  VERCEL_ENV: "preview",
  PRIMARY_TICKETING_ENABLED: "true",
  PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-preview",
  PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-preview",
  DATABASE_URL: "postgresql://isolated@localhost/primary_ticketing_preview",
  PRIMARY_TICKETING_DATABASE_URL: "postgresql://isolated@localhost/primary_ticketing_preview",
  PRIMARY_STAGING_CONSOLE_ENABLED: "true",
  PRIMARY_STAGING_CONSOLE_ACCESS_TOKEN: accessToken,
} as NodeJS.ProcessEnv;

function managedOrganizer(overrides: Record<string, unknown> = {}) {
  const verifiedAt = new Date();
  return {
    id: "organizer-1",
    email: "organizer@primary-staging.example.invalid",
    firstName: "Staging",
    lastName: "Organizer",
    displayName: "Staging Organizer",
    phone: "+15550001001",
    emailVerifiedAt: verifiedAt,
    phoneVerifiedAt: verifiedAt,
    streetAddress1: "1 Synthetic Way",
    streetAddress2: null,
    city: "Toronto",
    region: "ON",
    postalCode: "M5V 0A1",
    country: "CA",
    notificationRadiusKm: null,
    notificationRadiusUnit: "KM",
    canBuy: false,
    canComment: false,
    canSell: false,
    termsAcceptedAt: verifiedAt,
    termsVersion: "primary-staging-only",
    privacyAcceptedAt: verifiedAt,
    privacyVersion: "primary-staging-only",
    isBanned: false,
    banReason: null,
    sellerId: null,
    emailVerificationToken: null,
    passwordResetTokenHash: null,
    role: "USER",
    ...overrides,
  };
}

describe("primary staging console boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.$transaction.mockImplementation(
      (callback: (tx: typeof mockedTx) => unknown) => callback(mockedTx),
    );
    mockedCurrentSessionHash.mockResolvedValue(null);
    process.env = { ...previewEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("opens only for the explicit isolated preview identity", () => {
    expect(getPrimaryStagingConsoleGate(previewEnv)).toMatchObject({ ready: true });
    expect(getPrimaryStagingConsoleGate({ ...previewEnv, PRIMARY_STAGING_CONSOLE_ENABLED: "false" })).toEqual({
      ready: false,
      reason: "CONSOLE_DISABLED",
    });
    expect(getPrimaryStagingConsoleGate({ ...previewEnv, VERCEL_ENV: "production" })).toEqual({
      ready: false,
      reason: "PRIMARY_PREFLIGHT_REQUIRED",
    });
    expect(getPrimaryStagingConsoleGate({ ...previewEnv, PRIMARY_STAGING_CONSOLE_ACCESS_TOKEN: "short" })).toEqual({
      ready: false,
      reason: "ACCESS_TOKEN_REQUIRED",
    });
  });

  it("compares the staging access token exactly", () => {
    expect(verifyPrimaryStagingAccessToken(accessToken, previewEnv)).toBe(true);
    expect(verifyPrimaryStagingAccessToken(`${accessToken}-wrong`, previewEnv)).toBe(false);
    expect(verifyPrimaryStagingAccessToken(null, previewEnv)).toBe(false);
  });

  it.each([
    "organizer@primary-staging.example.invalid",
    " ADMIN@PRIMARY-STAGING.EXAMPLE.INVALID ",
    "refund-buyer@primary-staging.example.invalid",
  ])("reserves the synthetic persona email from ordinary authentication: %s", (email) => {
    expect(isPrimaryStagingSyntheticEmail(email)).toBe(true);
  });

  it.each(["+15550001001", "+1 (555) 000-1002", "+15550001004"])(
    "reserves the synthetic persona phone from ordinary registration: %s",
    (phone) => {
      expect(isPrimaryStagingSyntheticPhone(phone)).toBe(true);
    },
  );

  it("does not reserve unrelated synthetic contacts", () => {
    expect(isPrimaryStagingSyntheticEmail("support@primary-staging.example.invalid")).toBe(false);
    expect(isPrimaryStagingSyntheticPhone("+15550001003")).toBe(false);
  });

  it("keeps a managed persona out of ordinary auth after one identity field drifts", () => {
    expect(isPrimaryStagingManagedUser({
      email: "drifted-reviewer@example.test",
      phone: "+15550001002",
      termsVersion: "primary-staging-only",
      privacyVersion: "primary-staging-only",
    })).toBe(true);
    expect(isPrimaryStagingManagedUser({
      email: "ordinary@example.test",
      phone: "+14165550123",
      termsVersion: "v1",
      privacyVersion: "v1",
    })).toBe(false);
  });

  it("rotates ordinary credentials when the access-token flow restores a persona", async () => {
    mockedTx.user.findMany.mockResolvedValue([{
      id: "organizer-1",
      email: "organizer@primary-staging.example.invalid",
      phone: "+15550001001",
    }]);
    mockedTx.user.update.mockResolvedValue({
      id: "organizer-1", email: "organizer@primary-staging.example.invalid",
      firstName: "Staging", lastName: "Organizer", role: "USER",
    });

    await ensurePrimaryStagingPersona("organizer");

    expect(mockedTx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "organizer-1" },
      data: expect.objectContaining({
        email: "organizer@primary-staging.example.invalid",
        phone: "+15550001001",
        passwordHash: expect.stringMatching(/^\$2[aby]\$/),
        canBuy: false,
        canComment: false,
        canSell: false,
        termsVersion: "primary-staging-only",
        privacyVersion: "primary-staging-only",
        emailVerificationToken: null,
        passwordResetTokenHash: null,
        sellerId: null,
      }),
    }));
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("restores the same persona row when its email drifted", async () => {
    mockedTx.user.findMany.mockResolvedValue([{
      id: "organizer-1",
      email: "drifted-organizer@example.test",
      phone: "+15550001001",
    }]);
    mockedTx.user.update.mockResolvedValue({
      id: "organizer-1", email: "organizer@primary-staging.example.invalid",
      firstName: "Staging", lastName: "Organizer", role: "USER",
    });

    await expect(ensurePrimaryStagingPersona("organizer")).resolves.toMatchObject({
      id: "organizer-1",
      email: "organizer@primary-staging.example.invalid",
    });
    expect(mockedTx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "organizer-1" },
      data: expect.objectContaining({
        email: "organizer@primary-staging.example.invalid",
        phone: "+15550001001",
      }),
    }));
    expect(mockedTx.user.create).not.toHaveBeenCalled();
  });

  it("revokes every prior persona session before installing the access-token session", async () => {
    mockedTx.user.findMany.mockResolvedValue([{
      id: "organizer-1",
      email: "drifted-organizer@example.test",
      phone: "+15550001001",
    }]);
    mockedTx.user.update.mockResolvedValue({
      id: "organizer-1", email: "organizer@primary-staging.example.invalid",
      firstName: "Staging", lastName: "Organizer", role: "USER",
    });

    await expect(establishPrimaryStagingPersonaSession("organizer")).resolves.toMatchObject({
      id: "organizer-1",
      email: "organizer@primary-staging.example.invalid",
    });

    expect(mockedTx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "organizer-1" } });
    expect(mockedTx.session.create).toHaveBeenCalledWith({
      data: {
        userId: "organizer-1",
        tokenHash: "new-staging-session-hash",
        expiresAt: new Date("2037-01-01T00:00:00Z"),
      },
    });
    expect(mockedSetSessionCookie).toHaveBeenCalledWith("new-staging-session-token");
    expect(mockedTx.session.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      mockedTx.session.create.mock.invocationCallOrder[0],
    );
    expect(mockedTx.session.create.mock.invocationCallOrder[0]).toBeLessThan(
      mockedSetSessionCookie.mock.invocationCallOrder[0],
    );
  });

  it("revokes the current bearer atomically when switching personas", async () => {
    mockedCurrentSessionHash.mockResolvedValue("current-admin-session-hash");
    mockedTx.user.findMany.mockResolvedValue([{
      id: "organizer-1",
      email: "organizer@primary-staging.example.invalid",
      phone: "+15550001001",
    }]);
    mockedTx.user.update.mockResolvedValue({
      id: "organizer-1", email: "organizer@primary-staging.example.invalid",
      firstName: "Staging", lastName: "Organizer", role: "USER",
    });

    await establishPrimaryStagingPersonaSession("organizer");

    expect(mockedTx.session.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { userId: "organizer-1" },
          { tokenHash: "current-admin-session-hash" },
        ],
      },
    });
  });

  it("fails closed when reserved coordinates resolve to different rows", async () => {
    mockedTx.user.findMany.mockResolvedValue([
      { id: "email-owner", email: "organizer@primary-staging.example.invalid", phone: "+15550001991" },
      { id: "phone-owner", email: "drifted-organizer@example.test", phone: "+15550001001" },
    ]);

    await expect(ensurePrimaryStagingPersona("organizer")).rejects.toMatchObject({
      code: "PRIMARY_STAGING_CONSOLE_UNAVAILABLE",
      reason: "PERSONA_IDENTITY_CONFLICT",
    } satisfies Partial<PrimaryStagingConsoleUnavailableError>);
    expect(mockedTx.user.update).not.toHaveBeenCalled();
    expect(mockedTx.user.create).not.toHaveBeenCalled();
  });

  it("does not repurpose another reserved persona", async () => {
    mockedTx.user.findMany.mockResolvedValue([{
      id: "admin-1",
      email: "admin@primary-staging.example.invalid",
      phone: "+15550001001",
    }]);

    await expect(ensurePrimaryStagingPersona("organizer")).rejects.toMatchObject({
      reason: "PERSONA_IDENTITY_CONFLICT",
    });
    expect(mockedTx.user.update).not.toHaveBeenCalled();
    expect(mockedTx.user.create).not.toHaveBeenCalled();
  });

  it("accepts only reserved synthetic contact coordinates", () => {
    expect(primaryStagingSyntheticContactEmail(" Test@PRIMARY-STAGING.EXAMPLE.INVALID ")).toBe(
      "test@primary-staging.example.invalid",
    );
    expect(primaryStagingSyntheticContactPhone(" +15550001099 ")).toBe("+15550001099");
    expect(primaryStagingSyntheticContactPhone(undefined)).toBeUndefined();
    expect(() => primaryStagingSyntheticContactEmail("person@example.com")).toThrow("synthetic staging contact");
    expect(() => primaryStagingSyntheticContactPhone("+14165550123")).toThrow("synthetic staging contact");
  });

  it.each([
    ["person@example.com", "USER"],
    ["organizer@primary-staging.example.invalid", "ADMIN"],
    ["admin@primary-staging.example.invalid", "USER"],
  ])("rejects a session whose email/role is not an exact synthetic persona", async (email, role) => {
    mockedSessionUserId.mockResolvedValue("user-1");
    mockedPrisma.user.findUnique.mockResolvedValue(managedOrganizer({ id: "user-1", email, role }));

    await expect(requirePrimaryStagingActor()).resolves.toBeNull();
  });

  it("returns the current exact synthetic persona and rejects banned actors", async () => {
    mockedSessionUserId.mockResolvedValue("organizer-1");
    const record = managedOrganizer();
    mockedPrisma.user.findUnique.mockResolvedValue(record);
    await expect(requirePrimaryStagingActor()).resolves.toEqual({
      id: record.id,
      email: record.email,
      firstName: record.firstName,
      lastName: record.lastName,
      role: record.role,
      emailVerifiedAt: record.emailVerifiedAt,
      phoneVerifiedAt: record.phoneVerifiedAt,
      isBanned: record.isBanned,
    });

    mockedPrisma.user.findUnique.mockResolvedValue({ ...record, isBanned: true });
    await expect(requirePrimaryStagingActor()).resolves.toBeNull();
  });

  it.each([
    ["phone", "+15550001999"],
    ["displayName", "Drifted Persona"],
    ["canBuy", true],
    ["canSell", true],
    ["termsVersion", "ordinary-terms"],
    ["sellerId", "seller-with-provider-state"],
    ["passwordResetTokenHash", "unexpected-reset-token"],
  ])("rejects a managed actor whose %s drifted", async (field, value) => {
    mockedSessionUserId.mockResolvedValue("organizer-1");
    mockedPrisma.user.findUnique.mockResolvedValue(managedOrganizer({ [field]: value }));

    await expect(requirePrimaryStagingActor()).resolves.toBeNull();
  });
});
