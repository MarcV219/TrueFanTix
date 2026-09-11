/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";
import {
  getPrimaryStagingConsoleGate,
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
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email,
      firstName: "Synthetic",
      lastName: "User",
      role,
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      isBanned: false,
    });

    await expect(requirePrimaryStagingActor()).resolves.toBeNull();
  });

  it("returns the current exact synthetic persona and rejects banned actors", async () => {
    mockedSessionUserId.mockResolvedValue("organizer-1");
    const actor = {
      id: "organizer-1",
      email: "organizer@primary-staging.example.invalid",
      firstName: "Staging",
      lastName: "Organizer",
      role: "USER",
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      isBanned: false,
    };
    mockedPrisma.user.findUnique.mockResolvedValue(actor);
    await expect(requirePrimaryStagingActor()).resolves.toEqual(actor);

    mockedPrisma.user.findUnique.mockResolvedValue({ ...actor, isBanned: true });
    await expect(requirePrimaryStagingActor()).resolves.toBeNull();
  });
});
