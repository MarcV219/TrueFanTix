import { createHash } from "node:crypto";
import type { LegacySellerAccountCommand, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

type Tx = Prisma.TransactionClient;

export const SELLER_ONBOARDING_STAGING_ORIGIN = "https://truefantix-staging-preview.vercel.app";
export const SELLER_ONBOARDING_PRODUCTION_ORIGIN = "https://www.truefantix.com";
export const SELLER_ONBOARDING_TEST_ORIGIN = "https://seller-onboarding.test.invalid";

const BUSINESS_PROFILE_MCC = "7922";
const BUSINESS_PROFILE_DESCRIPTION =
  "Individual seller listing personal event tickets at or below face value through the TrueFanTix marketplace.";

export class ManagedAccountSellerOnboardingError extends Error {}
export class SellerOnboardingVerificationError extends Error {}
export class SellerAccountAuthorizationChangedError extends Error {}
export class SellerAccountReconciliationRequiredError extends Error {}
export class SellerAccountMissingError extends Error {}

type CurrentSellerOnboardingUser = {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  phone: string;
  phoneVerifiedAt: Date | null;
  firstName: string;
  lastName: string;
  streetAddress1: string;
  streetAddress2: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  termsVersion: string | null;
  privacyVersion: string | null;
  isBanned: boolean;
  canSell: boolean;
  seller: {
    id: string;
    stripeAccountId: string | null;
  } | null;
};

export type SellerAccountProviderEvidence = {
  id: string;
  type: string;
  country: string;
  capabilities: Record<string, unknown>;
  metadata: Record<string, unknown>;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

export type SellerLinkAuthorizationSnapshot = {
  userId: string;
  sellerId: string;
  stripeAccountId: string;
  linkKind: "ONBOARDING" | "LOGIN";
  refreshUrl: string | null;
  returnUrl: string | null;
};

function exactOrigin(value: string) {
  const trimmed = value.trim().replace(/\/$/, "");
  const parsed = new URL(trimmed);
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.origin !== trimmed
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("Invalid seller-onboarding application origin");
  }
  return parsed.origin;
}

export function canonicalSellerOnboardingOrigin(env: NodeJS.ProcessEnv = process.env) {
  const configured = [env.NEXT_PUBLIC_APP_URL, env.APP_ORIGIN]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(exactOrigin);
  if (configured.length === 0 || configured.some((origin) => origin !== configured[0])) {
    throw new Error("Seller onboarding requires one matching configured application origin");
  }

  const origin = configured[0];
  const isolatedPreview = env.PRIMARY_TICKETING_ENVIRONMENT_ID === "isolated-preview"
    || env.PRIMARY_TICKETING_DEPLOYMENT_ID === "isolated-preview"
    || env.VERCEL_ENV === "preview";
  if (isolatedPreview && origin !== SELLER_ONBOARDING_STAGING_ORIGIN) {
    throw new Error("Seller onboarding origin does not match the isolated-preview identity");
  }
  const isolatedTest = env.PRIMARY_TICKETING_ENVIRONMENT_ID === "isolated-test"
    || env.PRIMARY_TICKETING_DEPLOYMENT_ID === "isolated-test"
    || env.NODE_ENV === "test";
  if (isolatedTest && origin !== SELLER_ONBOARDING_TEST_ORIGIN) {
    throw new Error("Seller onboarding origin does not match the isolated-test identity");
  }
  if (env.VERCEL_ENV === "production" && origin !== SELLER_ONBOARDING_PRODUCTION_ORIGIN) {
    throw new Error("Seller onboarding origin does not match the production identity");
  }
  if (!isolatedPreview && !isolatedTest && env.VERCEL_ENV !== "production") {
    throw new Error("Seller onboarding origin requires a recognized deployment identity");
  }
  return origin;
}

function normalizeCountry(country: string) {
  const normalized = country.trim().toUpperCase();
  if (normalized === "CA" || normalized === "CANADA") return "CA";
  if (["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(normalized)) return "US";
  if (/^[A-Z]{2}$/.test(normalized)) return normalized;
  return "CA";
}

function normalized(value: string) {
  return value.trim();
}

function sellerDisplayName(user: Pick<CurrentSellerOnboardingUser, "firstName" | "lastName">) {
  return `${user.firstName} ${user.lastName}`.trim();
}

type SellerAccountAuthorization = {
  userId: string;
  sellerId: string;
  actorUserId: string;
  authorizedCanSell: boolean;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  streetAddress1: string;
  streetAddress2: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  accountType: "EXPRESS";
  requestedCapabilities: { transfers: true };
  payoutScheduleInterval: "DAILY";
  payoutDelayDays: "MINIMUM";
  businessProfileMcc: "7922";
  businessProfileUrl: string;
  businessProfileDescription: string;
  providerMetadata: { userId: string; sellerId: string; platform: "TrueFanTix" };
  authorizedAt: Date;
};

function commandDigest(input: SellerAccountAuthorization) {
  return createHash("sha256").update(JSON.stringify([
    "legacy-seller-account-v1",
    input.userId,
    input.sellerId,
    input.actorUserId,
    input.authorizedCanSell,
    input.firstName,
    input.lastName,
    input.email,
    input.phone,
    input.streetAddress1,
    input.streetAddress2,
    input.city,
    input.region,
    input.postalCode,
    input.country,
    input.accountType,
    input.requestedCapabilities.transfers,
    input.payoutScheduleInterval,
    input.payoutDelayDays,
    input.businessProfileMcc,
    input.businessProfileUrl,
    input.businessProfileDescription,
    input.providerMetadata.userId,
    input.providerMetadata.sellerId,
    input.providerMetadata.platform,
    input.authorizedAt.toISOString(),
    `truefantix:seller-account:${input.sellerId}`,
  ])).digest("hex");
}

function storedAuthorization(command: LegacySellerAccountCommand): SellerAccountAuthorization {
  return {
    userId: command.userId,
    sellerId: command.sellerId,
    actorUserId: command.actorUserId,
    authorizedCanSell: command.authorizedCanSell,
    firstName: command.firstName,
    lastName: command.lastName,
    email: command.email,
    phone: command.phone,
    streetAddress1: command.streetAddress1,
    streetAddress2: command.streetAddress2,
    city: command.city,
    region: command.region,
    postalCode: command.postalCode,
    country: command.country,
    accountType: command.accountType as "EXPRESS",
    requestedCapabilities: command.requestedCapabilities as { transfers: true },
    payoutScheduleInterval: command.payoutScheduleInterval as "DAILY",
    payoutDelayDays: command.payoutDelayDays as "MINIMUM",
    businessProfileMcc: command.businessProfileMcc as "7922",
    businessProfileUrl: command.businessProfileUrl,
    businessProfileDescription: command.businessProfileDescription,
    providerMetadata: command.providerMetadata as SellerAccountAuthorization["providerMetadata"],
    authorizedAt: command.authorizedAt,
  };
}

function assertStoredCommand(command: LegacySellerAccountCommand) {
  if (command.commandDigest !== commandDigest(storedAuthorization(command))) {
    throw new SellerAccountAuthorizationChangedError("Seller account command digest mismatch");
  }
}

function sameAuthorization(command: LegacySellerAccountCommand, input: SellerAccountAuthorization) {
  return command.commandDigest === commandDigest({ ...input, authorizedAt: command.authorizedAt });
}

function authorizationFor(
  user: CurrentSellerOnboardingUser,
  sellerId: string,
  origin: string,
  authorizedAt: Date,
): SellerAccountAuthorization {
  return {
    userId: user.id,
    sellerId,
    actorUserId: user.id,
    authorizedCanSell: user.canSell,
    firstName: normalized(user.firstName),
    lastName: normalized(user.lastName),
    email: normalized(user.email).toLowerCase(),
    phone: normalized(user.phone),
    streetAddress1: normalized(user.streetAddress1),
    streetAddress2: user.streetAddress2?.trim() || null,
    city: normalized(user.city),
    region: normalized(user.region),
    postalCode: normalized(user.postalCode),
    country: normalizeCountry(user.country),
    accountType: "EXPRESS",
    requestedCapabilities: { transfers: true },
    payoutScheduleInterval: "DAILY",
    payoutDelayDays: "MINIMUM",
    businessProfileMcc: BUSINESS_PROFILE_MCC,
    businessProfileUrl: `${origin}/seller/${encodeURIComponent(sellerId)}`,
    businessProfileDescription: BUSINESS_PROFILE_DESCRIPTION,
    providerMetadata: { userId: user.id, sellerId, platform: "TrueFanTix" },
    authorizedAt,
  };
}

function assertCurrentVerified(user: CurrentSellerOnboardingUser) {
  if (!user.emailVerifiedAt || !user.phoneVerifiedAt) {
    throw new SellerOnboardingVerificationError();
  }
}

export async function runOrdinarySellerOnboardingOperation<T>(
  userId: string,
  operation: (tx: Tx, current: CurrentSellerOnboardingUser) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const binding = await tx.user.findUnique({
          where: { id: userId },
          select: { sellerId: true, seller: { select: { id: true } } },
        });
        const lockedSellerId = binding?.sellerId ?? binding?.seller?.id ?? null;
        if (lockedSellerId) {
          await tx.$queryRaw`SELECT "id" FROM "Seller" WHERE "id" = ${lockedSellerId} FOR UPDATE`;
        }
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            emailVerifiedAt: true,
            phone: true,
            phoneVerifiedAt: true,
            firstName: true,
            lastName: true,
            streetAddress1: true,
            streetAddress2: true,
            city: true,
            region: true,
            postalCode: true,
            country: true,
            termsVersion: true,
            privacyVersion: true,
            isBanned: true,
            canSell: true,
            seller: { select: { id: true, stripeAccountId: true } },
          },
        });

        if (!current || current.isBanned) throw new Error("ACCOUNT_NOT_FOUND");
        if (isPrimaryStagingManagedUser(current)) throw new ManagedAccountSellerOnboardingError();
        if (lockedSellerId !== (current.seller?.id ?? null)) {
          throw new SellerAccountAuthorizationChangedError("Seller binding changed during authorization");
        }
        return operation(tx, current);
      },
      { isolationLevel: "Serializable", timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof ManagedAccountSellerOnboardingError) throw error;
    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, phone: true, termsVersion: true, privacyVersion: true },
    });
    if (current && isPrimaryStagingManagedUser(current)) {
      throw new ManagedAccountSellerOnboardingError();
    }
    throw error;
  }
}

