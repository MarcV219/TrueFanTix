import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { generateBuyerTransferConfirmationRequiredEmail, sendEmail } from "@/lib/email";
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

function configuredEmailProvider() {
  if (process.env.RESEND_API_KEY?.trim()) return "RESEND";
  if (process.env.SENDGRID_API_KEY?.trim()) return "SENDGRID";
  return "CONSOLE";
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
  Prisma.TransactionClient,
  "transferProofDeliveryIntent" | "reminderDelivery" | "emailDelivery"
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
  for (const row of rows) {
    const provider = configuredEmailProvider();
    const staleClaim = row.status === "PROCESSING";
    const resendWindowExpired = provider === "RESEND" && row.firstAttemptAt
      && now.getTime() - row.firstAttemptAt.getTime() >= RESEND_IDEMPOTENCY_WINDOW_MS;
    if ((staleClaim && provider === "SENDGRID") || resendWindowExpired) {
      await db.transferProofDeliveryIntent.updateMany({
        where: { id: row.id, status: row.status },
        data: {
          status: "RECONCILIATION_REQUIRED", processingAt: null, leaseExpiresAt: null,
          lastError: provider === "SENDGRID"
            ? "Ambiguous prior SendGrid delivery requires reconciliation"
            : "Resend idempotency window expired; delivery requires reconciliation",
        },
      });
      continue;
    }
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const claim = await db.transferProofDeliveryIntent.updateMany({
      where: { id: row.id, attemptCount: row.attemptCount, OR: recoverable.OR },
      data: {
        status: "PROCESSING", processingAt: now, firstAttemptAt: row.firstAttemptAt ?? now,
        leaseExpiresAt, attemptCount: { increment: 1 }, lastError: null,
      },
    });
    if (claim.count !== 1) continue;
    claimed += 1;

    if (provider === "SENDGRID") {
      await db.transferProofDeliveryIntent.updateMany({
        where: { id: row.id, status: "PROCESSING", leaseExpiresAt },
        data: { status: "RECONCILIATION_REQUIRED", lastError: "SendGrid does not support provider-level idempotency" },
      });
    }

    const attemptCount = row.attemptCount + 1;
    let data: Payload = {};
    try {
      data = payload(row.payloadJson);
      if (row.kind === BUYER_KIND) {
        const deadline = new Date(String(data.deadline));
        const windowStart = new Date(String(data.windowStart));
        const key = { orderId_reminderType_recipient_windowStart: {
          orderId: row.orderId, reminderType: "BUYER_CONFIRMATION", recipient: row.recipient, windowStart,
        } };
        const provider = configuredEmailProvider();
        await db.reminderDelivery.upsert({
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
        const email = generateBuyerTransferConfirmationRequiredEmail(row.orderId, data.buyerFirstName ? String(data.buyerFirstName) : null, Number(data.ticketCount), deadline);
        const result = await sendEmail({ to: row.recipient, ...email, idempotencyKey: providerIdempotencyKey(row.idempotencyKey) });
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
      } else if (row.kind === ADMIN_KIND) {
        const result = await sendAdminActivityEmail({
          activity: "TICKETS_TRANSFERRED", summary: `Ticket transfer submitted — order ${row.orderId}`,
          idempotencyKey: providerIdempotencyKey(row.idempotencyKey), completedAt: String(data.completedAt), details: {
          "Order ID": row.orderId, Seller: data.sellerEmail ? String(data.sellerEmail) : null,
          Buyer: data.buyerEmail ? String(data.buyerEmail) : null, "Ticket count": Number(data.ticketCount),
          "Proof type": data.transferProofType ? String(data.transferProofType) : null,
          "Buyer confirmation deadline": String(data.deadline),
        } });
        await db.emailDelivery.upsert({
          where: { orderId_emailType_recipient: {
            orderId: row.orderId, emailType: `ADMIN_TRANSFER_SUBMITTED_${String(data.deadline)}`, recipient: row.recipient,
          } },
          create: {
            orderId: row.orderId, emailType: `ADMIN_TRANSFER_SUBMITTED_${String(data.deadline)}`,
            recipient: row.recipient, provider: configuredEmailProvider(), status: result.ok ? "SENT" : "FAILED",
            error: result.ok ? null : result.error || "Unknown provider error", sentAt: now,
          },
          update: {
            provider: configuredEmailProvider(), status: result.ok ? "SENT" : "FAILED",
            error: result.ok ? null : result.error || "Unknown provider error", sentAt: now,
          },
        });
        if (!result.ok) throw new Error(result.error || "Admin email provider rejected delivery");
      } else throw new Error(`Unsupported transfer-proof delivery kind: ${row.kind}`);

      await db.transferProofDeliveryIntent.updateMany({
        where: { id: row.id, status: { in: ["PROCESSING", "RECONCILIATION_REQUIRED"] }, leaseExpiresAt, attemptCount },
        data: { status: "DELIVERED", deliveredAt: now, processingAt: null, leaseExpiresAt: null, lastError: null },
      });
      delivered += 1;
    } catch (error) {
      const lastError = error instanceof Error ? error.message : "Unknown transfer-proof delivery error";
      if (row.kind === BUYER_KIND) {
        const deadline = new Date(String(data.deadline));
        const windowStart = new Date(String(data.windowStart));
        if (!Number.isNaN(deadline.getTime()) && !Number.isNaN(windowStart.getTime())) {
          await db.reminderDelivery.upsert({
            where: { orderId_reminderType_recipient_windowStart: {
              orderId: row.orderId, reminderType: "BUYER_CONFIRMATION", recipient: row.recipient, windowStart,
            } },
            create: {
              orderId: row.orderId, reminderType: "BUYER_CONFIRMATION", recipient: row.recipient,
              windowStart, deadline, provider: configuredEmailProvider(), status: "FAILED",
              providerResult: "EXCEPTION", failureReason: lastError, attemptedAt: now, completedAt: now,
            },
            update: { status: "FAILED", providerResult: "EXCEPTION", failureReason: lastError, completedAt: now },
          });
        }
      } else if (row.kind === ADMIN_KIND) {
        await db.emailDelivery.upsert({
          where: { orderId_emailType_recipient: {
            orderId: row.orderId, emailType: `ADMIN_TRANSFER_SUBMITTED_${String(data.deadline)}`, recipient: row.recipient,
          } },
          create: {
            orderId: row.orderId, emailType: `ADMIN_TRANSFER_SUBMITTED_${String(data.deadline)}`,
            recipient: row.recipient, provider: configuredEmailProvider(), status: "FAILED", error: lastError, sentAt: now,
          },
          update: { provider: configuredEmailProvider(), status: "FAILED", error: lastError, sentAt: now },
        });
      }
      await db.transferProofDeliveryIntent.updateMany({
        where: { id: row.id, status: { in: ["PROCESSING", "RECONCILIATION_REQUIRED"] }, leaseExpiresAt, attemptCount },
        data: {
          status: provider === "SENDGRID" ? "RECONCILIATION_REQUIRED" : "FAILED", processingAt: null, leaseExpiresAt: null, lastError: lastError.slice(0, 2000),
          availableAt: attemptCount < MAX_ATTEMPTS
            ? new Date(now.getTime() + RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1))
            : now,
        },
      });
      failed += 1;
    }
  }
  return { scanned: rows.length, claimed, delivered, failed };
}
