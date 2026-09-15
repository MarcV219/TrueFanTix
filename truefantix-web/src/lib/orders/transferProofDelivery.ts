import { Prisma, type TransferProofDeliveryIntent } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { generateBuyerTransferConfirmationRequiredEmail, sendEmail, type EmailProvider } from "@/lib/email";
import { ADMIN_ACTIVITY_EMAIL, sendAdminActivityEmail } from "@/lib/adminActivityEmail";
import { reminderWindowStart } from "@/lib/orders/transferWorkflow";
import { canonicalTransferProofReviewOrigin } from "@/lib/orders/transferProofReviewDelivery";

const BUYER_KIND = "BUYER_CONFIRMATION_EMAIL";
const ADMIN_KIND = "ADMIN_TRANSFER_ACTIVITY_EMAIL";
const SELLER_DECISION_KIND = "SELLER_REVIEW_DECISION_EMAIL";
const SELLER_DECISION_PAYLOAD_KEYS = [
  "action",
  "appOrigin",
  "decidedAt",
  "decidedByUserId",
  "decisionId",
  "htmlBody",
  "note",
  "sellerFirstName",
  "sellerUserId",
  "subject",
  "textBody",
] as const;
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

function sellerDecisionNotificationIdempotencyKey(orderId: string, decisionId: string, sellerUserId: string) {
  const canonicalIdentity = ["transfer-proof-review-decision", orderId, decisionId, sellerUserId].join(":");
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

export type TransferProofAdminDecisionAction = "APPROVE" | "REJECT" | "REQUEST_INFORMATION";

type StageAdminDecisionParams = {
  orderId: string;
  decisionId: string;
  action: TransferProofAdminDecisionAction;
  note: string;
  decidedAt: Date;
  decidedByUserId: string;
  sellerUserId: string;
  sellerEmail: string;
  sellerFirstName: string | null;
};

function sellerDecisionMessage(action: TransferProofAdminDecisionAction, orderId: string, note: string) {
  if (action === "APPROVE") return `Support approved the transfer proof for order ${orderId}.`;
  if (action === "REJECT") return `Support rejected the transfer proof for order ${orderId}. Upload corrected documentation.`;
  return `Support requested more transfer information for order ${orderId}: ${note}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]
    || character
  ));
}

function renderSellerDecisionEmail(orderId: string, data: Payload) {
  const action = String(data.action) as TransferProofAdminDecisionAction;
  const firstName = data.sellerFirstName ? String(data.sellerFirstName) : null;
  const note = String(data.note);
  const appOrigin = String(data.appOrigin).replace(/\/$/, "");
  const holdingUrl = `${appOrigin}/account/tickets/seller-holding`;
  const heading = action === "APPROVE"
    ? "Transfer proof approved"
    : action === "REJECT"
      ? "Transfer proof needs to be replaced"
      : "ACTION REQUIRED: More transfer information needed";
  const instruction = action === "APPROVE"
    ? "No further transfer-proof action is required right now. The buyer has been asked to confirm receipt."
    : action === "REJECT"
      ? "Please upload corrected transfer documentation from Seller Holding."
      : "Please upload the requested supporting information from Seller Holding so Support can complete its review.";
  const subject = action === "APPROVE"
    ? `Transfer Proof Approved — ${orderId}`
    : `ACTION REQUIRED: ${heading} — ${orderId}`;
  const text = `${heading}\n\nHi ${firstName || "there"},\n\nSupport reviewed the transfer proof for order ${orderId}.\n\nSupport note:\n${note}\n\n${instruction}\n\n${holdingUrl}\n\nThanks,\nThe TrueFanTix Team`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f2937"><div style="background:#064a93;color:white;padding:20px;border-radius:8px 8px 0 0"><strong>${escapeHtml(heading)}</strong></div><div style="background:#f9fafb;padding:24px"><p>Hi ${escapeHtml(firstName || "there")},</p><p>Support reviewed the transfer proof for order <strong>${escapeHtml(orderId)}</strong>.</p><div style="background:white;border-left:4px solid #f97316;padding:16px;margin:18px 0"><strong>Support note</strong><p style="white-space:pre-wrap">${escapeHtml(note)}</p></div><p>${escapeHtml(instruction)}</p><p><a href="${escapeHtml(holdingUrl)}" style="display:inline-block;background:#064a93;color:white;padding:12px 20px;text-decoration:none;border-radius:7px;font-weight:bold">Open Seller Holding</a></p></div></div>`;
  return { subject, text, html };
}

export async function stageTransferProofAdminDecisionDeliveryIntent(
  tx: Prisma.TransactionClient,
  params: StageAdminDecisionParams,
) {
  const envelopeSnapshot = {
    action: params.action,
    appOrigin: canonicalTransferProofReviewOrigin(),
    decidedAt: params.decidedAt.toISOString(),
    decidedByUserId: params.decidedByUserId,
    decisionId: params.decisionId,
    note: params.note,
    sellerFirstName: params.sellerFirstName,
    sellerUserId: params.sellerUserId,
  };
  const rendered = renderSellerDecisionEmail(params.orderId, envelopeSnapshot);
  const payloadJson = {
    ...envelopeSnapshot,
    htmlBody: rendered.html,
    subject: rendered.subject,
    textBody: rendered.text,
  };
  const envelope = {
    orderId: params.orderId,
    kind: SELLER_DECISION_KIND,
    recipient: params.sellerEmail,
    payloadJson,
  };
  const idempotencyKey = `${params.orderId}:${params.decisionId}:${SELLER_DECISION_KIND}:${params.sellerEmail}`;
  const staged = await tx.transferProofDeliveryIntent.upsert({
    where: { idempotencyKey },
    create: {
      ...envelope,
      idempotencyKey,
      identityVersion: 2,
      envelopeDigest: deliveryEnvelopeDigest(envelope),
      availableAt: params.decidedAt,
    },
    update: {},
  });
  requireMatchingStagedIdentity(staged, envelope, idempotencyKey);

  const type = params.action === "APPROVE" ? "TRANSFER_RECEIVED" : "VERIFICATION_NEEDED";
  const link = "/account/tickets/seller-holding";
  const message = sellerDecisionMessage(params.action, params.orderId, params.note);
  const boundSellerUserId = String(payloadJson.sellerUserId);
  const notificationIdempotencyKey = sellerDecisionNotificationIdempotencyKey(
    params.orderId,
    params.decisionId,
    boundSellerUserId,
  );
  const notification = await tx.notification.upsert({
    where: { idempotencyKey: notificationIdempotencyKey },
    create: {
      userId: boundSellerUserId,
      type,
      message,
      link,
      isRead: false,
      idempotencyKey: notificationIdempotencyKey,
    },
    update: {},
  });
  if (
    notification.userId !== boundSellerUserId
    || notification.type !== type
    || notification.message !== message
    || notification.link !== link
    || notification.idempotencyKey !== notificationIdempotencyKey
  ) {
    throw new Error("Transfer-proof review-decision notification identity collision");
  }
}

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

async function databaseUtcNow(
  db: Pick<typeof prisma, "$queryRaw">,
  compatibilityClock: Date,
) {
  const [row] = await db.$queryRaw<Array<{ now: Date }>>(Prisma.sql`
    SELECT transfer_proof_delivery_claim_clock(${compatibilityClock}) AS now
  `);
  return row.now;
}

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
  if (row.kind === SELLER_DECISION_KIND) {
    const keys = Object.keys(data).sort();
    if (
      keys.length !== SELLER_DECISION_PAYLOAD_KEYS.length
      || keys.some((key, index) => key !== SELLER_DECISION_PAYLOAD_KEYS[index])
    ) {
      throw new Error("Transfer-proof review-decision payload must have the canonical shape");
    }
    requireNonEmptyString(data, "action");
    if (!["APPROVE", "REJECT", "REQUEST_INFORMATION"].includes(String(data.action))) {
      throw new Error("Invalid transfer-proof review-decision action");
    }
    requireNonEmptyString(data, "appOrigin");
    requireIsoDate(data, "decidedAt");
    requireNonEmptyString(data, "decidedByUserId");
    requireNonEmptyString(data, "decisionId");
    requireNonEmptyString(data, "note");
    requireOptionalString(data, "sellerFirstName");
    requireNonEmptyString(data, "sellerUserId");
    requireNonEmptyString(data, "subject");
    requireNonEmptyString(data, "textBody");
    requireNonEmptyString(data, "htmlBody");
    const rendered = renderSellerDecisionEmail(row.orderId, data);
    if (
      data.subject !== rendered.subject
      || data.textBody !== rendered.text
      || data.htmlBody !== rendered.html
    ) {
      throw new Error("Transfer-proof review-decision rendered envelope is not canonical");
    }
    const expectedKey = `${row.orderId}:${String(data.decisionId)}:${SELLER_DECISION_KIND}:${row.recipient}`;
    if (row.idempotencyKey !== expectedKey || row.identityVersion !== 2 || !row.envelopeDigest) {
      throw new Error("Transfer-proof review-decision identity does not match its envelope");
    }
    const expectedDigest = deliveryEnvelopeDigest({
      orderId: row.orderId,
      kind: row.kind,
      recipient: row.recipient,
      payloadJson: data,
    });
    if (row.envelopeDigest !== expectedDigest) {
      throw new Error("Transfer-proof review-decision digest does not match its envelope");
    }
    return;
  }
  throw new Error(`Unsupported transfer-proof delivery kind: ${row.kind}`);
}