export async function stageLegacySellerAccountCommand(tx: Tx, input: SellerAccountAuthorization) {
  const existing = await tx.legacySellerAccountCommand.findUnique({ where: { userId: input.userId } });
  if (existing) {
    assertStoredCommand(existing);
    if (!sameAuthorization(existing, input)) {
      throw new SellerAccountAuthorizationChangedError(
        "The existing seller account command does not match the current immutable authorization",
      );
    }
    return existing;
  }
  return tx.legacySellerAccountCommand.create({
    data: {
      ...input,
      requestedCapabilities: input.requestedCapabilities,
      providerMetadata: input.providerMetadata,
      commandDigest: commandDigest(input),
      idempotencyKey: `truefantix:seller-account:${input.sellerId}`,
    },
  });
}

export async function authorizeSellerAccountStart(userId: string, origin: string) {
  return runOrdinarySellerOnboardingOperation(userId, async (tx, current) => {
    assertCurrentVerified(current);
    let seller = current.seller;
    if (!seller) {
      if (current.canSell) {
        throw new SellerAccountAuthorizationChangedError("Selling capability has no seller binding");
      }
      const created = await tx.seller.create({
        data: {
          name: sellerDisplayName(current),
          status: "PENDING",
          statusUpdatedAt: new Date(),
        },
        select: { id: true, stripeAccountId: true },
      });
      await tx.user.update({ where: { id: current.id }, data: { sellerId: created.id } });
      seller = created;
    }

    if (seller.stripeAccountId) {
      const command = await tx.legacySellerAccountCommand.findUnique({ where: { userId } });
      if (command) {
        assertStoredCommand(command);
        if (command.status !== "SUCCEEDED" || command.providerAccountId !== seller.stripeAccountId) {
          throw new SellerAccountReconciliationRequiredError();
        }
      }
      return { kind: "ACCOUNT_READY" as const, sellerId: seller.id, stripeAccountId: seller.stripeAccountId };
    }

    const authorizedAt = new Date();
    const authorization = authorizationFor(current, seller.id, origin, authorizedAt);
    const command = await stageLegacySellerAccountCommand(tx, authorization);
    return { kind: "COMMAND" as const, command };
  });
}

