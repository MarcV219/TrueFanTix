import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createSessionExpiry,
  createSessionToken,
  getCurrentSessionTokenHash,
  getUserIdFromSessionCookie,
  setSessionCookie,
} from "@/lib/auth/session";
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

export function primaryStagingManagedUserWhere(): Prisma.UserWhereInput {
  return {
    OR: [
      {
        email: {
          in: [STAGING_ORGANIZER_EMAIL, STAGING_ADMIN_EMAIL, STAGING_REFUND_BUYER_EMAIL],
          mode: "insensitive",
        },
      },
      { phone: { in: [STAGING_ORGANIZER_PHONE, STAGING_ADMIN_PHONE, STAGING_REFUND_BUYER_PHONE] } },
      { termsVersion: STAGING_LEGAL_VERSION },
      { privacyVersion: STAGING_LEGAL_VERSION },
    ],
  };
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

const stagingPersonaSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
} as const;

async function restorePrimaryStagingPersona(
  tx: Prisma.TransactionClient,
  persona: StagingPersona,
  passwordHash: string,
) {
  const definition = STAGING_USERS[persona];
  const verifiedAt = new Date();
  const restored = {
    email: definition.email,
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
  };

  // Resolve by both reserved coordinates. An email-only upsert cannot recover a
  // drifted email because the existing row still owns the reserved phone.
  const candidates = await tx.user.findMany({
    where: {
      OR: [
        { email: definition.email },
        { phone: definition.phone },
      ],
    },
    select: {
      id: true,
      email: true,
      phone: true,
    },
    take: 2,
  });

  if (candidates.length > 1) {
    throw new PrimaryStagingConsoleUnavailableError("PERSONA_IDENTITY_CONFLICT");
  }

  const candidate = candidates[0];
  if (candidate) {
    const ownsAnotherPersonaCoordinate = Object.entries(STAGING_USERS).some(
      ([candidatePersona, candidateDefinition]) => candidatePersona !== persona
        && (candidate.email.trim().toLowerCase() === candidateDefinition.email
          || candidate.phone === candidateDefinition.phone),
    );
    if (ownsAnotherPersonaCoordinate) {
      throw new PrimaryStagingConsoleUnavailableError("PERSONA_IDENTITY_CONFLICT");
    }

    return tx.user.update({
      where: { id: candidate.id },
      data: restored,
      select: stagingPersonaSelect,
    });
  }

  return tx.user.create({
    data: restored,
    select: stagingPersonaSelect,
  });
}

export async function ensurePrimaryStagingPersona(persona: StagingPersona, db: typeof prisma = prisma) {
  requirePrimaryStagingConsole();
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);

  return db.$transaction(
    (tx) => restorePrimaryStagingPersona(tx, persona, passwordHash),
    { isolationLevel: "Serializable" },
  );
}

export async function establishPrimaryStagingPersonaSession(
  persona: StagingPersona,
  db: typeof prisma = prisma,
) {
  requirePrimaryStagingConsole();
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
  const { token, tokenHash } = createSessionToken();
  const expiresAt = createSessionExpiry();
  const currentTokenHash = await getCurrentSessionTokenHash();

  const actor = await db.$transaction(async (tx) => {
    const restored = await restorePrimaryStagingPersona(tx, persona, passwordHash);

    // A pre-existing session may have been issued before a managed identity was
    // restored. Revoke every managed staging bearer in the same transaction that
    // restores the exact persona, including identities recognized by immutable
    // staging markers after contact drift. Also revoke the caller's current bearer
    // so overwriting the browser cookie cannot leave an ordinary session valid.
    await tx.session.deleteMany({
      where: {
        OR: [
          { user: { is: primaryStagingManagedUserWhere() } },
          ...(currentTokenHash ? [{ tokenHash: currentTokenHash }] : []),
        ],
      },
    });
    await tx.session.create({ data: { userId: restored.id, tokenHash, expiresAt } });
    return restored;
  }, { isolationLevel: "Serializable" });

  await setSessionCookie(token);
  return actor;
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
