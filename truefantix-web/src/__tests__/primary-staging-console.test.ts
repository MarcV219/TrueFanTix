/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";
import {
  ensurePrimaryStagingPersona,
  getPrimaryStagingConsoleGate,
  isPrimaryStagingManagedUser,
  isPrimaryStagingSyntheticEmail,
  isPrimaryStagingSyntheticPhone,
  primaryStagingSyntheticContactEmail,
  primaryStagingSyntheticContactPhone,
  requirePrimaryStagingActor,
  verifyPrimaryStagingAccessToken,
} from "@/lib/primary/staging-console";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), upsert: jest.fn() },
  },
}));

jest.mock("@/lib/auth/session", () => ({
  getUserIdFromSessionCookie: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; upsert: jest.Mock };
};
const mockedSessionUserId = getUserIdFromSessionCookie as jest.MockedFunction<typeof getUserIdFromSessionCookie>;
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
    mockedPrisma.user.upsert.mockResolvedValue({
      id: "organizer-1",
      email: "organizer@primary-staging.example.invalid",
      firstName: "Staging",
      lastName: "Organizer",
      role: "USER",
    });

    await ensurePrimaryStagingPersona("organizer");

    expect(mockedPrisma.user.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
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