export async function claimLegacySellerAccountCommand(commandId: string, dispatchStartedAt = new Date()) {
  return prisma.$transaction(
    (tx) => claimLegacySellerAccountCommandInTransaction(tx, commandId, dispatchStartedAt),
    { isolationLevel: "Serializable", timeout: 120_000 },
  );
}

export async function claimLegacySellerAccountCommandInTransaction(
  tx: Tx,
  commandId: string,
  dispatchStartedAt = new Date(),
) {
  const current = await tx.legacySellerAccountCommand.findUnique({ where: { id: commandId } });
  if (!current || current.status !== "NOT_SENT") return null;
  assertStoredCommand(current);
  const claimed = await tx.legacySellerAccountCommand.updateMany({
    where: { id: commandId, status: "NOT_SENT", commandDigest: current.commandDigest },
    data: { status: "ATTEMPTING", dispatchStartedAt },
  });
  if (claimed.count !== 1) return null;
  return tx.legacySellerAccountCommand.findUniqueOrThrow({ where: { id: commandId } });
}

export function sellerAccountCreateParams(command: LegacySellerAccountCommand) {
  assertStoredCommand(command);
  return {
    type: "express",
    country: command.country,
    email: command.email,
    business_type: "individual",
    business_profile: {
      mcc: command.businessProfileMcc,
      url: command.businessProfileUrl,
      product_description: command.businessProfileDescription,
    },
    individual: {
      first_name: command.firstName,
      last_name: command.lastName,
      email: command.email,
      phone: command.phone || undefined,
      address: {
        line1: command.streetAddress1 || undefined,
        line2: command.streetAddress2 || undefined,
        city: command.city || undefined,
        state: command.region || undefined,
        postal_code: command.postalCode || undefined,
        country: command.country,
      },
    },
    capabilities: { transfers: { requested: true } },
    settings: { payouts: { schedule: { interval: "daily", delay_days: "minimum" } } },
    metadata: command.providerMetadata as Record<string, string>,
  };
}

