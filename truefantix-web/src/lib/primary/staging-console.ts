import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";
import { requirePrimaryPreflight } from "./config";

export const STAGING_ORGANIZER_EMAIL = "organizer@primary-staging.example.invalid";
export const STAGING_ADMIN_EMAIL = "admin@primary-staging.example.invalid";
export const STAGING_REFUND_BUYER_EMAIL = "refund-buyer@primary-staging.example.invalid";
export const STAGING_ORGANIZER_PHONE = "+15550001001";
export const STAGING_ADMIN_PHONE = "+15550001002";
export const STAGING_REFUND_BUYER_PHONE = "+15550001004";

const STAGING_USERS = {
  organizer: {
    email: STAGING_ORGANIZER_EMAIL,
    role: "USER" as UserRole,
    firstName: "Staging",
    lastName: "Organizer",
    phone: STAGING_ORGANIZER_PHONE,
  },
  admin: {
    email: STAGING_ADMIN_EMAIL,
    role: "ADMIN" as UserRole,
    firstName: "Staging",
    lastName: "Reviewer",
    phone: STAGING_ADMIN_PHONE,
  },
} as const;

const STAGING_LEGAL_VERSION = "primary-staging-only";

const STAGING_PROFILE = {
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
  termsVersion: STAGING_LEGAL_VERSION,
  privacyVersion: STAGING_LEGAL_VERSION,
  isBanned: false,
  banReason: null,
  sellerId: null,
  emailVerificationToken: null,
  passwordResetTokenHash: null,
} as const;

const SYNTHETIC_EMAIL_DOMAIN = "primary-staging.example.invalid";
const SYNTHETIC_PHONE = /^\+1555\d{7}$/;

export type StagingPersona = keyof typeof STAGING_USERS;

export function primaryStagingPersonaWhere(persona: StagingPersona): Prisma.UserWhereInput {
  const definition = STAGING_USERS[persona];
  return {
    email: definition.email,
    role: definition.role,
    firstName: definition.firstName,
    lastName: definition.lastName,
    displayName: `${definition.firstName} ${definition.lastName}`,
    phone: definition.phone,
    ...STAGING_PROFILE,
    emailVerifiedAt: { not: null },
    phoneVerifiedAt: { not: null },
    termsAcceptedAt: { not: null },
    privacyAcceptedAt: { not: null },
  };
}

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
  return [STAGING_ORGANIZER_EMAIL, STAGING_ADMIN_EMAIL, STAGING_REFUND_BUYER_EMAIL].includes(normalized);
}

export function isPrimaryStagingSyntheticPhone(phone: string) {
  const normalized = phone.trim().replace(/[^\d+]/g, "");
  return [STAGING_ORGANIZER_PHONE, STAGING_ADMIN_PHONE, STAGING_REFUND_BUYER_PHONE].includes(normalized);
}

export function isPrimaryStagingManagedUser(user: {
  email?: string | null;
  phone?: string | null;
  termsVersion?: string | null;
  privacyVersion?: string | null;
}) {
  return (!!user.email && isPrimaryStagingSyntheticEmail(user.email))
    || (!!user.phone && isPrimaryStagingSyntheticPhone(user.phone))
    || user.termsVersion === STAGING_LEGAL_VERSION
    || user.privacyVersion === STAGING_LEGAL_VERSION;
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
      ...STAGING_PROFILE,
      role: definition.role,
      termsAcceptedAt: verifiedAt,
      privacyAcceptedAt: verifiedAt,
    },
    update: {
      passwordHash,
      role: definition.role,
      firstName: definition.firstName,
      lastName: definition.lastName,
      displayName: `${definition.firstName} ${definition.lastName}`,
      phone: definition.phone,
      ...STAGING_PROFILE,
      emailVerifiedAt: verifiedAt,
      phoneVerifiedAt: verifiedAt,
      termsAcceptedAt: verifiedAt,
      privacyAcceptedAt: verifiedAt,
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
      displayName: true,
      phone: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      streetAddress1: true,
      streetAddress2: true,
      city: true,
      region: true,
      postalCode: true,
      country: true,
      notificationRadiusKm: true,
      notificationRadiusUnit: true,
      canBuy: true,
      canComment: true,
      canSell: true,
      termsAcceptedAt: true,
      termsVersion: true,
      privacyAcceptedAt: true,
      privacyVersion: true,
      isBanned: true,
      banReason: true,
      sellerId: true,
      emailVerificationToken: true,
      passwordResetTokenHash: true,
    },
  });

  if (!user || !isExpectedStagingPersona(user.email, user.role)) return null;
  const persona = user.email.trim().toLowerCase() === STAGING_ADMIN_EMAIL ? "admin" : "organizer";
  const exactFields = {
    ...STAGING_PROFILE,
    email: STAGING_USERS[persona].email,
    firstName: STAGING_USERS[persona].firstName,
    lastName: STAGING_USERS[persona].lastName,
    displayName: `${STAGING_USERS[persona].firstName} ${STAGING_USERS[persona].lastName}`,
    phone: STAGING_USERS[persona].phone,
  };
  if (
    !user.emailVerifiedAt
    || !user.phoneVerifiedAt
    || !user.termsAcceptedAt
    || !user.privacyAcceptedAt
    || Object.entries(exactFields).some(([key, value]) => user[key as keyof typeof user] !== value)
    || user.role !== STAGING_USERS[persona].role
  ) return null;

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt,
    phoneVerifiedAt: user.phoneVerifiedAt,
    isBanned: user.isBanned,
  };
}
