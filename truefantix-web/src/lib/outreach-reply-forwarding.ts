import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

const CLAIM_MINUTES = 15;
const RECOVERY_LIMIT = 100;
const RESPONSE_MAX_BYTES = 64 * 1024;
const REQUEST_MAX_BYTES = 128 * 1024;
const PROVIDER_TIMEOUT_MS = 15_000;
const MAX_PROVIDER_MESSAGE_ID = 512;
const MAX_FORWARD_SUBJECT = 1_000;
const MAX_FORWARD_TEXT = 110_000;

type ForwardConfig = Readonly<{
  apiKey: string;
  fromEmail: string;
  toEmail: string;
}>;

type ForwardEnvelopeInput = Readonly<{
  providerEmailId: string;
  fromEmail: string;
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;
  attachmentCount: number;
  receivedAt: Date;
}>;

type ProviderOptions = Readonly<{
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}>;

type DrainOptions = ProviderOptions & Readonly<{
  limit?: number;
  providerEmailId?: string;
}>;

type ClaimedIntent = Readonly<{
  id: string;
  claimToken: string;
  providerEmailId: string;
  fromEmailSnapshot: string;
  toEmailSnapshot: string;
  subjectSnapshot: string;
  textBodySnapshot: string;
  idempotencyKey: string;
}>;

type ProviderEnvelope = Pick<
  ClaimedIntent,
  "fromEmailSnapshot" | "toEmailSnapshot" | "subjectSnapshot" | "textBodySnapshot"
>;

export type OutreachReplyForwardDrainResult = Readonly<{
  scanned: number;
  claimed: number;
  delivered: number;
  failed: number;
  reconciliationRequired: number;
  quarantined: number;
}>;

export class OutreachReplyForwardRejectedError extends Error {
  constructor() {
    super("RESEND_FORWARD_REJECTED");
    this.name = "OutreachReplyForwardRejectedError";
  }
}

export class OutreachReplyForwardUncertainError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "OutreachReplyForwardUncertainError";
  }
}

function clean(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, "");
}

