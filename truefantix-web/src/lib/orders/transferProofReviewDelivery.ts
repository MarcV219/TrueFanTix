import { createHash, randomUUID } from "node:crypto";
import { Prisma, type TransferProofReviewDeliveryIntent } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail, type EmailProvider } from "@/lib/email";
import { DISPUTE_SUPPORT_EMAIL } from "@/lib/disputes";

const LEASE_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 5 * 60 * 1000;
const RESEND_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const TRANSFER_PROOF_REVIEW_TEST_ORIGIN = "http://localhost:3000";
export const TRANSFER_PROOF_REVIEW_STAGING_ORIGIN = "https://truefantix-staging-preview.vercel.app";

function configuredEmailProvider(): EmailProvider | null {
  if (process.env.RESEND_API_KEY?.trim()) return "RESEND";
  if (process.env.SENDGRID_API_KEY?.trim()) return "SENDGRID";
  return null;
}

function providerIsConfigured(provider: EmailProvider) {
  if (provider === "RESEND") return Boolean(process.env.RESEND_API_KEY?.trim());
  return Boolean(process.env.SENDGRID_API_KEY?.trim());
}

function reviewDeliveryIdempotencyKey(orderId: string, requestId: string, recipient: string) {
  const digest = createHash("sha256")
    .update(`${orderId}:${requestId}:${recipient}`)
    .digest("hex");
  return `tft-human-review-${digest}`;
}

type ReviewEnvelopePayload = {
  sellerName: string;
  sellerEmail: string;
  eventTitle: string;
  appOrigin: string;
};

function reviewAppOrigin(value: string) {
  const url = new URL(value);
  if (url.origin !== value.replace(/\/$/, "") || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Invalid transfer-proof review application origin");
  }
  return url.origin;
}

export function canonicalTransferProofReviewOrigin(env: NodeJS.ProcessEnv = process.env) {
  const configuredOrigins = [env.NEXT_PUBLIC_APP_URL, env.APP_ORIGIN]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => reviewAppOrigin(value.trim().replace(/\/$/, "")));
  const isolatedPreview = env.PRIMARY_TICKETING_ENVIRONMENT_ID === "isolated-preview"
    || env.PRIMARY_TICKETING_DEPLOYMENT_ID === "isolated-preview"
    || env.VERCEL_ENV === "preview";
  const isolatedTest = env.PRIMARY_TICKETING_ENVIRONMENT_ID === "isolated-test"
    || env.PRIMARY_TICKETING_DEPLOYMENT_ID === "isolated-test";

  if (isolatedPreview) {
    if (
      configuredOrigins.length === 0
      || configuredOrigins.some((origin) => origin !== TRANSFER_PROOF_REVIEW_STAGING_ORIGIN)
    ) {
      throw new Error("Transfer-proof review staging origin does not match the isolated-preview identity");
    }
    return TRANSFER_PROOF_REVIEW_STAGING_ORIGIN;
  }
  if (isolatedTest || env.NODE_ENV === "test") {
    if (configuredOrigins.some((origin) => origin !== TRANSFER_PROOF_REVIEW_TEST_ORIGIN)) {
      throw new Error("Transfer-proof review test origin does not match the isolated-test identity");
    }
    return TRANSFER_PROOF_REVIEW_TEST_ORIGIN;
  }

  throw new Error("Transfer-proof review origin requires a recognized database environment");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]
    || character
  ));
}

function renderReviewEnvelope(input: {
  orderId: string;
  requestedAt: Date;
  payload: ReviewEnvelopePayload;
}) {
  const requestedAt = input.requestedAt.toISOString();
  const reviewUrl = `${input.payload.appOrigin}/admin/orders/${encodeURIComponent(input.orderId)}`;
  const subject = `ACTION REQUIRED: Human Review Requested for Transfer Proof — ${input.orderId}`;
  const textBody = `${input.payload.sellerName} (${input.payload.sellerEmail}) requested a human review of transfer documentation.

Order: ${input.orderId}
Event: ${input.payload.eventTitle}
Requested: ${requestedAt}

Review the stored documentation:
${reviewUrl}`;
  const htmlBody = `<p><strong>${escapeHtml(input.payload.sellerName)}</strong> (${escapeHtml(input.payload.sellerEmail)}) requested a human review of transfer documentation.</p>
<p><strong>Order:</strong> ${escapeHtml(input.orderId)}<br><strong>Event:</strong> ${escapeHtml(input.payload.eventTitle)}<br><strong>Requested:</strong> ${requestedAt}</p>
<p><a href="${escapeHtml(reviewUrl)}">Review the order and documentation</a></p>`;
  return { subject, textBody, htmlBody };
}

