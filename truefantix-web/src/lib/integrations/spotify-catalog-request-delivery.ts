import { createHash, randomUUID } from "node:crypto";
import { Prisma, type SpotifyCatalogRequestDeliveryIntent } from "@prisma/client";
import { sendEmail, type EmailSendResult } from "@/lib/email";
import { configuredEmailProvider, emailProviderIsConfigured } from "@/lib/emailProviderConfig";
import { prisma } from "@/lib/prisma";

const ADMIN_EMAIL = "admin@truefantix.com";
const LEASE_MS = 15 * 60 * 1000;
const MAX_INTENTS_PER_IMPORT = 350;
const MAX_RECOVERY_INTENTS = 100;

type PendingCatalogRequest = Readonly<{
  id: string;
  requestedValue: string;
  status: string;
}>;

type DeliveryPayload = Readonly<{
  requestIds: readonly string[];
  names: readonly string[];
}>;

function framedDigest(values: readonly string[]) {
  return createHash("sha256")
    .update(values.map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`).join(""))
    .digest("hex");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]
    || character
  ));
}

function renderEnvelope(payload: DeliveryPayload) {
  const subject = `Spotify catalog requests: ${payload.names.length} artist${payload.names.length === 1 ? "" : "s"}`;
  const textBody = `A TrueFanTix user imported Spotify artists that need catalog review.

Artists:
${payload.names.map((name) => `- ${name}`).join("\n")}

Review pending catalog requests in /admin/catalog-requests and fulfill them to add the artists to the user's notification favorites.`;
  const htmlBody = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
  <h2>Spotify catalog requests</h2>
  <p>A TrueFanTix user imported Spotify artists that need catalog review.</p>
  <ul>${payload.names.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>
  <p>Review pending catalog requests in <code>/admin/catalog-requests</code> and fulfill them to add the artists to the user's notification favorites.</p>
</body>
</html>`;
  return { subject, textBody, htmlBody };
}

function envelopeEvidence(input: {
  userId: string;
  recipient: string;
  payload: DeliveryPayload;
  subject: string;
  textBody: string;
  htmlBody: string;
}) {
  const values = [
    input.userId,
    input.recipient,
    ...input.payload.requestIds,
    ...input.payload.names,
    input.subject,
    input.textBody,
    input.htmlBody,
  ];
  const envelopeDigest = framedDigest(values);
  const idempotencyKey = `spotify-catalog:${framedDigest([
    input.userId,
    ...input.payload.requestIds,
  ])}`;
  return { envelopeDigest, idempotencyKey };
}

export async function stageSpotifyCatalogRequestDelivery(
  tx: Prisma.TransactionClient,
  userId: string,
  requests: readonly PendingCatalogRequest[],
) {
  if (requests.length > MAX_INTENTS_PER_IMPORT) {
    throw new Error("SPOTIFY_CATALOG_DELIVERY_LIMIT_EXCEEDED");
  }
  const pending = requests
    .filter((request) => request.status === "PENDING")
    .sort((left, right) => left.id.localeCompare(right.id));
  if (pending.length === 0) return Object.freeze([] as string[]);

  const memberships = await tx.spotifyCatalogRequestDeliveryItem.findMany({
    where: { catalogRequestId: { in: pending.map((request) => request.id) } },
    select: { catalogRequestId: true, intentId: true, requestedValue: true },
  });
  const byRequestId = new Map(memberships.map((item) => [item.catalogRequestId, item]));
  for (const request of pending) {
    const existing = byRequestId.get(request.id);
    if (existing && existing.requestedValue !== request.requestedValue) {
      throw new Error("SPOTIFY_CATALOG_DELIVERY_IDENTITY_COLLISION");
    }
  }

  const intentIds = new Set(memberships.map((item) => item.intentId));
  const unreserved = pending.filter((request) => !byRequestId.has(request.id));
  if (unreserved.length > 0) {
    const payload = Object.freeze({
      requestIds: Object.freeze(unreserved.map((request) => request.id)),
      names: Object.freeze(unreserved.map((request) => request.requestedValue)),
    });
    const rendered = renderEnvelope(payload);
    const evidence = envelopeEvidence({ userId, recipient: ADMIN_EMAIL, payload, ...rendered });
    const intent = await tx.spotifyCatalogRequestDeliveryIntent.create({
      data: {
        userId,
        recipient: ADMIN_EMAIL,
        ...rendered,
        payloadJson: payload as Prisma.InputJsonValue,
        ...evidence,
        items: {
          create: unreserved.map((request) => ({
            catalogRequestId: request.id,
            requestedValue: request.requestedValue,
          })),
        },
      },
      select: { id: true },
    });
    intentIds.add(intent.id);
  }
  return Object.freeze([...intentIds].sort());
}

function canonicalEnvelope(row: SpotifyCatalogRequestDeliveryIntent) {
  if (!row.payloadJson || typeof row.payloadJson !== "object" || Array.isArray(row.payloadJson)) {
    throw new Error("SPOTIFY_CATALOG_DELIVERY_ENVELOPE_INVALID");
  }
  const payload = row.payloadJson as Record<string, unknown>;
  if (
    Object.keys(payload).sort().join(",") !== "names,requestIds"
    || !Array.isArray(payload.requestIds)
    || !Array.isArray(payload.names)
    || payload.requestIds.length === 0
    || payload.requestIds.length !== payload.names.length
    || payload.requestIds.length > MAX_INTENTS_PER_IMPORT
    || payload.requestIds.some((value) => typeof value !== "string" || !value)
    || payload.names.some((value) => typeof value !== "string" || !value)
  ) {
    throw new Error("SPOTIFY_CATALOG_DELIVERY_ENVELOPE_INVALID");
  }
  const normalized = Object.freeze({
    requestIds: Object.freeze(payload.requestIds as string[]),
    names: Object.freeze(payload.names as string[]),
  });
  const rendered = renderEnvelope(normalized);
  const evidence = envelopeEvidence({
    userId: row.userId,
    recipient: row.recipient,
    payload: normalized,
    ...rendered,
  });
  if (
    row.recipient !== ADMIN_EMAIL
    || row.subject !== rendered.subject
    || row.textBody !== rendered.textBody
    || row.htmlBody !== rendered.htmlBody
    || row.envelopeDigest !== evidence.envelopeDigest
    || row.idempotencyKey !== evidence.idempotencyKey
  ) {
    throw new Error("SPOTIFY_CATALOG_DELIVERY_ENVELOPE_INVALID");
  }
  return normalized;
}

type DeliveryDb = Pick<
  typeof prisma,
  "$executeRaw" | "$queryRaw" | "$transaction" | "spotifyCatalogRequestDeliveryIntent"
>;

type DeliveryOptions = {
  env?: NodeJS.ProcessEnv;
  send?: (payload: Parameters<typeof sendEmail>[0]) => Promise<EmailSendResult>;
};

function boundedProviderResult(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 2_000) : fallback;
}

function classifyProviderResult(result: EmailSendResult) {
  if (result.ok) {
    return Object.freeze({
      status: "DELIVERED" as const,
      providerResult: boundedProviderResult(result.providerResult, "ACCEPTED"),
      lastError: null,
    });
  }
  const providerResult = boundedProviderResult(result.providerResult, "AMBIGUOUS_PROVIDER_OUTCOME");
  if (/^HTTP 4[0-9]{2}$/.test(providerResult)) {
    return Object.freeze({
      status: "FAILED" as const,
      providerResult,
      lastError: "Email provider rejected delivery",
    });
  }
  return Object.freeze({
    status: "RECONCILIATION_REQUIRED" as const,
    providerResult,
    lastError: "Email provider outcome requires reconciliation",
  });
}

async function databaseNow(db: Pick<typeof prisma, "$queryRaw">) {
  const [row] = await db.$queryRaw<Array<{ now: Date }>>`
    SELECT statement_timestamp() AT TIME ZONE 'UTC' AS now
  `;
  return row.now;
}

export async function drainSpotifyCatalogRequestDeliveries(
  intentIds: readonly string[],
  db: DeliveryDb = prisma,
  options: DeliveryOptions = {},
) {
  const ids = [...new Set(intentIds)].slice(0, MAX_INTENTS_PER_IMPORT);
  if (ids.length === 0) return Object.freeze({ claimed: 0, delivered: 0, failed: 0, reconciliationRequired: 0 });
  const env = options.env ?? process.env;
  const providerEnv = {
    RESEND_API_KEY: env.RESEND_API_KEY,
    SENDGRID_API_KEY: env.SENDGRID_API_KEY,
  };
  const provider = configuredEmailProvider(providerEnv);
  const expired = await db.$executeRaw(Prisma.sql`
    UPDATE "SpotifyCatalogRequestDeliveryIntent"
    SET status = 'RECONCILIATION_REQUIRED',
      "processingAt" = NULL,
      "leaseExpiresAt" = NULL,
      "claimToken" = NULL,
      "lastError" = 'Expired Spotify catalog delivery claim requires provider reconciliation',
      "updatedAt" = statement_timestamp() AT TIME ZONE 'UTC'
    WHERE id IN (${Prisma.join(ids)})
      AND status = 'PROCESSING'
      AND "leaseExpiresAt" <= statement_timestamp() AT TIME ZONE 'UTC'
  `);
  if (!provider || !emailProviderIsConfigured(provider, providerEnv)) {
    return Object.freeze({ claimed: 0, delivered: 0, failed: 0, reconciliationRequired: expired });
  }

  const acquired = await db.$transaction(async (tx) => {
    const now = await databaseNow(tx);
    const rows = await tx.$queryRaw<SpotifyCatalogRequestDeliveryIntent[]>(Prisma.sql`
      SELECT * FROM "SpotifyCatalogRequestDeliveryIntent"
      WHERE id IN (${Prisma.join(ids)})
        AND status = 'PENDING'
        AND "availableAt" <= statement_timestamp() AT TIME ZONE 'UTC'
      ORDER BY "createdAt" ASC, id ASC
      FOR UPDATE SKIP LOCKED
    `);
    const claimed: Array<{ row: SpotifyCatalogRequestDeliveryIntent; claimToken: string; leaseExpiresAt: Date }> = [];
    for (const row of rows) {
      const claimToken = randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
      const result = await tx.spotifyCatalogRequestDeliveryIntent.updateMany({
        where: { id: row.id, status: "PENDING", attemptCount: 0, provider: null },
        data: { status: "PROCESSING", provider, processingAt: now, leaseExpiresAt, claimToken },
      });
      if (result.count === 1) claimed.push({ row, claimToken, leaseExpiresAt });
    }
    return claimed;
  });

  let delivered = 0;
  let failed = 0;
  let reconciliationRequired = expired;
  const send = options.send ?? sendEmail;
  for (const acquiredIntent of acquired) {
    const { row, claimToken, leaseExpiresAt } = acquiredIntent;
    let dispatched = false;
    try {
      const payload = canonicalEnvelope(row);
      const dispatch = await db.$transaction(async (tx) => {
        const now = await databaseNow(tx);
        const items = await tx.spotifyCatalogRequestDeliveryItem.findMany({
          where: { intentId: row.id },
          orderBy: { catalogRequestId: "asc" },
          select: { catalogRequestId: true, requestedValue: true },
        });
        if (
          items.length !== payload.requestIds.length
          || items.some((item, index) => (
            item.catalogRequestId !== payload.requestIds[index]
            || item.requestedValue !== payload.names[index]
          ))
        ) {
          throw new Error("SPOTIFY_CATALOG_DELIVERY_ITEMS_INVALID");
        }
        return tx.spotifyCatalogRequestDeliveryIntent.updateMany({
          where: {
            id: row.id,
            status: "PROCESSING",
            provider,
            attemptCount: 0,
            claimToken,
            leaseExpiresAt: { equals: leaseExpiresAt, gt: now },
            envelopeDigest: row.envelopeDigest,
            idempotencyKey: row.idempotencyKey,
          },
          data: {
            attemptCount: 1,
            firstAttemptAt: now,
            dispatchStartedAt: now,
          },
        });
      });
      if (dispatch.count !== 1) continue;
      dispatched = true;
      const result = await send({
        to: row.recipient,
        subject: row.subject,
        text: row.textBody,
        html: row.htmlBody,
        idempotencyKey: row.idempotencyKey,
        provider,
      });
      if (result.provider !== provider) {
        throw new Error(`Spotify catalog delivery provider changed from ${provider} to ${result.provider}`);
      }
      const outcome = classifyProviderResult(result);
      const updated = await db.spotifyCatalogRequestDeliveryIntent.updateMany({
        where: { id: row.id, status: "PROCESSING", provider, attemptCount: 1, claimToken, leaseExpiresAt },
        data: {
          status: outcome.status,
          deliveredAt: outcome.status === "DELIVERED" ? await databaseNow(db) : null,
          processingAt: null,
          leaseExpiresAt: null,
          claimToken: null,
          providerResult: outcome.providerResult,
          lastError: outcome.lastError,
        },
      });
      if (updated.count !== 1) {
        reconciliationRequired += 1;
      } else if (outcome.status === "DELIVERED") {
        delivered += 1;
      } else if (outcome.status === "FAILED") {
        failed += 1;
      } else {
        reconciliationRequired += 1;
      }
    } catch {
      const recovered = await db.spotifyCatalogRequestDeliveryIntent.updateMany({
        where: {
          id: row.id,
          status: "PROCESSING",
          provider,
          attemptCount: dispatched ? 1 : 0,
          claimToken,
          leaseExpiresAt,
        },
        data: {
          status: "RECONCILIATION_REQUIRED",
          processingAt: null,
          leaseExpiresAt: null,
          claimToken: null,
          lastError: dispatched
            ? "Post-dispatch Spotify catalog delivery outcome requires reconciliation"
            : "Pre-dispatch Spotify catalog delivery failure requires reconciliation",
        },
      });
      reconciliationRequired += recovered.count;
      failed += recovered.count;
    }
  }
  return Object.freeze({ claimed: acquired.length, delivered, failed, reconciliationRequired });
}

export async function recoverSpotifyCatalogRequestDeliveries(
  db: DeliveryDb = prisma,
  options: DeliveryOptions = {},
) {
  const candidates = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM "SpotifyCatalogRequestDeliveryIntent"
    WHERE (
      status = 'PENDING'
      AND "availableAt" <= statement_timestamp() AT TIME ZONE 'UTC'
    ) OR (
      status = 'PROCESSING'
      AND "leaseExpiresAt" <= statement_timestamp() AT TIME ZONE 'UTC'
    )
    ORDER BY
      CASE WHEN status = 'PROCESSING' THEN 0 ELSE 1 END,
      CASE WHEN status = 'PROCESSING' THEN "leaseExpiresAt" ELSE "availableAt" END ASC,
      "createdAt" ASC,
      id ASC
    LIMIT ${MAX_RECOVERY_INTENTS}
  `);
  return drainSpotifyCatalogRequestDeliveries(
    candidates.map((candidate) => candidate.id),
    db,
    options,
  );
}