function normalizedConfiguredEmail(value: string | undefined) {
  const cleaned = clean(value);
  if (!cleaned || cleaned.length > 1_000 || /[\r\n]/.test(cleaned)) return null;
  const bracketed = cleaned.match(/^.*<([^<>]+)>$/)?.[1]?.trim() ?? cleaned;
  const normalized = bracketed.toLowerCase();
  if (
    normalized.length < 3
    || normalized.length > 320
    || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function outreachReplyForwardingConfig(
  env: NodeJS.ProcessEnv = process.env,
): ForwardConfig | null {
  const apiKey = clean(env.OUTREACH_RESEND_INBOUND_API_KEY);
  const toEmail = normalizedConfiguredEmail(env.OUTREACH_REPLY_FORWARD_TO);
  const fromEmail = normalizedConfiguredEmail(env.OUTREACH_FROM_EMAIL || "marc@truefantix.com");
  if (!apiKey || !toEmail || !fromEmail) return null;
  return Object.freeze({ apiKey, toEmail, fromEmail });
}

function boundedSubject(value: string | null) {
  const subject = (value || "(No subject)").replace(/[\r\n]+/g, " ").trim() || "(No subject)";
  return `Outreach reply: ${subject}`.slice(0, MAX_FORWARD_SUBJECT);
}

function boundedForwardText(input: ForwardEnvelopeInput) {
  const body = input.textBody ?? (
    input.htmlBody
      ? "[No plain-text body was provided. The captured HTML body is not forwarded by this notification.]"
      : "[No message body was provided.]"
  );
  const attachmentNotice = input.attachmentCount === 0
    ? "Attachments: none"
    : `Attachments: ${input.attachmentCount} (attachments are not forwarded by this notification)`;
  const text = [
    "A reply to a TrueFanTix outreach email was captured.",
    "This is a bounded plain-text notification, not a passthrough copy of the original MIME message.",
    "",
    `From: ${input.fromEmail}`,
    `Received: ${input.receivedAt.toISOString()}`,
    attachmentNotice,
    "",
    "Reply body:",
    body,
  ].join("\n");
  return text.slice(0, MAX_FORWARD_TEXT);
}

export function buildOutreachReplyForwardIntent(
  input: ForwardEnvelopeInput,
  config: ForwardConfig,
) {
  const subjectSnapshot = boundedSubject(input.subject);
  const textBodySnapshot = boundedForwardText(input);
  const identityFields = [
    "v1",
    input.providerEmailId,
    config.fromEmail,
    config.toEmail,
    subjectSnapshot,
    textBodySnapshot,
    String(input.attachmentCount),
  ];
  const canonicalIdentity = identityFields
    .map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`)
    .join("");
  const digest = createHash("sha256").update(canonicalIdentity, "utf8").digest("hex");
  return Object.freeze({
    providerEmailId: input.providerEmailId,
    fromEmailSnapshot: config.fromEmail,
    toEmailSnapshot: config.toEmail,
    subjectSnapshot,
    textBodySnapshot,
    attachmentCount: input.attachmentCount,
    idempotencyKey: `tft-outreach-reply-forward-v1-${digest}`,
  });
}

function providerTimeout(value: number | undefined) {
  if (value === undefined) return PROVIDER_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0 || value > 60_000) {
    throw new Error("Outreach reply forward timeout is invalid.");
  }
  return value;
}

function isJsonContentType(value: string | null) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function nonBlockingCancel(cancel: () => Promise<unknown> | unknown) {
  try {
    void Promise.resolve(cancel()).catch(() => undefined);
  } catch {
    // Cleanup must not replace the canonical provider outcome.
  }
}

function serializedProviderRequest(intent: ProviderEnvelope) {
  return JSON.stringify({
    from: intent.fromEmailSnapshot,
    to: [intent.toEmailSnapshot],
    subject: intent.subjectSnapshot,
    text: intent.textBodySnapshot,
  });
}

function providerRequestIsBounded(intent: ProviderEnvelope) {
  return Buffer.byteLength(serializedProviderRequest(intent), "utf8") <= REQUEST_MAX_BYTES;
}

export async function sendOutreachReplyForward(
  intent: ClaimedIntent,
  config: ForwardConfig,
  options: ProviderOptions = {},
) {
  const payload = serializedProviderRequest(intent);

  const controller = new AbortController();
  const timeoutMs = providerTimeout(options.timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    if (!controller.signal.aborted) controller.abort();
    if (reader) nonBlockingCancel(() => reader?.cancel());
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      cancel();
      reject(new OutreachReplyForwardUncertainError("RESEND_FORWARD_TIMEOUT"));
    }, timeoutMs);
  });

  const operation = (async () => {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": intent.idempotencyKey,
          "User-Agent": "TrueFanTix/1.0",
        },
        body: payload,
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new OutreachReplyForwardUncertainError("RESEND_FORWARD_TRANSPORT_UNCERTAIN");
    }

    reader = response.body?.getReader() ?? null;
    if (!response.ok) {
      cancel();
      if (response.status >= 400 && response.status < 500 && response.status !== 409) {
        throw new OutreachReplyForwardRejectedError();
      }
      throw new OutreachReplyForwardUncertainError(
        response.status === 409
          ? "RESEND_FORWARD_CONCURRENT_IDEMPOTENCY"
          : "RESEND_FORWARD_HTTP_UNCERTAIN",
      );
    }
    if (!reader || !isJsonContentType(response.headers.get("content-type"))) {
      cancel();
      throw new OutreachReplyForwardUncertainError("RESEND_FORWARD_ACCEPTANCE_INVALID");
    }
    const declared = response.headers.get("content-length");
    if (declared !== null) {
      if (!/^(0|[1-9]\d*)$/.test(declared) || declared.length > 12) {
        cancel();
        throw new OutreachReplyForwardUncertainError("RESEND_FORWARD_ACCEPTANCE_INVALID");
      }
      const length = Number(declared);
      if (!Number.isSafeInteger(length) || length > RESPONSE_MAX_BYTES) {
        cancel();
        throw new OutreachReplyForwardUncertainError("RESEND_FORWARD_ACCEPTANCE_INVALID");
      }
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) {
          throw new OutreachReplyForwardUncertainError("RESEND_FORWARD_ACCEPTANCE_INVALID");
        }
        total += chunk.value.byteLength;
        if (total > RESPONSE_MAX_BYTES) {
          throw new OutreachReplyForwardUncertainError("RESEND_FORWARD_ACCEPTANCE_INVALID");
        }
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new OutreachReplyForwardUncertainError("RESEND_FORWARD_ACCEPTANCE_INVALID");
      }
      const messageId = (parsed as Record<string, unknown>).id;
      if (
        typeof messageId !== "string"
        || messageId.length === 0
        || messageId.length > MAX_PROVIDER_MESSAGE_ID
        || messageId.trim() !== messageId
      ) {
        throw new OutreachReplyForwardUncertainError("RESEND_FORWARD_ACCEPTANCE_INVALID");
      }
      return Object.freeze({ messageId });
    } catch (error) {
      cancel();
      if (error instanceof OutreachReplyForwardUncertainError) throw error;
      throw new OutreachReplyForwardUncertainError("RESEND_FORWARD_ACCEPTANCE_INVALID");
    }
  })();

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function recoverExpiredClaims() {
  const ambiguous = await prisma.$executeRaw`
    WITH expired AS (
      SELECT "id"
      FROM "OutreachReplyForwardIntent"
      WHERE "status" = 'PROCESSING'
        AND "attemptCount" = 1
        AND "claimExpiresAt" <= CURRENT_TIMESTAMP
      ORDER BY "claimExpiresAt", "createdAt", "id"
      LIMIT ${RECOVERY_LIMIT}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "OutreachReplyForwardIntent"
    SET "status" = 'RECONCILIATION_REQUIRED',
        "failureCode" = 'FORWARD_CLAIM_EXPIRED_AFTER_DISPATCH',
        "completedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
    FROM expired
    WHERE "OutreachReplyForwardIntent"."id" = expired."id"
  `;
  await prisma.$executeRaw`
    WITH expired AS (
      SELECT "id"
      FROM "OutreachReplyForwardIntent"
      WHERE "status" = 'PROCESSING'
        AND "attemptCount" = 0
        AND "claimExpiresAt" <= CURRENT_TIMESTAMP
      ORDER BY "claimExpiresAt", "createdAt", "id"
      LIMIT ${RECOVERY_LIMIT}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "OutreachReplyForwardIntent"
    SET "status" = 'PENDING',
        "claimToken" = NULL,
        "claimExpiresAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
    FROM expired
    WHERE "OutreachReplyForwardIntent"."id" = expired."id"
  `;
  return ambiguous;
}

async function claimIntent(id: string, config: ForwardConfig | null): Promise<ClaimedIntent | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{
      id: string;
      providerEmailId: string;
      fromEmailSnapshot: string;
      toEmailSnapshot: string;
      subjectSnapshot: string;
      textBodySnapshot: string;
      idempotencyKey: string;
      status: string;
    }>>`
      SELECT "id", "providerEmailId", "fromEmailSnapshot", "toEmailSnapshot",
             "subjectSnapshot", "textBodySnapshot", "idempotencyKey", "status"
      FROM "OutreachReplyForwardIntent"
      WHERE "id" = ${id}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row || row.status !== "PENDING") return null;
    if (
      !config
      || config.fromEmail !== row.fromEmailSnapshot
      || config.toEmail !== row.toEmailSnapshot
    ) {
      await tx.$executeRaw`
        UPDATE "OutreachReplyForwardIntent"
        SET "status" = 'QUARANTINED',
            "failureCode" = 'FORWARD_CONFIGURATION_DRIFT',
            "completedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${id} AND "status" = 'PENDING'
      `;
      return null;
    }
    if (!providerRequestIsBounded(row)) {
      await tx.$executeRaw`
        UPDATE "OutreachReplyForwardIntent"
        SET "status" = 'QUARANTINED',
            "failureCode" = 'FORWARD_LOCAL_ENVELOPE_INVALID',
            "completedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${id} AND "status" = 'PENDING'
      `;
      return null;
    }
    const claimToken = randomUUID();
    const claimed = await tx.$queryRaw<Array<ClaimedIntent>>`
      UPDATE "OutreachReplyForwardIntent"
      SET "status" = 'PROCESSING',
          "claimToken" = ${claimToken},
          "claimExpiresAt" = CURRENT_TIMESTAMP + (${CLAIM_MINUTES} * INTERVAL '1 minute'),
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}
        AND "status" = 'PENDING'
        AND "availableAt" <= CURRENT_TIMESTAMP
      RETURNING "id", "claimToken", "providerEmailId", "fromEmailSnapshot",
                "toEmailSnapshot", "subjectSnapshot", "textBodySnapshot", "idempotencyKey"
    `;
    return claimed[0] ? Object.freeze(claimed[0]) : null;
  }, { isolationLevel: "ReadCommitted" });
}

async function markProviderDispatch(intent: ClaimedIntent) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "OutreachReplyForwardIntent"
    SET "attemptCount" = 1,
        "providerDispatchAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${intent.id}
      AND "status" = 'PROCESSING'
      AND "attemptCount" = 0
      AND "claimToken" = ${intent.claimToken}
      AND "claimExpiresAt" > CURRENT_TIMESTAMP
    RETURNING "id"
  `;
  return rows.length === 1;
}

async function settleIntent(
  intent: ClaimedIntent,
  outcome: "DELIVERED" | "FAILED" | "RECONCILIATION_REQUIRED",
  evidence: string,
) {
  await prisma.$transaction(async (tx) => {
    if (outcome === "DELIVERED") {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "OutreachReplyForwardIntent"
        SET "status" = 'DELIVERED',
            "providerMessageId" = ${evidence},
            "completedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${intent.id}
          AND "status" = 'PROCESSING'
          AND "attemptCount" = 1
          AND "claimToken" = ${intent.claimToken}
        RETURNING "id"
      `;
      if (rows.length !== 1) throw new Error("Outreach reply forward acceptance lost its claim.");
      const replies = await tx.$executeRaw`
        UPDATE "OutreachReply"
        SET "forwardedAt" = CURRENT_TIMESTAMP
        WHERE "providerEmailId" = ${intent.providerEmailId}
          AND "forwardedAt" IS NULL
      `;
      if (replies !== 1) throw new Error("Outreach reply forward acceptance lost its reply.");
      return;
    }
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "OutreachReplyForwardIntent"
      SET "status" = ${outcome},
          "failureCode" = ${evidence},
          "completedAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${intent.id}
        AND "status" = 'PROCESSING'
        AND "attemptCount" = 1
        AND "claimToken" = ${intent.claimToken}
      RETURNING "id"
    `;
    if (rows.length !== 1) throw new Error("Outreach reply forward failure lost its claim.");
  }, { isolationLevel: "ReadCommitted" });
}

export async function drainOutreachReplyForwardIntents(
  options: DrainOptions = {},
): Promise<OutreachReplyForwardDrainResult> {
  const limit = options.limit === undefined ? 100 : options.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Outreach reply forward drain limit is invalid.");
  }
  const reconciliationRequired = await recoverExpiredClaims();
  const candidates = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "OutreachReplyForwardIntent"
    WHERE "status" = 'PENDING'
      AND "availableAt" <= CURRENT_TIMESTAMP
      AND (${options.providerEmailId ?? null}::text IS NULL OR "providerEmailId" = ${options.providerEmailId ?? null})
    ORDER BY "availableAt", "createdAt", "id"
    LIMIT ${limit}
  `;
  const config = outreachReplyForwardingConfig();
  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let reconciliations = reconciliationRequired;
  let quarantined = 0;

  for (const candidate of candidates) {
    const intent = await claimIntent(candidate.id, config);
    if (!intent) {
      const status = await prisma.outreachReplyForwardIntent.findUnique({
        where: { id: candidate.id },
        select: { status: true },
      });
      if (status?.status === "QUARANTINED") quarantined += 1;
      continue;
    }
    claimed += 1;
    if (!await markProviderDispatch(intent)) continue;
    try {
      const accepted = await sendOutreachReplyForward(intent, config!, options);
      try {
        await settleIntent(intent, "DELIVERED", accepted.messageId);
        delivered += 1;
      } catch {
        await settleIntent(
          intent,
          "RECONCILIATION_REQUIRED",
          "FORWARD_ACCEPTANCE_PERSISTENCE_FAILED",
        ).catch(() => undefined);
        reconciliations += 1;
      }
    } catch (error) {
      if (error instanceof OutreachReplyForwardRejectedError) {
        await settleIntent(intent, "FAILED", "RESEND_FORWARD_REJECTED");
        failed += 1;
      } else {
        const code = error instanceof OutreachReplyForwardUncertainError
          ? error.code
          : "RESEND_FORWARD_OUTCOME_UNCERTAIN";
        await settleIntent(intent, "RECONCILIATION_REQUIRED", code);
        reconciliations += 1;
      }
    }
  }

  return Object.freeze({
    scanned: candidates.length,
    claimed,
    delivered,
    failed,
    reconciliationRequired: reconciliations,
    quarantined,
  });
}
