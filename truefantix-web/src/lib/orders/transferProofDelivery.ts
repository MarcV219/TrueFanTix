import { Prisma, type TransferProofDeliveryIntent } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { generateBuyerTransferConfirmationRequiredEmail, sendEmail, type EmailProvider } from "@/lib/email";
import { ADMIN_ACTIVITY_EMAIL, sendAdminActivityEmail } from "@/lib/adminActivityEmail";
import { reminderWindowStart } from "@/lib/orders/transferWorkflow";

const BUYER_KIND = "BUYER_CONFIRMATION_EMAIL";
const ADMIN_KIND = "ADMIN_TRANSFER_ACTIVITY_EMAIL";
const LEASE_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 5 * 60 * 1000;
const RESEND_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const BUYER_CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;

function providerIdempotencyKey(durableKey: string) {
  return `tft-transfer-proof-${createHash("sha256").update(durableKey).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Transfer-proof delivery envelope is not JSON-serializable");
  return encoded;
}

function deliveryEnvelopeDigest(input: {
  orderId: string;
  kind: string;
  recipient: string;
  payloadJson: unknown;
}) {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

function deliveryIdempotencyKey(orderId: string, windowStart: Date, kind: string, recipient: string) {
  return `${orderId}:${windowStart.toISOString()}:${kind}:${recipient}`;
}

function buyerNotificationIdempotencyKey(orderId: string, buyerUserId: string, windowStart: Date) {
  const canonicalIdentity = [
    "transfer-proof-confirmation",
    orderId,
    buyerUserId,
    windowStart.toISOString(),
  ].join(":");
  return `tft-notification-${createHash("sha256").update(canonicalIdentity).digest("hex")}`;
}

function configuredEmailProvider(): EmailProvider | null {
  if (process.env.RESEND_API_KEY?.trim()) return "RESEND";
  if (process.env.SENDGRID_API_KEY?.trim()) return "SENDGRID";
  return null;
}

function providerIsConfigured(provider: EmailProvider) {
  if (provider === "RESEND") return Boolean(process.env.RESEND_API_KEY?.trim());
  if (provider === "SENDGRID") return Boolean(process.env.SENDGRID_API_KEY?.trim());
  return false;
}

type StageParams = {
  orderId: string;
  buyerUserId: string | null;
  buyerEmail: string | null;
  buyerFirstName: string | null;
  sellerEmail: string;
  ticketCount: number;
  transferProofType: string;
  deadline: Date;
  now: Date;
};

function requireMatchingStagedIdentity(
  row: TransferProofDeliveryIntent,
  envelope: { orderId: string; kind: string; recipient: string; payloadJson: unknown },
  idempotencyKey: string,
) {
  const digest = deliveryEnvelopeDigest(envelope);
  if (
    row.orderId !== envelope.orderId
    || row.kind !== envelope.kind
    || row.recipient !== envelope.recipient
    || canonicalJson(row.payloadJson) !== canonicalJson(envelope.payloadJson)
    || row.idempotencyKey !== idempotencyKey
    || row.identityVersion !== 2
    || row.envelopeDigest !== digest
  ) {
    throw new Error("Transfer-proof delivery idempotency collision does not match the canonical envelope");
  }
}

export async function stageTransferProofDeliveryIntent(tx: Prisma.TransactionClient, params: StageParams) {
  // The order deadline is the durable transfer-proof clock. Do not let a
  // caller choose a second delivery identity for the same accepted proof.
  const completedAt = new Date(params.deadline.getTime() - BUYER_CONFIRMATION_WINDOW_MS);
  const windowStart = reminderWindowStart(completedAt);
  if (params.buyerEmail) {
    const payloadJson = {
      buyerFirstName: params.buyerFirstName, ticketCount: params.ticketCount,
      deadline: params.deadline.toISOString(), windowStart: windowStart.toISOString(),
    };
    const envelope = { orderId: params.orderId, kind: BUYER_KIND, recipient: params.buyerEmail, payloadJson };
    const idempotencyKey = deliveryIdempotencyKey(params.orderId, windowStart, BUYER_KIND, params.buyerEmail);
    const staged = await tx.transferProofDeliveryIntent.upsert({
      where: { idempotencyKey },
      create: {
        ...envelope, idempotencyKey, identityVersion: 2,
        envelopeDigest: deliveryEnvelopeDigest(envelope),
        availableAt: params.now,
      },
      update: {},
    });
    requireMatchingStagedIdentity(staged, envelope, idempotencyKey);
  }

  const payloadJson = {
    sellerEmail: params.sellerEmail, buyerEmail: params.buyerEmail, ticketCount: params.ticketCount,
    transferProofType: params.transferProofType, deadline: params.deadline.toISOString(), completedAt: completedAt.toISOString(),
  };
  const envelope = { orderId: params.orderId, kind: ADMIN_KIND, recipient: ADMIN_ACTIVITY_EMAIL, payloadJson };
  const idempotencyKey = deliveryIdempotencyKey(params.orderId, windowStart, ADMIN_KIND, ADMIN_ACTIVITY_EMAIL);
  const staged = await tx.transferProofDeliveryIntent.upsert({
    where: { idempotencyKey },
    create: {
      ...envelope, idempotencyKey, identityVersion: 2,
      envelopeDigest: deliveryEnvelopeDigest(envelope),
      availableAt: params.now,
    },
    update: {},
  });
  requireMatchingStagedIdentity(staged, envelope, idempotencyKey);

  // The canonical intent upserts above serialize repeated staging for the
  // same accepted proof. Create the in-app notification only after that
  // boundary so concurrent idempotent callers cannot both observe it absent.
  if (params.buyerUserId) {
    const ticketWord = params.ticketCount === 1 ? "ticket" : "tickets";
    const message = `Confirm you received ${params.ticketCount} transferred ${ticketWord} by ${params.deadline.toLocaleString("en-CA")}. If you do not confirm within 24 hours, the seller payout will be released.`;
    const type = "TRANSFER_CONFIRMATION_REQUIRED";
    const link = "/account/tickets/holding";
    const notificationIdempotencyKey = buyerNotificationIdempotencyKey(
      params.orderId,
      params.buyerUserId,
      windowStart,
    );
    const notification = await tx.notification.upsert({
      where: { idempotencyKey: notificationIdempotencyKey },
      create: {
        userId: params.buyerUserId, type, message, link, isRead: false,
        idempotencyKey: notificationIdempotencyKey,
      },
      update: {},
    });
    if (
      notification.userId !== params.buyerUserId
      || notification.type !== type
      || notification.link !== link
      || notification.message !== message
      || notification.idempotencyKey !== notificationIdempotencyKey
    ) {
      throw new Error("Transfer-proof notification idempotency collision does not match the canonical content");
    }
  }
}

type DeliveryDb = Pick<
  typeof prisma,
  "$transaction" | "transferProofDeliveryIntent" | "reminderDelivery" | "emailDelivery"
>;
type Payload = Record<string, unknown>;

function payload(value: Prisma.JsonValue): Payload {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("Invalid transfer-proof delivery payload");
  return value as Payload;
}

function requireNonEmptyString(data: Payload, field: string) {
  const value = data[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid transfer-proof delivery payload field: ${field}`);
  }
}

