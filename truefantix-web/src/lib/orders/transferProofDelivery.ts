import type { Prisma } from "@prisma/client";
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

function providerIdempotencyKey(durableKey: string) {
  return `tft-transfer-proof-${createHash("sha256").update(durableKey).digest("hex")}`;
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

export async function stageTransferProofDeliveryIntent(tx: Prisma.TransactionClient, params: StageParams) {
  const windowStart = reminderWindowStart(params.now);
  if (params.buyerUserId) {
    const ticketWord = params.ticketCount === 1 ? "ticket" : "tickets";
    const message = `Confirm you received ${params.ticketCount} transferred ${ticketWord} by ${params.deadline.toLocaleString("en-CA")}. If you do not confirm within 24 hours, the seller payout will be released.`;
    const existing = await tx.notification.findFirst({
      where: { userId: params.buyerUserId, type: "TRANSFER_CONFIRMATION_REQUIRED", link: "/account/tickets/holding", createdAt: { gte: windowStart } },
      select: { id: true },
    });
    if (!existing) await tx.notification.create({ data: {
      userId: params.buyerUserId, type: "TRANSFER_CONFIRMATION_REQUIRED", message,
      link: "/account/tickets/holding", isRead: false,
    } });
  }

  if (params.buyerEmail) await tx.transferProofDeliveryIntent.upsert({
    where: { idempotencyKey: `${params.orderId}:${windowStart.toISOString()}:${BUYER_KIND}:${params.buyerEmail}` },
    create: {
      orderId: params.orderId, kind: BUYER_KIND, recipient: params.buyerEmail,
      payloadJson: { buyerFirstName: params.buyerFirstName, ticketCount: params.ticketCount, deadline: params.deadline.toISOString(), windowStart: windowStart.toISOString() },
      idempotencyKey: `${params.orderId}:${windowStart.toISOString()}:${BUYER_KIND}:${params.buyerEmail}`,
    },
    update: {},
  });

  await tx.transferProofDeliveryIntent.upsert({
    where: { idempotencyKey: `${params.orderId}:${windowStart.toISOString()}:${ADMIN_KIND}:${ADMIN_ACTIVITY_EMAIL}` },
    create: {
      orderId: params.orderId, kind: ADMIN_KIND, recipient: ADMIN_ACTIVITY_EMAIL,
      payloadJson: {
        sellerEmail: params.sellerEmail, buyerEmail: params.buyerEmail, ticketCount: params.ticketCount,
        transferProofType: params.transferProofType, deadline: params.deadline.toISOString(), completedAt: params.now.toISOString(),
      },
      idempotencyKey: `${params.orderId}:${windowStart.toISOString()}:${ADMIN_KIND}:${ADMIN_ACTIVITY_EMAIL}`,
    },
    update: {},
  });
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
  const recoverable = {
    attemptCount: { lt: MAX_ATTEMPTS },
    OR: [
      { status: { in: ["PENDING", "FAILED"] }, availableAt: { lte: now } },
      { status: "PROCESSING", leaseExpiresAt: { lte: now } },
    ],
  } satisfies Prisma.TransferProofDeliveryIntentWhereInput;
  const rows = await db.transferProofDeliveryIntent.findMany({
    where: { orderId: options.orderId, ...recoverable },
    orderBy: { availableAt: "asc" },
    take: Math.min(Math.max(options.limit ?? 50, 1), 100),
  });

  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let reconciliationRequired = exhausted.count;
  for (const row of rows) {
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
      const quarantined = await db.transferProofDeliveryIntent.updateMany({
        where: {
          id: row.id, status: row.status, attemptCount: row.attemptCount, provider: row.provider,
          claimToken: row.claimToken, dispatchStartedAt: row.dispatchStartedAt,
          ...(staleClaim ? { leaseExpiresAt: { lte: now } } : { availableAt: { lte: now } }),
        },
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
      reconciliationRequired += quarantined.count;
      continue;
    }
    if (!provider) continue;
    // A provider is pinned after the first claim so retries cannot cross provider
    // identities. Configuration rotation must not consume that retry budget.
    if (!providerIsConfigured(provider)) continue;
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const claimToken = randomUUID();
    const claim = await db.transferProofDeliveryIntent.updateMany({
      where: {
        id: row.id, attemptCount: row.attemptCount, provider: row.provider,
        claimToken: row.claimToken, dispatchStartedAt: row.dispatchStartedAt,
        OR: recoverable.OR,
      },
      data: {
        status: "PROCESSING", provider, processingAt: now, leaseExpiresAt,
        claimToken, dispatchStartedAt: null, lastError: null,
      },
    });
    if (claim.count !== 1) continue;
    claimed += 1;

    let attemptCount = row.attemptCount;
    let dispatchStarted = false;
    let data: Payload = {};
    let providerAccepted = false;
    try {
      data = payload(row.payloadJson);
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
      } else if (row.kind !== ADMIN_KIND) {
        throw new Error(`Unsupported transfer-proof delivery kind: ${row.kind}`);
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
        await db.reminderDelivery.update({
          where: key,
          data: {
            provider: result.provider || provider,
            status: result.ok ? "SENT" : "FAILED",
            providerResult: result.providerResult || (result.ok ? "ACCEPTED" : "REJECTED"),
            failureReason: result.ok ? null : result.error || "Unknown provider error",
            completedAt: now,
          },
        });
        if (!result.ok) throw new Error(result.error || "Buyer email provider rejected delivery");
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
        await db.emailDelivery.upsert({
          where: { orderId_emailType_recipient: {
            orderId: row.orderId, emailType: `ADMIN_TRANSFER_SUBMITTED_${String(data.deadline)}`, recipient: row.recipient,
          } },
          create: {
            orderId: row.orderId, emailType: `ADMIN_TRANSFER_SUBMITTED_${String(data.deadline)}`,
            recipient: row.recipient, provider, status: result.ok ? "SENT" : "FAILED",
            error: result.ok ? null : result.error || "Unknown provider error", sentAt: now,
          },
          update: {
            provider, status: result.ok ? "SENT" : "FAILED",
            error: result.ok ? null : result.error || "Unknown provider error", sentAt: now,
          },
        });
        if (!result.ok) throw new Error(result.error || "Admin email provider rejected delivery");
      }

      const completed = await db.transferProofDeliveryIntent.updateMany({
        where: { id: row.id, status: "PROCESSING", provider, leaseExpiresAt, claimToken, attemptCount },
        data: {
          status: "DELIVERED", deliveredAt: now, processingAt: null, leaseExpiresAt: null,
          claimToken: null, dispatchStartedAt: null, lastError: null,
        },
      });
      if (completed.count !== 1) throw new Error("Transfer-proof provider accepted delivery but completion persistence was lost");
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
      if (!providerAccepted && row.kind === BUYER_KIND) {
        const deadline = new Date(String(data.deadline));
        const windowStart = new Date(String(data.windowStart));
        if (!Number.isNaN(deadline.getTime()) && !Number.isNaN(windowStart.getTime())) {
          await db.reminderDelivery.upsert({
            where: { orderId_reminderType_recipient_windowStart: {
              orderId: row.orderId, reminderType: "BUYER_CONFIRMATION", recipient: row.recipient, windowStart,
            } },
            create: {
              orderId: row.orderId, reminderType: "BUYER_CONFIRMATION", recipient: row.recipient,
              windowStart, deadline, provider, status: "FAILED",
              providerResult: "EXCEPTION", failureReason: lastError, attemptedAt: now, completedAt: now,
            },
            update: { status: "FAILED", providerResult: "EXCEPTION", failureReason: lastError, completedAt: now },
          });
        }
      } else if (!providerAccepted && row.kind === ADMIN_KIND) {
        await db.emailDelivery.upsert({
          where: { orderId_emailType_recipient: {
            orderId: row.orderId, emailType: `ADMIN_TRANSFER_SUBMITTED_${String(data.deadline)}`, recipient: row.recipient,
          } },
          create: {
            orderId: row.orderId, emailType: `ADMIN_TRANSFER_SUBMITTED_${String(data.deadline)}`,
            recipient: row.recipient, provider, status: "FAILED", error: lastError, sentAt: now,
          },
          update: { provider, status: "FAILED", error: lastError, sentAt: now },
        });
      }
      const retryAcceptedResend = providerAccepted && provider === "RESEND" && attemptCount < MAX_ATTEMPTS;
      const requiresReconciliation = providerAccepted
        ? !retryAcceptedResend
        : provider === "SENDGRID" || attemptCount >= MAX_ATTEMPTS;
      const recovered = await db.transferProofDeliveryIntent.updateMany({
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
      if (requiresReconciliation) reconciliationRequired += recovered.count;
      failed += recovered.count;
    }
  }
  return { scanned: rows.length, claimed, delivered, failed, reconciliationRequired };
}