export async function drainTransferProofDeliveryIntents(
  options: { orderId?: string; now?: Date; limit?: number } = {},
  db: DeliveryDb = prisma,
) {
  // Production's transfer_proof_delivery_claim_clock ignores this value and
  // returns PostgreSQL's statement clock. The argument remains only so the
  // disposable integration database can keep its historical test timeline.
  const compatibilityClock = options.now ?? new Date();
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
  let reconciliationRequired = exhausted.count;
  const acquisition = await db.$transaction(async (tx) => {
    const acquisitionNow = await databaseUtcNow(tx, compatibilityClock);
    const acquisitionResendWindowStart = new Date(
      acquisitionNow.getTime() - RESEND_IDEMPOTENCY_WINDOW_MS,
    );
    const orderFilter = options.orderId
      ? Prisma.sql`AND "orderId" = ${options.orderId}`
      : Prisma.empty;
    // A worker can die after its final dispatch but before it records the
    // provider result. That expired max-attempt claim cannot be selected for
    // a fourth dispatch, so make the ambiguity explicit at the database clock.
    const expiredFinalClaims = await tx.$executeRaw(Prisma.sql`
      UPDATE "TransferProofDeliveryIntent"
      SET status = 'RECONCILIATION_REQUIRED',
        "processingAt" = NULL,
        "leaseExpiresAt" = NULL,
        "claimToken" = NULL,
        "dispatchStartedAt" = NULL,
        "lastError" = 'Expired final transfer-proof delivery claim requires provider reconciliation'
      WHERE status = 'PROCESSING'
        AND "attemptCount" >= ${MAX_ATTEMPTS}
        AND "leaseExpiresAt" <= ${acquisitionNow}
        ${orderFilter}
    `);
    const candidates = await tx.$queryRaw<TransferProofDeliveryIntent[]>(Prisma.sql`
      SELECT candidate.*
      FROM "TransferProofDeliveryIntent" candidate
      WHERE candidate."attemptCount" < ${MAX_ATTEMPTS}
        ${orderFilter}
        AND (
          ("status" IN ('PENDING', 'FAILED') AND "availableAt" <= ${acquisitionNow})
          OR ("status" = 'PROCESSING' AND "leaseExpiresAt" <= ${acquisitionNow})
        )
        AND (
          ("provider" IS NOT NULL AND "provider" NOT IN ('RESEND', 'SENDGRID'))
          OR ("provider" IS NULL AND (
            ${providerConfigured} OR "attemptCount" > 0 OR "status" = 'PROCESSING'
          ))
          OR ("provider" = 'RESEND' AND (
            ${resendConfigured}
            OR ("attemptCount" > 0 AND (
              "firstAttemptAt" IS NULL OR "firstAttemptAt" <= ${acquisitionResendWindowStart}
            ))
          ))
          OR ("provider" = 'SENDGRID' AND (
            ${sendGridConfigured}
            OR ("status" = 'PROCESSING' AND "dispatchStartedAt" IS NOT NULL)
          ))
        )
        AND (
          candidate.kind <> ${SELLER_DECISION_KIND}
          OR NOT EXISTS (
            SELECT 1
            FROM "TransferProofDeliveryIntent" predecessor
            WHERE predecessor."orderId" = candidate."orderId"
              AND predecessor.kind = ${SELLER_DECISION_KIND}
              AND predecessor.status IN ('PENDING', 'PROCESSING', 'FAILED', 'RECONCILIATION_REQUIRED')
              AND (
                (predecessor."payloadJson" ->> 'decidedAt')::timestamptz
                  < (candidate."payloadJson" ->> 'decidedAt')::timestamptz
                OR (
                  (predecessor."payloadJson" ->> 'decidedAt')::timestamptz
                    = (candidate."payloadJson" ->> 'decidedAt')::timestamptz
                  AND predecessor.id < candidate.id
                )
              )
          )
        )
      ORDER BY candidate."availableAt" ASC, candidate."createdAt" ASC, candidate.id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    `);
    const acquired: Array<{
      row: TransferProofDeliveryIntent;
      provider: EmailProvider;
      workerClock: Date;
      leaseExpiresAt: Date;
      claimToken: string;
    }> = [];
    let quarantinedCount = 0;
    for (const row of candidates) {
      const claimNow = await databaseUtcNow(tx, compatibilityClock);
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
        && claimNow.getTime() - row.firstAttemptAt.getTime() >= RESEND_IDEMPOTENCY_WINDOW_MS;
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
      const leaseExpiresAt = new Date(claimNow.getTime() + LEASE_MS);
      const claimToken = randomUUID();
      const claim = await tx.transferProofDeliveryIntent.updateMany({
        where: { id: row.id, status: row.status, claimToken: row.claimToken, attemptCount: row.attemptCount },
        data: {
          status: "PROCESSING", provider, processingAt: claimNow, leaseExpiresAt,
          claimToken, dispatchStartedAt: null, lastError: null,
        },
      });
      if (claim.count === 1) acquired.push({
        row,
        provider,
        workerClock: claimNow,
        leaseExpiresAt,
        claimToken,
      });
    }
    return {
      candidates: candidates.length,
      acquired,
      quarantinedCount,
      expiredFinalClaims,
    };
  });

  const claimed = acquisition.acquired.length;
  let delivered = 0;
  let failed = 0;
  reconciliationRequired += acquisition.quarantinedCount + acquisition.expiredFinalClaims;
  for (const { row, provider, workerClock, leaseExpiresAt, claimToken } of acquisition.acquired) {

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
              firstAttemptAt: row.firstAttemptAt ?? workerClock,
              dispatchStartedAt: workerClock,
            },
          });
          if (owned.count !== 1) return owned;
          await tx.reminderDelivery.upsert({
            where: key,
            create: {
              orderId: row.orderId, reminderType: "BUYER_CONFIRMATION", recipient: row.recipient,
              windowStart, deadline, provider, status: "ATTEMPTING", attemptedAt: workerClock,
            },
            update: {
              deadline, provider, status: "ATTEMPTING", providerResult: null,
              failureReason: null, attemptedAt: workerClock, completedAt: null,
            },
          });
          return owned;
        });
        if (dispatch.count !== 1) continue;
        dispatchStarted = true;
        attemptCount = row.attemptCount + 1;
      } else {
        const dispatch = await db.$transaction(async (tx) => {
          return tx.transferProofDeliveryIntent.updateMany({
            where: {
              id: row.id, status: "PROCESSING", provider, leaseExpiresAt, claimToken,
              attemptCount: row.attemptCount, dispatchStartedAt: null,
            },
            data: {
              attemptCount: { increment: 1 },
              firstAttemptAt: row.firstAttemptAt ?? workerClock,
              dispatchStartedAt: workerClock,
            },
          });
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
              status: "DELIVERED", deliveredAt: workerClock, processingAt: null, leaseExpiresAt: null,
              claimToken: null, dispatchStartedAt: null, lastError: null,
            },
          });
          if (owned.count !== 1) return owned;
          await tx.reminderDelivery.update({
            where: key,
            data: {
              provider: result.provider || provider, status: "SENT",
              providerResult, failureReason: null, completedAt: workerClock,
            },
          });
          return owned;
        });
        if (recorded.count !== 1) throw new Error("Transfer-proof provider accepted delivery but claim ownership was lost");
      } else if (row.kind === ADMIN_KIND) {
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
              status: "DELIVERED", deliveredAt: workerClock, processingAt: null, leaseExpiresAt: null,
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
              provider, status: "SENT", error: null, sentAt: workerClock,
            },
            update: { provider, status: "SENT", error: null, sentAt: workerClock },
          });
          return owned;
        });
        if (recorded.count !== 1) throw new Error("Transfer-proof provider accepted delivery but claim ownership was lost");
      } else {
        const result = await sendEmail({
          to: row.recipient,
          subject: String(data.subject),
          text: String(data.textBody),
          html: String(data.htmlBody),
          idempotencyKey: providerIdempotencyKey(row.idempotencyKey),
          provider,
        });
        providerAccepted = result.ok;
        providerResult = result.providerResult || (result.ok ? "ACCEPTED" : "REJECTED");
        providerFailure = result.ok ? null : result.error || "Unknown provider error";
        providerIdentityMismatch = result.ok && result.provider !== provider;
        if (providerIdentityMismatch) {
          throw new Error(`Transfer-proof review-decision provider changed from ${provider} to ${result.provider ?? "UNKNOWN"}`);
        }
        if (!result.ok) throw new Error(result.error || "Seller review-decision provider rejected delivery");
        const emailType = `TRANSFER_PROOF_ADMIN_${String(data.action)}_${String(data.decisionId)}`;
        const recorded = await db.$transaction(async (tx) => {
          const owned = await tx.transferProofDeliveryIntent.updateMany({
            where: { id: row.id, status: "PROCESSING", provider, leaseExpiresAt, claimToken, attemptCount },
            data: {
              status: "DELIVERED", deliveredAt: workerClock, processingAt: null, leaseExpiresAt: null,
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
              provider, status: "SENT", error: null, sentAt: workerClock,
            },
            update: { provider, status: "SENT", error: null, sentAt: workerClock },
          });
          return owned;
        });
        if (recorded.count !== 1) throw new Error("Review-decision provider accepted delivery but claim ownership was lost");
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
            processingAt: retryAcceptedResend ? workerClock : null,
            leaseExpiresAt: retryAcceptedResend ? workerClock : null,
            claimToken: retryAcceptedResend ? claimToken : null,
            dispatchStartedAt: retryAcceptedResend ? workerClock : null,
            lastError: lastError.slice(0, 2000),
            availableAt: attemptCount < MAX_ATTEMPTS
              ? new Date(workerClock.getTime() + RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1))
              : workerClock,
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
                failureReason: providerFailure || lastError, attemptedAt: workerClock, completedAt: workerClock,
              },
              update: {
                status: "FAILED", providerResult: providerResult || "EXCEPTION",
                failureReason: providerFailure || lastError, completedAt: workerClock,
              },
            });
          }
        } else if (row.kind === ADMIN_KIND) {
          const emailType = `ADMIN_TRANSFER_SUBMITTED_${String(data.deadline)}`;
          await tx.emailDelivery.upsert({
            where: { orderId_emailType_recipient: { orderId: row.orderId, emailType, recipient: row.recipient } },
            create: {
              orderId: row.orderId, emailType, recipient: row.recipient,
              provider, status: "FAILED", error: providerFailure || lastError, sentAt: workerClock,
            },
            update: { provider, status: "FAILED", error: providerFailure || lastError, sentAt: workerClock },
          });
        } else if (row.kind === SELLER_DECISION_KIND) {
          const emailType = `TRANSFER_PROOF_ADMIN_${String(data.action)}_${String(data.decisionId)}`;
          await tx.emailDelivery.upsert({
            where: { orderId_emailType_recipient: { orderId: row.orderId, emailType, recipient: row.recipient } },
            create: {
              orderId: row.orderId, emailType, recipient: row.recipient,
              provider, status: "FAILED", error: providerFailure || lastError, sentAt: workerClock,
            },
            update: { provider, status: "FAILED", error: providerFailure || lastError, sentAt: workerClock },
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