function requireOptionalString(data: Payload, field: string) {
  const value = data[field];
  if (value !== null && value !== undefined && (typeof value !== "string" || !value.trim())) {
    throw new Error(`Invalid transfer-proof delivery payload field: ${field}`);
  }
}

function requirePositiveInteger(data: Payload, field: string) {
  const value = data[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid transfer-proof delivery payload field: ${field}`);
  }
}

function requireIsoDate(data: Payload, field: string) {
  const value = data[field];
  const parsed = typeof value === "string" ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`Invalid transfer-proof delivery payload field: ${field}`);
  }
}

function requireDeliveryIdentity(row: TransferProofDeliveryIntent, data: Payload, windowStart: Date) {
  const expectedKey = deliveryIdempotencyKey(row.orderId, windowStart, row.kind, row.recipient);
  if (row.idempotencyKey !== expectedKey) {
    throw new Error("Transfer-proof delivery identity does not match its envelope");
  }
  if (row.identityVersion === 1 && row.envelopeDigest === null) return;
  if (row.identityVersion !== 2 || !row.envelopeDigest) {
    throw new Error("Unsupported transfer-proof delivery envelope identity version");
  }
  const expectedDigest = deliveryEnvelopeDigest({
    orderId: row.orderId,
    kind: row.kind,
    recipient: row.recipient,
    payloadJson: data,
  });
  if (row.envelopeDigest !== expectedDigest) {
    throw new Error("Transfer-proof delivery full-envelope identity does not match its payload");
  }
}

function assertValidDeliveryEnvelope(row: TransferProofDeliveryIntent, data: Payload) {
  if (!row.recipient.trim()) throw new Error("Invalid transfer-proof delivery recipient");
  if (row.kind === BUYER_KIND) {
    requireOptionalString(data, "buyerFirstName");
    requirePositiveInteger(data, "ticketCount");
    requireIsoDate(data, "deadline");
    requireIsoDate(data, "windowStart");
    const windowStart = new Date(String(data.windowStart));
    if (reminderWindowStart(windowStart).getTime() !== windowStart.getTime()) {
      throw new Error("Transfer-proof buyer delivery window is not normalized");
    }
    requireDeliveryIdentity(row, data, windowStart);
    return;
  }
  if (row.kind === ADMIN_KIND) {
    if (row.recipient !== ADMIN_ACTIVITY_EMAIL) {
      throw new Error("Transfer-proof administrator recipient does not match the configured activity mailbox");
    }
    requireNonEmptyString(data, "sellerEmail");
    requireOptionalString(data, "buyerEmail");
    requirePositiveInteger(data, "ticketCount");
    requireNonEmptyString(data, "transferProofType");
    requireIsoDate(data, "deadline");
    requireIsoDate(data, "completedAt");
    requireDeliveryIdentity(row, data, reminderWindowStart(new Date(String(data.completedAt))));
    return;
  }
  throw new Error(`Unsupported transfer-proof delivery kind: ${row.kind}`);
}

export async function drainTransferProofDeliveryIntents(
  options: { orderId?: string; now?: Date; limit?: number } = {},
  db: DeliveryDb = prisma,
) {
  const now = options.now ?? new Date();
  const exhausted = await db.transferProofDeliveryIntent.updateMany({
    where: {
      orderId: options.orderId,
      status: "FAILED",
      attemptCount: { gte: MAX_ATTEMPTS },
    },
    data: {
      status: "RECONCILIATION_REQUIRED",
      processingAt: null,
      leaseExpiresAt: null,
      claimToken: null,
      dispatchStartedAt: null,
    },
  });
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const resendConfigured = providerIsConfigured("RESEND");
  const sendGridConfigured = providerIsConfigured("SENDGRID");
  const providerConfigured = resendConfigured || sendGridConfigured;
  const resendWindowStart = new Date(now.getTime() - RESEND_IDEMPOTENCY_WINDOW_MS);
  let reconciliationRequired = exhausted.count;
  const acquisition = await db.$transaction(async (tx) => {
    const orderFilter = options.orderId
      ? Prisma.sql`AND "orderId" = ${options.orderId}`
      : Prisma.empty;
    const candidates = await tx.$queryRaw<TransferProofDeliveryIntent[]>(Prisma.sql`
      SELECT *
      FROM "TransferProofDeliveryIntent"
      WHERE "attemptCount" < ${MAX_ATTEMPTS}
        ${orderFilter}
        AND (
          ("status" IN ('PENDING', 'FAILED') AND "availableAt" <= ${now})
          OR ("status" = 'PROCESSING' AND "leaseExpiresAt" <= ${now})
        )
        AND (
          ("provider" IS NOT NULL AND "provider" NOT IN ('RESEND', 'SENDGRID'))
          OR ("provider" IS NULL AND (
            ${providerConfigured} OR "attemptCount" > 0 OR "status" = 'PROCESSING'
          ))
          OR ("provider" = 'RESEND' AND (
            ${resendConfigured}
            OR ("attemptCount" > 0 AND (
              "firstAttemptAt" IS NULL OR "firstAttemptAt" <= ${resendWindowStart}
            ))
          ))
          OR ("provider" = 'SENDGRID' AND (
            ${sendGridConfigured}
            OR ("status" = 'PROCESSING' AND "dispatchStartedAt" IS NOT NULL)
          ))
        )
      ORDER BY "availableAt" ASC, "createdAt" ASC, "id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    `);
    const acquired: Array<{
      row: TransferProofDeliveryIntent;
      provider: EmailProvider;
      leaseExpiresAt: Date;
      claimToken: string;
    }> = [];
    let quarantinedCount = 0;
    for (const row of candidates) {
      const staleClaim = row.status === "PROCESSING";
      const recordedProvider = row.provider === "RESEND" || row.provider === "SENDGRID"
        ? row.provider
        : null;
      const attemptedProviderMissing = row.attemptCount > 0 && !row.provider;
      const staleProviderMissing = staleClaim && !row.provider;
      const recordedProviderInvalid = Boolean(row.provider && !recordedProvider);
      const provider = recordedProvider
        ?? (staleClaim || row.attemptCount > 0 ? null : configuredEmailProvider());
      const resendAttemptTimeMissing = provider === "RESEND" && row.attemptCount > 0 && !row.firstAttemptAt;
      const resendWindowExpired = provider === "RESEND" && row.firstAttemptAt
        && now.getTime() - row.firstAttemptAt.getTime() >= RESEND_IDEMPOTENCY_WINDOW_MS;
      const ambiguousStaleClaim = staleClaim && Boolean(row.dispatchStartedAt) && provider !== "RESEND";
      if (attemptedProviderMissing || staleProviderMissing || recordedProviderInvalid || ambiguousStaleClaim || resendAttemptTimeMissing || resendWindowExpired) {
        const quarantined = await tx.transferProofDeliveryIntent.updateMany({
          where: { id: row.id, status: row.status, claimToken: row.claimToken },
          data: {
            status: "RECONCILIATION_REQUIRED", processingAt: null, leaseExpiresAt: null,
            claimToken: null, dispatchStartedAt: null,
            lastError: attemptedProviderMissing
              ? "Attempted delivery has no recorded provider; delivery requires reconciliation"
              : staleProviderMissing
              ? "Expired delivery claim has no recorded provider; delivery requires reconciliation"
              : recordedProviderInvalid
              ? `Unsupported recorded delivery provider ${row.provider}; delivery requires reconciliation`
              : resendAttemptTimeMissing
              ? "Resend first-attempt time is missing; delivery requires reconciliation"
              : resendWindowExpired
              ? "Resend idempotency window expired; delivery requires reconciliation"
              : provider
                ? `Ambiguous prior ${provider} delivery requires reconciliation`
                : "Ambiguous prior delivery with no recorded provider requires reconciliation",
          },
        });
        quarantinedCount += quarantined.count;
        continue;
      }
      if (!provider || !providerIsConfigured(provider)) continue;
      const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
      const claimToken = randomUUID();
      const claim = await tx.transferProofDeliveryIntent.updateMany({
        where: { id: row.id, status: row.status, claimToken: row.claimToken, attemptCount: row.attemptCount },
        data: {
          status: "PROCESSING", provider, processingAt: now, leaseExpiresAt,
          claimToken, dispatchStartedAt: null, lastError: null,
        },
      });
      if (claim.count === 1) acquired.push({ row, provider, leaseExpiresAt, claimToken });
    }
    return { candidates: candidates.length, acquired, quarantinedCount };
  });

  const claimed = acquisition.acquired.length;
  let delivered = 0;
  let failed = 0;
  reconciliationRequired += acquisition.quarantinedCount;
  for (const { row, provider, leaseExpiresAt, claimToken } of acquisition.acquired) {

    let attemptCount = row.attemptCount;
    let dispatchStarted = false;
    let data: Payload = {};
    let providerAccepted = false;
    let providerIdentityMismatch = false;
    let providerResult: string | null = null;
    let providerFailure: string | null = null;
    try {
      data = payload(row.payloadJson);
      assertValidDeliveryEnvelope(row, data);
      if (row.kind === BUYER_KIND) {
        const deadline = new Date(String(data.deadline));
        const windowStart = new Date(String(data.windowStart));
        const key = { orderId_reminderType_recipient_windowStart: {
          orderId: row.orderId, reminderType: "BUYER_CONFIRMATION", recipient: row.recipient, windowStart,
        } };
        const dispatch = await db.$transaction(async (tx) => {
          const owned = await tx.transferProofDeliveryIntent.updateMany({
            where: {
              id: row.id, status: "PROCESSING", provider, leaseExpiresAt, claimToken,
              attemptCount: row.attemptCount, dispatchStartedAt: null,
            },
            data: {
              attemptCount: { increment: 1 },
              firstAttemptAt: row.firstAttemptAt ?? now,
              dispatchStartedAt: now,
            },
          });
          if (owned.count !== 1) return owned;
          await tx.reminderDelivery.upsert({
            where: key,
            create: {
              orderId: row.orderId, reminderType: "BUYER_CONFIRMATION", recipient: row.recipient,
              windowStart, deadline, provider, status: "ATTEMPTING", attemptedAt: now,
            },
            update: {
              deadline, provider, status: "ATTEMPTING", providerResult: null,
              failureReason: null, attemptedAt: now, completedAt: null,
            },
          });
          return owned;
        });
        if (dispatch.count !== 1) continue;
        dispatchStarted = true;
        attemptCount = row.attemptCount + 1;
      } else {
        const dispatch = await db.transferProofDeliveryIntent.updateMany({
          where: {
            id: row.id, status: "PROCESSING", provider, leaseExpiresAt, claimToken,
            attemptCount: row.attemptCount, dispatchStartedAt: null,
          },
          data: {
            attemptCount: { increment: 1 },
            firstAttemptAt: row.firstAttemptAt ?? now,
            dispatchStartedAt: now,
          },
        });
        if (dispatch.count !== 1) continue;
        dispatchStarted = true;
        attemptCount = row.attemptCount + 1;
      }

      if (row.kind === BUYER_KIND) {
        const deadline = new Date(String(data.deadline));
        const windowStart = new Date(String(data.windowStart));
        const key = { orderId_reminderType_recipient_windowStart: {
          orderId: row.orderId, reminderType: "BUYER_CONFIRMATION", recipient: row.recipient, windowStart,
        } };
        const email = generateBuyerTransferConfirmationRequiredEmail(row.orderId, data.buyerFirstName ? String(data.buyerFirstName) : null, Number(data.ticketCount), deadline);
        const result = await sendEmail({
          to: row.recipient, ...email,
          idempotencyKey: providerIdempotencyKey(row.idempotencyKey), provider,
        });
        providerAccepted = result.ok;
        providerResult = result.providerResult || (result.ok ? "ACCEPTED" : "REJECTED");
        providerFailure = result.ok ? null : result.error || "Unknown provider error";
        providerIdentityMismatch = result.ok && result.provider !== provider;
        if (providerIdentityMismatch) {
          throw new Error(`Transfer-proof delivery provider changed from ${provider} to ${result.provider ?? "UNKNOWN"}`);
        }
        if (!result.ok) throw new Error(result.error || "Buyer email provider rejected delivery");
        const recorded = await db.$transaction(async (tx) => {
          const owned = await tx.transferProofDeliveryIntent.updateMany({
            where: { id: row.id, status: "PROCESSING", provider, leaseExpiresAt, claimToken, attemptCount },
            data: {
              status: "DELIVERED", deliveredAt: now, processingAt: null, leaseExpiresAt: null,
              claimToken: null, dispatchStartedAt: null, lastError: null,
            },
          });
          if (owned.count !== 1) return owned;
          await tx.reminderDelivery.update({
            where: key,
            data: {
              provider: result.provider || provider, status: "SENT",
              providerResult, failureReason: null, completedAt: now,
            },
          });
          return owned;
        });
        if (recorded.count !== 1) throw new Error("Transfer-proof provider accepted delivery but claim ownership was lost");
      } else {
        const result = await sendAdminActivityEmail({
          activity: "TICKETS_TRANSFERRED", summary: `Ticket transfer submitted — order ${row.orderId}`,
          idempotencyKey: providerIdempotencyKey(row.idempotencyKey), completedAt: String(data.completedAt), provider, details: {
          "Order ID": row.orderId, Seller: data.sellerEmail ? String(data.sellerEmail) : null,
          Buyer: data.buyerEmail ? String(data.buyerEmail) : null, "Ticket count": Number(data.ticketCount),
          "Proof type": data.transferProofType ? String(data.transferProofType) : null,
          "Buyer confirmation deadline": String(data.deadline),
        } });
        providerAccepted = result.ok;
        providerFailure = result.ok ? null : result.error || "Unknown provider error";
        providerIdentityMismatch = result.ok && result.provider !== provider;
        if (providerIdentityMismatch) {
          throw new Error(`Transfer-proof delivery provider changed from ${provider} to ${result.provider ?? "UNKNOWN"}`);
        }
        if (!result.ok) throw new Error(result.error || "Admin email provider rejected delivery");
        const emailType = `ADMIN_TRANSFER_SUBMITTED_${String(data.deadline)}`;
        const recorded = await db.$transaction(async (tx) => {
          const owned = await tx.transferProofDeliveryIntent.updateMany({
            where: { id: row.id, status: "PROCESSING", provider, leaseExpiresAt, claimToken, attemptCount },
            data: {
              status: "DELIVERED", deliveredAt: now, processingAt: null, leaseExpiresAt: null,
              claimToken: null, dispatchStartedAt: null, lastError: null,
            },
          });
          if (owned.count !== 1) return owned;
          await tx.emailDelivery.upsert({
            where: { orderId_emailType_recipient: {
              orderId: row.orderId, emailType, recipient: row.recipient,
            } },
            create: {
              orderId: row.orderId, emailType, recipient: row.recipient,
              provider, status: "SENT", error: null, sentAt: now,
            },
            update: { provider, status: "SENT", error: null, sentAt: now },
          });
          return owned;
        });
        if (recorded.count !== 1) throw new Error("Transfer-proof provider accepted delivery but claim ownership was lost");
      }
      delivered += 1;
    } catch (error) {
      const lastError = error instanceof Error ? error.message : "Unknown transfer-proof delivery error";
      if (!dispatchStarted) {
        const quarantined = await db.transferProofDeliveryIntent.updateMany({
          where: {
            id: row.id, status: "PROCESSING", provider, leaseExpiresAt, claimToken,
            attemptCount: row.attemptCount, dispatchStartedAt: null,
          },
          data: {
            status: "RECONCILIATION_REQUIRED", processingAt: null, leaseExpiresAt: null,
            claimToken: null, lastError: `Pre-dispatch delivery failure: ${lastError}`.slice(0, 2000),
          },
        });
        reconciliationRequired += quarantined.count;
        failed += quarantined.count;
        continue;
      }
      const retryAcceptedResend = providerAccepted && !providerIdentityMismatch
        && provider === "RESEND" && attemptCount < MAX_ATTEMPTS;
      const requiresReconciliation = (providerIdentityMismatch || providerAccepted)
        ? !retryAcceptedResend
        : provider === "SENDGRID" || attemptCount >= MAX_ATTEMPTS;
      const recovered = await db.$transaction(async (tx) => {
        const owned = await tx.transferProofDeliveryIntent.updateMany({
          where: { id: row.id, status: "PROCESSING", provider, leaseExpiresAt, claimToken, attemptCount },
          data: {
            status: retryAcceptedResend ? "PROCESSING" : requiresReconciliation ? "RECONCILIATION_REQUIRED" : "FAILED",
            processingAt: retryAcceptedResend ? now : null,
            leaseExpiresAt: retryAcceptedResend ? now : null,
            claimToken: retryAcceptedResend ? claimToken : null,
            dispatchStartedAt: retryAcceptedResend ? now : null,
            lastError: lastError.slice(0, 2000),
            availableAt: attemptCount < MAX_ATTEMPTS
              ? new Date(now.getTime() + RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1))
              : now,
          },
        });
        if (owned.count !== 1 || providerAccepted) return owned;
        if (row.kind === BUYER_KIND) {
          const deadline = new Date(String(data.deadline));
          const windowStart = new Date(String(data.windowStart));
          if (!Number.isNaN(deadline.getTime()) && !Number.isNaN(windowStart.getTime())) {
            await tx.reminderDelivery.upsert({
              where: { orderId_reminderType_recipient_windowStart: {
                orderId: row.orderId, reminderType: "BUYER_CONFIRMATION", recipient: row.recipient, windowStart,
              } },
              create: {
                orderId: row.orderId, reminderType: "BUYER_CONFIRMATION", recipient: row.recipient,
                windowStart, deadline, provider, status: "FAILED",
                providerResult: providerResult || "EXCEPTION",
                failureReason: providerFailure || lastError, attemptedAt: now, completedAt: now,
              },
              update: {
                status: "FAILED", providerResult: providerResult || "EXCEPTION",
                failureReason: providerFailure || lastError, completedAt: now,
              },
            });
          }
        } else if (row.kind === ADMIN_KIND) {
          const emailType = `ADMIN_TRANSFER_SUBMITTED_${String(data.deadline)}`;
          await tx.emailDelivery.upsert({
            where: { orderId_emailType_recipient: { orderId: row.orderId, emailType, recipient: row.recipient } },
            create: {
              orderId: row.orderId, emailType, recipient: row.recipient,
              provider, status: "FAILED", error: providerFailure || lastError, sentAt: now,
            },
            update: { provider, status: "FAILED", error: providerFailure || lastError, sentAt: now },
          });
        }
        return owned;
      });
      if (requiresReconciliation) reconciliationRequired += recovered.count;
      failed += recovered.count;
    }
  }
  return { scanned: acquisition.candidates, claimed, delivered, failed, reconciliationRequired };
}