export function sellerAccountProviderEvidence(account: Record<string, unknown>): SellerAccountProviderEvidence | null {
  const id = typeof account.id === "string" ? account.id.trim() : "";
  const type = typeof account.type === "string" ? account.type.trim().toLowerCase() : "";
  const country = typeof account.country === "string" ? account.country.trim().toUpperCase() : "";
  const capabilities = account.capabilities;
  const metadata = account.metadata;
  if (!id || !type || !/^[A-Z]{2}$/.test(country)
    || !capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)
    || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return {
    id,
    type,
    country,
    capabilities: capabilities as Record<string, unknown>,
    metadata: metadata as Record<string, unknown>,
    detailsSubmitted: account.details_submitted === true,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
  };
}

function evidenceMatches(command: LegacySellerAccountCommand, evidence: SellerAccountProviderEvidence) {
  const metadata = command.providerMetadata as Record<string, unknown>;
  const sorted = (value: Record<string, unknown>) => Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
  return evidence.type === command.accountType.toLowerCase()
    && evidence.country === command.country
    && JSON.stringify(sorted(evidence.metadata)) === JSON.stringify(sorted(metadata))
    && Object.prototype.hasOwnProperty.call(evidence.capabilities, "transfers");
}

function evidenceData(evidence?: SellerAccountProviderEvidence) {
  if (!evidence) return {};
  return {
    providerAccountId: evidence.id,
    providerAccountType: evidence.type,
    providerCountry: evidence.country,
    providerCapabilities: evidence.capabilities as Prisma.InputJsonValue,
    providerReturnedMetadata: evidence.metadata as Prisma.InputJsonValue,
    providerDetailsSubmitted: evidence.detailsSubmitted,
    providerChargesEnabled: evidence.chargesEnabled,
    providerPayoutsEnabled: evidence.payoutsEnabled,
  };
}

export async function markSellerAccountReconciliationRequired(
  commandId: string,
  failureReason: string,
  evidence?: SellerAccountProviderEvidence,
  completedAt = new Date(),
) {
  return prisma.$transaction((tx) => markSellerAccountReconciliationRequiredInTransaction(
    tx,
    commandId,
    failureReason,
    evidence,
    completedAt,
  ), { isolationLevel: "Serializable", timeout: 120_000 });
}

