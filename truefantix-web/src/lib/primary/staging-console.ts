import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";
import { requirePrimaryPreflight } from "./config";

export const STAGING_ORGANIZER_EMAIL = "organizer@primary-staging.example.invalid";
export const STAGING_ADMIN_EMAIL = "admin@primary-staging.example.invalid";

const STAGING_USERS = {
  organizer: {
    email: STAGING_ORGANIZER_EMAIL,
    role: "USER" as UserRole,
    firstName: "Staging",
    lastName: "Organizer",
    phone: "+15550001001",
  },
  admin: {
    email: STAGING_ADMIN_EMAIL,
    role: "ADMIN" as UserRole,
    firstName: "Staging",
    lastName: "Reviewer",
    phone: "+15550001002",
  },
} as const;

const SYNTHETIC_EMAIL_DOMAIN = "primary-staging.example.invalid";
const SYNTHETIC_PHONE = /^\+1555\d{7}$/;

export type StagingPersona = keyof typeof STAGING_USERS;

export class PrimaryStagingConsoleUnavailableError extends Error {
  readonly code = "PRIMARY_STAGING_CONSOLE_UNAVAILABLE";

  constructor(readonly reason: string) {
    super("Primary staging console is unavailable.");
    this.name = "PrimaryStagingConsoleUnavailableError";
  }
}

export class PrimaryStagingConsoleInputError extends Error {
  readonly code = "SYNTHETIC_CONTACT_REQUIRED";

  constructor() {
    super("Only reserved synthetic staging contact data is accepted.");
    this.name = "PrimaryStagingConsoleInputError";
  }
}

export function getPrimaryStagingConsoleGate(env: NodeJS.ProcessEnv = process.env) {
  if (env.PRIMARY_STAGING_CONSOLE_ENABLED?.trim().toLowerCase() !== "true") {
    return { ready: false as const, reason: "CONSOLE_DISABLED" };
  }

  try {
    const capability = requirePrimaryPreflight(env);
    if (capability.environmentId !== "isolated-preview" || env.VERCEL_ENV !== "preview") {
      return { ready: false as const, reason: "ISOLATED_PREVIEW_REQUIRED" };
    }
    if ((env.PRIMARY_STAGING_CONSOLE_ACCESS_TOKEN?.trim().length ?? 0) < 32) {
      return { ready: false as const, reason: "ACCESS_TOKEN_REQUIRED" };
    }
    return { ready: true as const, capability };
  } catch {
    return { ready: false as const, reason: "PRIMARY_PREFLIGHT_REQUIRED" };
  }
}

export function verifyPrimaryStagingAccessToken(
  supplied: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
) {
  requirePrimaryStagingConsole(env);
  const expected = env.PRIMARY_STAGING_CONSOLE_ACCESS_TOKEN?.trim() ?? "";
  const suppliedDigest = createHash("sha256").update(supplied ?? "").digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

export function requirePrimaryStagingConsole(env: NodeJS.ProcessEnv = process.env) {
  const result = getPrimaryStagingConsoleGate(env);
  if (!result.ready) throw new PrimaryStagingConsoleUnavailableError(result.reason);
  return result.capability;
}

export function isPrimaryStagingSyntheticEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  return normalized === STAGING_ORGANIZER_EMAIL || normalized === STAGING_ADMIN_EMAIL;
}

export function primaryStagingSyntheticContactEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const [local, domain, extra] = normalized.split("@");
  if (!local || domain !== SYNTHETIC_EMAIL_DOMAIN || extra !== undefined) {
    throw new PrimaryStagingConsoleInputError();
  }
  return normalized;
}

export function primaryStagingSyntheticContactPhone(phone: string | undefined) {
  const normalized = phone?.trim();
  if (!normalized) return undefined;
  if (!SYNTHETIC_PHONE.test(normalized)) throw new PrimaryStagingConsoleInputError();
  return normalized;
}

function isExpectedStagingPersona(email: string, role: UserRole) {
  const normalized = email.trim().toLowerCase();
  return Object.values(STAGING_USERS).some(
    (definition) => definition.email === normalized && definition.role === role,
  );
}

export async function ensurePrimaryStagingPersona(persona: StagingPersona) {
  requirePrimaryStagingConsole();
  const definition = STAGING_USERS[persona];
  const verifiedAt = new Date();
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);

  return prisma.user.upsert({
    where: { email: definition.email },
    create: {
      email: definition.email,
      passwordHash,
      emailVerifiedAt: verifiedAt,
      firstName: definition.firstName,
      lastName: definition.lastName,
      displayName: `${definition.firstName} ${definition.lastName}`,
      phone: definition.phone,
      phoneVerifiedAt: verifiedAt,
      streetAddress1: "1 Synthetic Way",
      city: "Toronto",
      region: "ON",
      postalCode: "M5V 0A1",
      country: "CA",
      role: definition.role,
      canBuy: false,
      canComment: false,
      canSell: false,
      termsAcceptedAt: verifiedAt,
      termsVersion: "primary-staging-only",
      privacyAcceptedAt: verifiedAt,
      privacyVersion: "primary-staging-only",
    },
    update: {
      role: definition.role,
      firstName: definition.firstName,
      lastName: definition.lastName,
      displayName: `${definition.firstName} ${definition.lastName}`,
      phone: definition.phone,
      streetAddress1: "1 Synthetic Way",
      streetAddress2: null,
      city: "Toronto",
      region: "ON",
      postalCode: "M5V 0A1",
      country: "CA",
      emailVerifiedAt: verifiedAt,
      phoneVerifiedAt: verifiedAt,
      isBanned: false,
      canBuy: false,
      canComment: false,
      canSell: false,
    },
    select: { id: true, email: true, firstName: true, lastName: true, role: true },
  });
}

export async function requirePrimaryStagingActor() {
  requirePrimaryStagingConsole();
  const userId = await getUserIdFromSessionCookie();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      isBanned: true,
    },
  });

  if (
    !user ||
    user.isBanned ||
    !user.emailVerifiedAt ||
    !user.phoneVerifiedAt ||
    !isExpectedStagingPersona(user.email, user.role)
  ) {
    return null;
  }

  return user;
}