function reviewEnvelopeDigest(input: {
  orderId: string;
  requestId: string;
  recipient: string;
  requestedAt: Date;
  payload: ReviewEnvelopePayload;
  subject: string;
  textBody: string;
  htmlBody: string;
}) {
  const values = [
    input.orderId,
    input.requestId,
    input.recipient,
    input.requestedAt.toISOString(),
    input.payload.sellerName,
    input.payload.sellerEmail,
    input.payload.eventTitle,
    input.payload.appOrigin,
    input.subject,
    input.textBody,
    input.htmlBody,
  ];
  return createHash("sha256")
    .update(values.map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`).join(""))
    .digest("hex");
}

type StageParams = {
  orderId: string;
  requestId: string;
  recipient: string;
  sellerName: string;
  sellerEmail: string;
  eventTitle: string;
  requestedAt: Date;
};

export async function stageTransferProofReviewDeliveryIntent(
  tx: Prisma.TransactionClient,
  params: StageParams,
) {
  const payload: ReviewEnvelopePayload = {
    sellerName: params.sellerName,
    sellerEmail: params.sellerEmail,
    eventTitle: params.eventTitle,
    appOrigin: canonicalTransferProofReviewOrigin(),
  };
  const rendered = renderReviewEnvelope({
    orderId: params.orderId,
    requestedAt: params.requestedAt,
    payload,
  });
  const idempotencyKey = reviewDeliveryIdempotencyKey(
    params.orderId,
    params.requestId,
    params.recipient,
  );
  const envelopeDigest = reviewEnvelopeDigest({
    orderId: params.orderId,
    requestId: params.requestId,
    recipient: params.recipient,
    requestedAt: params.requestedAt,
    payload,
    ...rendered,
  });
  const staged = await tx.transferProofReviewDeliveryIntent.upsert({
    where: { requestId: params.requestId },
    create: {
      orderId: params.orderId,
      requestId: params.requestId,
      recipient: params.recipient,
      requestedAt: params.requestedAt,
      ...rendered,
      payloadJson: payload,
      envelopeDigest,
      idempotencyKey,
      availableAt: params.requestedAt,
    },
    update: {},
  });
  if (
    staged.orderId !== params.orderId
    || staged.requestId !== params.requestId
    || staged.recipient !== params.recipient
    || staged.subject !== rendered.subject
    || staged.textBody !== rendered.textBody
    || staged.htmlBody !== rendered.htmlBody
    || !staged.payloadJson
    || Array.isArray(staged.payloadJson)
    || typeof staged.payloadJson !== "object"
    || Object.keys(staged.payloadJson).length !== 4
    || Object.entries(payload).some(([key, value]) => (
      (staged.payloadJson as Record<string, unknown>)[key] !== value
    ))
    || staged.envelopeDigest !== envelopeDigest
    || staged.requestedAt.getTime() !== params.requestedAt.getTime()
    || staged.idempotencyKey !== idempotencyKey
  ) {
    throw new Error("Transfer-proof review delivery identity collision does not match the canonical envelope");
  }
  return staged;
}

type DeliveryDb = Pick<
  typeof prisma,
  "$executeRaw" | "$queryRaw" | "$transaction" | "transferProofReviewDeliveryIntent" | "emailDelivery"
>;

async function databaseUtcNow(db: Pick<typeof prisma, "$queryRaw">) {
  const [row] = await db.$queryRaw<Array<{ now: Date }>>`
    SELECT statement_timestamp() AT TIME ZONE 'UTC' AS now
  `;
  return row.now;
}

function requireCanonicalEnvelope(row: TransferProofReviewDeliveryIntent) {
  if (
    !row.payloadJson
    || Array.isArray(row.payloadJson)
    || typeof row.payloadJson !== "object"
  ) {
    throw new Error("Invalid transfer-proof review delivery envelope");
  }
  const rawPayload = row.payloadJson as Record<string, unknown>;
  const payloadKeys = Object.keys(rawPayload).sort();
  const expectedPayloadKeys = ["appOrigin", "eventTitle", "sellerEmail", "sellerName"];
  if (
    JSON.stringify(payloadKeys) !== JSON.stringify(expectedPayloadKeys)
    || expectedPayloadKeys.some((key) => typeof rawPayload[key] !== "string" || !String(rawPayload[key]).trim())
  ) {
    throw new Error("Invalid transfer-proof review delivery envelope snapshot");
  }
  const payload = rawPayload as ReviewEnvelopePayload;
  if (reviewAppOrigin(payload.appOrigin) !== payload.appOrigin) {
    throw new Error("Invalid transfer-proof review delivery application origin");
  }
  if (payload.appOrigin !== canonicalTransferProofReviewOrigin()) {
    throw new Error("Transfer-proof review delivery origin does not match the current environment");
  }
  const rendered = renderReviewEnvelope({ orderId: row.orderId, requestedAt: row.requestedAt, payload });
  const expectedKey = reviewDeliveryIdempotencyKey(row.orderId, row.requestId, row.recipient);
  const expectedDigest = reviewEnvelopeDigest({
    orderId: row.orderId,
    requestId: row.requestId,
    recipient: row.recipient,
    requestedAt: row.requestedAt,
    payload,
    ...rendered,
  });
  if (
    !row.recipient.trim()
    || row.subject !== rendered.subject
    || row.textBody !== rendered.textBody
    || row.htmlBody !== rendered.htmlBody
    || row.idempotencyKey !== expectedKey
    || row.envelopeDigest !== expectedDigest
  ) {
    throw new Error("Transfer-proof review delivery identity does not match its envelope");
  }
}

type RuntimeReviewOrder = {
  status: string;
  buyerConfirmationStatus: string | null;
  transferVerificationStatus: string | null;
  transferProofData: string | null;
};

type RuntimeReviewSeller = {
  id: string;
};

async function requireRuntimeReviewSubject(
  tx: Prisma.TransactionClient,
  row: TransferProofReviewDeliveryIntent,
) {
  if (row.recipient !== DISPUTE_SUPPORT_EMAIL) {
    throw new Error("Transfer-proof review delivery recipient does not match the support mailbox");
  }

  const [order] = await tx.$queryRaw<RuntimeReviewOrder[]>(Prisma.sql`
    SELECT parent_order.status,
      parent_order."buyerConfirmationStatus" AS "buyerConfirmationStatus",
      parent_order."transferVerificationStatus" AS "transferVerificationStatus",
      parent_order."transferProofData" AS "transferProofData"
    FROM "Order" parent_order
    WHERE parent_order.id = ${row.orderId}
    FOR SHARE OF parent_order
  `);
  if (!order?.transferProofData) {
    throw new Error("Transfer-proof review delivery parent order is unavailable at dispatch");
  }
  if (
    order.status !== "PAID"
    || order.buyerConfirmationStatus !== "PENDING"
    || order.transferVerificationStatus !== "MANUAL_REVIEW"
  ) {
    throw new Error("Transfer-proof review delivery is no longer awaiting human review");
  }

  let proof: Record<string, unknown>;
  try {
    const parsed = JSON.parse(order.transferProofData) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    proof = parsed as Record<string, unknown>;
  } catch {
    throw new Error("Transfer-proof review delivery does not match durable review history");
  }

  const [seller] = await tx.$queryRaw<RuntimeReviewSeller[]>(Prisma.sql`
    SELECT seller_user.id
    FROM "Order" parent_order
    JOIN "User" seller_user ON seller_user."sellerId" = parent_order."sellerId"
    WHERE parent_order.id = ${row.orderId}
    FOR SHARE OF seller_user
  `);
  if (!seller) {
    throw new Error("Transfer-proof review delivery seller is unavailable at dispatch");
  }

  if (
    proof.manualReviewRequestId !== row.requestId
    || proof.manualReviewRequestedAt !== row.requestedAt.toISOString()
    || proof.requestedByUserId !== seller.id
  ) {
    throw new Error("Transfer-proof review delivery does not match the current durable review request");
  }
}

export async function drainTransferProofReviewDeliveryIntents(
  options: { orderId?: string; now?: Date; limit?: number } = {},
  db: DeliveryDb = prisma,
) {
  // Worker transition evidence is database-clock owned. The optional clock is
  // retained only for call-site compatibility and must never advance a claim.
  void options.now;
  // Restored legacy history can carry an unsupported provider at any retry
  // ordinal, including the exhaustion boundary. Quarantine it with the exact
  // provider-derived evidence before the generic exhausted-row promotion,
  // whose preserved lastError intentionally cannot authenticate this special
  // transition.
  const unsupportedOrderFilter = options.orderId
    ? Prisma.sql`AND "orderId" = ${options.orderId}`
    : Prisma.empty;
  const unsupportedFailedCount = await db.$executeRaw(Prisma.sql`
    UPDATE "TransferProofReviewDeliveryIntent"
    SET status = 'RECONCILIATION_REQUIRED',
      "lastError" = 'Unsupported recorded review delivery provider '
        || provider
        || '; reconciliation required',
      "updatedAt" = statement_timestamp() AT TIME ZONE 'UTC'
    WHERE status = 'FAILED'
      AND "attemptCount" >= ${MAX_ATTEMPTS}
      AND provider IS NOT NULL
      AND provider NOT IN ('RESEND', 'SENDGRID')
      ${unsupportedOrderFilter}
  `);
  const exhausted = await db.transferProofReviewDeliveryIntent.updateMany({
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
  // A worker can die after recording its final dispatch boundary but before
  // recording the provider result. Once that lease expires, the row is no
  // longer eligible for another attempt and must become explicit
  // reconciliation work instead of remaining PROCESSING forever.
  const expiredOrderFilter = options.orderId
    ? Prisma.sql`AND "orderId" = ${options.orderId}`
    : Prisma.empty;
  const expiredProcessingCount = await db.$executeRaw(Prisma.sql`
    UPDATE "TransferProofReviewDeliveryIntent"
    SET status = 'RECONCILIATION_REQUIRED',
      "processingAt" = NULL,
      "leaseExpiresAt" = NULL,
      "claimToken" = NULL,
      "dispatchStartedAt" = NULL,
      "lastError" = 'Expired final review delivery claim requires provider reconciliation',
      "updatedAt" = statement_timestamp() AT TIME ZONE 'UTC'
    WHERE status = 'PROCESSING'
      AND "attemptCount" >= ${MAX_ATTEMPTS}
      AND "leaseExpiresAt" <= statement_timestamp() AT TIME ZONE 'UTC'
      ${expiredOrderFilter}
  `);
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const resendConfigured = providerIsConfigured("RESEND");
  const sendGridConfigured = providerIsConfigured("SENDGRID");
  const providerConfigured = resendConfigured || sendGridConfigured;
  let reconciliationRequired = unsupportedFailedCount + exhausted.count + expiredProcessingCount;
  const acquisition = await db.$transaction(async (tx) => {
    const acquisitionNow = await databaseUtcNow(tx);
    const acquisitionResendWindowStart = new Date(
      acquisitionNow.getTime() - RESEND_IDEMPOTENCY_WINDOW_MS,
    );
    const orderFilter = options.orderId
      ? Prisma.sql`AND "orderId" = ${options.orderId}`
      : Prisma.empty;
    const candidates = await tx.$queryRaw<TransferProofReviewDeliveryIntent[]>(Prisma.sql`
      SELECT *
      FROM "TransferProofReviewDeliveryIntent"
      WHERE "attemptCount" < ${MAX_ATTEMPTS}
        ${orderFilter}
        AND (
          (status IN ('PENDING', 'FAILED') AND "availableAt" <= ${acquisitionNow})
          OR (status = 'PROCESSING' AND "leaseExpiresAt" <= ${acquisitionNow})
        )
        AND (
          (provider IS NOT NULL AND provider NOT IN ('RESEND', 'SENDGRID'))
          OR (provider IS NULL AND (
            ${providerConfigured} OR "attemptCount" > 0 OR status = 'PROCESSING'
          ))
          OR (provider = 'RESEND' AND (
            ${resendConfigured}
            OR ("attemptCount" > 0 AND (
              "firstAttemptAt" IS NULL
              OR "firstAttemptAt" <= ${acquisitionResendWindowStart}
            ))
          ))
          OR (provider = 'SENDGRID' AND (
            ${sendGridConfigured}
            OR (status = 'PROCESSING' AND "dispatchStartedAt" IS NOT NULL)
          ))
        )
      ORDER BY "availableAt" ASC, "createdAt" ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    `);
    const acquired: Array<{
      row: TransferProofReviewDeliveryIntent;
      provider: EmailProvider;
      leaseExpiresAt: Date;
      claimToken: string;
    }> = [];
    let quarantinedCount = 0;
    for (const row of candidates) {
      const claimNow = await databaseUtcNow(tx);
      const resendWindowStart = new Date(claimNow.getTime() - RESEND_IDEMPOTENCY_WINDOW_MS);
      const staleClaim = row.status === "PROCESSING";
      const recordedProvider = row.provider === "RESEND" || row.provider === "SENDGRID"
        ? row.provider
        : null;
      const recordedProviderInvalid = Boolean(row.provider && !recordedProvider);
      const provider = recordedProviderInvalid
        ? null
        : recordedProvider ?? configuredEmailProvider();
      const attemptedProviderMissing = row.attemptCount > 0 && !recordedProvider;
      const staleProviderMissing = staleClaim && !recordedProvider;
      const resendAttemptTimeMissing = recordedProvider === "RESEND"
        && row.attemptCount > 0 && !row.firstAttemptAt;
      const resendWindowExpired = recordedProvider === "RESEND" && row.firstAttemptAt
        && row.firstAttemptAt <= resendWindowStart;
      const ambiguousStaleClaim = staleClaim && Boolean(row.dispatchStartedAt)
        && recordedProvider !== "RESEND";
      if (
        recordedProviderInvalid
        || attemptedProviderMissing
        || staleProviderMissing
        || resendAttemptTimeMissing
        || resendWindowExpired
        || ambiguousStaleClaim
      ) {
        const quarantined = await tx.transferProofReviewDeliveryIntent.updateMany({
          where: { id: row.id, status: row.status, claimToken: row.claimToken },
          data: {
            status: "RECONCILIATION_REQUIRED",
            processingAt: null,
            leaseExpiresAt: null,
            claimToken: null,
            dispatchStartedAt: null,
            lastError: recordedProviderInvalid
              ? `Unsupported recorded review delivery provider ${row.provider}; reconciliation required`
              : attemptedProviderMissing
                ? "Attempted review delivery has no recorded provider; reconciliation required"
              : staleProviderMissing
                ? "Expired review delivery claim has no recorded provider; reconciliation required"
                : resendAttemptTimeMissing
                  ? "Resend review delivery first-attempt time is missing; reconciliation required"
                  : resendWindowExpired
                    ? "Resend review delivery idempotency window expired; reconciliation required"
                    : "Ambiguous prior review delivery requires reconciliation",
          },
        });
        quarantinedCount += quarantined.count;
        continue;
      }
      if (!provider || !providerIsConfigured(provider)) continue;
      const leaseExpiresAt = new Date(claimNow.getTime() + LEASE_MS);
      const claimToken = randomUUID();
      const claim = await tx.transferProofReviewDeliveryIntent.updateMany({
        where: {
          id: row.id,
          status: row.status,
          claimToken: row.claimToken,
          attemptCount: row.attemptCount,
        },
        data: {
          status: "PROCESSING",
          provider,
          processingAt: claimNow,
          leaseExpiresAt,
          claimToken,
          dispatchStartedAt: null,
          lastError: null,
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
    let providerAccepted = false;
    let providerIdentityMismatch = false;
    let providerResult: string | null = null;
    let providerFailure: string | null = null;
    try {
      requireCanonicalEnvelope(row);
      const dispatch = await db.$transaction(async (tx) => {
        await requireRuntimeReviewSubject(tx, row);
        const dispatchNow = await databaseUtcNow(tx);
        return tx.transferProofReviewDeliveryIntent.updateMany({
          where: {
            id: row.id,
            status: "PROCESSING",
            provider,
            leaseExpiresAt: { equals: leaseExpiresAt, gt: dispatchNow },
            claimToken,
            attemptCount: row.attemptCount,
            dispatchStartedAt: null,
          },
          data: {
            attemptCount: { increment: 1 },
            firstAttemptAt: row.firstAttemptAt ?? dispatchNow,
            dispatchStartedAt: dispatchNow,
          },
        });
      });
      if (dispatch.count !== 1) continue;
      dispatchStarted = true;
      attemptCount = row.attemptCount + 1;

      const result = await sendEmail({
        to: row.recipient,
        subject: row.subject,
        text: row.textBody,
        html: row.htmlBody,
        idempotencyKey: row.idempotencyKey,
        provider,
      });
      providerAccepted = result.ok;
      providerResult = result.providerResult || (result.ok ? "ACCEPTED" : "REJECTED");
      providerFailure = result.ok ? null : result.error || "Unknown provider error";
      providerIdentityMismatch = result.ok && result.provider !== provider;
      if (providerIdentityMismatch) {
        throw new Error(`Transfer-proof review delivery provider changed from ${provider} to ${result.provider ?? "UNKNOWN"}`);
      }
      if (!result.ok) throw new Error(result.error || "Review email provider rejected delivery");

      const recorded = await db.$transaction(async (tx) => {
        const recordedAt = await databaseUtcNow(tx);
        const owned = await tx.transferProofReviewDeliveryIntent.updateMany({
          where: {
            id: row.id,
            status: "PROCESSING",
            provider,
            leaseExpiresAt,
            claimToken,
            attemptCount,
          },
          data: {
            status: "DELIVERED",
            deliveredAt: recordedAt,
            processingAt: null,
            leaseExpiresAt: null,
            claimToken: null,
            dispatchStartedAt: null,
            providerResult,
            lastError: null,
          },
        });
        if (owned.count !== 1) return owned;
        await tx.emailDelivery.upsert({
          where: { orderId_emailType_recipient: {
            orderId: row.orderId,
            emailType: `TRANSFER_PROOF_HUMAN_REVIEW_${row.requestId}`,
            recipient: row.recipient,
          } },
          create: {
            orderId: row.orderId,
            emailType: `TRANSFER_PROOF_HUMAN_REVIEW_${row.requestId}`,
            recipient: row.recipient,
            provider,
            status: "SENT",
            error: null,
            sentAt: recordedAt,
          },
          update: { provider, status: "SENT", error: null, sentAt: recordedAt },
        });
        return owned;
      });
      if (recorded.count !== 1) {
        throw new Error("Review provider accepted delivery but claim ownership was lost");
      }
      delivered += 1;
    } catch (error) {
      const lastError = error instanceof Error ? error.message : "Unknown review delivery error";
      if (!dispatchStarted) {
        const quarantinedAt = await databaseUtcNow(db);
        const quarantined = await db.transferProofReviewDeliveryIntent.updateMany({
          where: {
            id: row.id,
            status: "PROCESSING",
            provider,
            leaseExpiresAt,
            claimToken,
            attemptCount: row.attemptCount,
            dispatchStartedAt: null,
          },
          data: {
            status: "RECONCILIATION_REQUIRED",
            processingAt: null,
            leaseExpiresAt: null,
            claimToken: null,
            dispatchStartedAt: null,
            lastError: `Pre-dispatch review delivery failure: ${lastError}`.slice(0, 2000),
            availableAt: new Date(quarantinedAt.getTime() + RETRY_BASE_MS),
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
        const recoveredAt = await databaseUtcNow(tx);
        const owned = await tx.transferProofReviewDeliveryIntent.updateMany({
          where: {
            id: row.id,
            status: "PROCESSING",
            provider,
            leaseExpiresAt,
            claimToken,
            attemptCount,
          },
          data: {
            status: retryAcceptedResend
              ? "PROCESSING"
              : requiresReconciliation ? "RECONCILIATION_REQUIRED" : "FAILED",
            ...(retryAcceptedResend
              ? { leaseExpiresAt: recoveredAt }
              : {
                processingAt: null,
                leaseExpiresAt: null,
                claimToken: null,
                dispatchStartedAt: null,
              }),
            providerResult,
            lastError: lastError.slice(0, 2000),
            availableAt: attemptCount < MAX_ATTEMPTS
              ? new Date(recoveredAt.getTime() + RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1))
              : recoveredAt,
          },
        });
        if (owned.count !== 1 || providerAccepted) return owned;
        await tx.emailDelivery.upsert({
          where: { orderId_emailType_recipient: {
            orderId: row.orderId,
            emailType: `TRANSFER_PROOF_HUMAN_REVIEW_${row.requestId}`,
            recipient: row.recipient,
          } },
          create: {
            orderId: row.orderId,
            emailType: `TRANSFER_PROOF_HUMAN_REVIEW_${row.requestId}`,
            recipient: row.recipient,
            provider,
            status: "FAILED",
            error: providerFailure || lastError,
            sentAt: recoveredAt,
          },
          update: {
            provider,
            status: "FAILED",
            error: providerFailure || lastError,
            sentAt: recoveredAt,
          },
        });
        return owned;
      });
      if (requiresReconciliation) reconciliationRequired += recovered.count;
      failed += recovered.count;
    }
  }

  return {
    scanned: acquisition.candidates,
    claimed,
    delivered,
    failed,
    reconciliationRequired,
  };
}