export async function markSellerAccountReconciliationRequiredInTransaction(
  tx: Tx,
  commandId: string,
  failureReason: string,
  evidence?: SellerAccountProviderEvidence,
  completedAt = new Date(),
) {
  return tx.legacySellerAccountCommand.updateMany({
    where: { id: commandId, status: "ATTEMPTING" },
    data: {
      status: "RECONCILIATION_REQUIRED",
      ...evidenceData(evidence),
      failureReason,
      completedAt,
    },
  });
}

export async function finalizeLegacySellerAccountCommand(
  commandId: string,
  evidence: SellerAccountProviderEvidence,
  completedAt = new Date(),
) {
  return prisma.$transaction(
    (tx) => finalizeLegacySellerAccountCommandInTransaction(tx, commandId, evidence, completedAt),
    { isolationLevel: "Serializable", timeout: 120_000 },
  );
}

export async function finalizeLegacySellerAccountCommandInTransaction(
  tx: Tx,
  commandId: string,
  evidence: SellerAccountProviderEvidence,
  completedAt = new Date(),
) {
  await tx.$queryRaw`SELECT "id" FROM "LegacySellerAccountCommand" WHERE "id" = ${commandId} FOR UPDATE`;
  const command = await tx.legacySellerAccountCommand.findUniqueOrThrow({ where: { id: commandId } });
  if (command.status !== "ATTEMPTING") throw new SellerAccountReconciliationRequiredError();
  assertStoredCommand(command);
  if (!evidenceMatches(command, evidence)) throw new SellerAccountReconciliationRequiredError();

  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${command.userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Seller" WHERE "id" = ${command.sellerId} FOR UPDATE`;
  const current = await tx.user.findUnique({
      where: { id: command.userId },
      select: {
        id: true, email: true, phone: true, termsVersion: true, privacyVersion: true,
        emailVerifiedAt: true, phoneVerifiedAt: true, isBanned: true, canSell: true,
        seller: { select: { id: true, stripeAccountId: true } },
      },
    });
  if (!current || current.isBanned || !current.emailVerifiedAt || !current.phoneVerifiedAt
      || isPrimaryStagingManagedUser(current) || current.canSell !== command.authorizedCanSell
      || current.seller?.id !== command.sellerId
      || (current.seller.stripeAccountId !== null && current.seller.stripeAccountId !== evidence.id)) {
    throw new SellerAccountReconciliationRequiredError();
  }

  if (current.seller.stripeAccountId === null) {
    await tx.seller.update({
        where: { id: command.sellerId },
        data: {
          stripeAccountId: evidence.id,
          stripeDetailsSubmitted: evidence.detailsSubmitted,
          stripeChargesEnabled: evidence.chargesEnabled,
          stripePayoutsEnabled: evidence.payoutsEnabled,
        },
    });
  }
  const finalized = await tx.legacySellerAccountCommand.updateMany({
      where: { id: command.id, status: "ATTEMPTING" },
      data: { status: "SUCCEEDED", ...evidenceData(evidence), completedAt },
  });
  if (finalized.count !== 1) throw new SellerAccountReconciliationRequiredError();
  return { userId: command.userId, sellerId: command.sellerId, stripeAccountId: evidence.id };
}

export async function resolveSellerAccountCommand(commandId: string) {
  const command = await prisma.legacySellerAccountCommand.findUnique({ where: { id: commandId } });
  if (!command) throw new SellerAccountReconciliationRequiredError();
  assertStoredCommand(command);
  if (command.status !== "SUCCEEDED" || !command.providerAccountId) {
    throw new SellerAccountReconciliationRequiredError();
  }
  return command;
}

export async function authorizeSellerLinkSnapshot(
  userId: string,
  linkKind: "ONBOARDING" | "LOGIN",
  origin?: string,
): Promise<SellerLinkAuthorizationSnapshot> {
  return runOrdinarySellerOnboardingOperation(userId, async (_tx, current) => {
    assertCurrentVerified(current);
    if (!current.seller?.stripeAccountId) throw new SellerAccountMissingError();
    return {
      userId: current.id,
      sellerId: current.seller.id,
      stripeAccountId: current.seller.stripeAccountId,
      linkKind,
      refreshUrl: linkKind === "ONBOARDING" ? `${origin}/account?stripe=refresh` : null,
      returnUrl: linkKind === "ONBOARDING" ? `${origin}/account?stripe=return` : null,
    };
  });
}
