export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { Resend } from "resend";
import { normalizeEmail } from "@/lib/outreach";
import { recordOutreachDeliveryEvent } from "@/lib/outreach-delivery-event";
import { settleOutreachCampaign } from "@/lib/outreach-send";

const MAX_WEBHOOK_BYTES = 256 * 1024;
const WEBHOOK_READ_TIMEOUT_MS = 5_000;
const MAX_SVIX_ID_LENGTH = 256;
const MAX_SVIX_TIMESTAMP_LENGTH = 64;
const MAX_SVIX_SIGNATURE_LENGTH = 2_048;
const MAX_EVENT_TYPE_LENGTH = 64;
const MAX_PROVIDER_MESSAGE_ID_LENGTH = 256;
const MAX_EMAIL_LENGTH = 320;
const MAX_TIMESTAMP_LENGTH = 64;
const MAX_DETAIL_INPUT_LENGTH = 4_096;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SVIX_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const trackedTypes = new Set([
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
]);

const recipientStatuses: Readonly<Record<string, string>> = Object.freeze({
  "email.sent": "SENT",
  "email.delivered": "DELIVERED",
  "email.delivery_delayed": "DELIVERY_DELAYED",
  "email.bounced": "BOUNCED",
  "email.complained": "COMPLAINED",
  "email.failed": "FAILED",
  "email.suppressed": "SUPPRESSED",
});

class InvalidWebhookIngressError extends Error {}

type VerifiedTrackedEvent = Readonly<{
  type: string;
  providerMessageId: string;
  deliveryAttemptId: string | null;
  normalizedEmail: string;
  occurredAt: Date;
  detail: string | null;
}>;

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function nonBlockingCancel(cancel: () => Promise<unknown> | unknown) {
  try {
    void Promise.resolve(cancel()).catch(() => undefined);
  } catch {
    // Cleanup must never replace the already determined ingress outcome.
  }
}

function cancelUnlockedBody(body: ReadableStream<Uint8Array> | null) {
  if (body && !body.locked) nonBlockingCancel(() => body.cancel());
}

function boundedRequiredHeader(headers: Headers, name: string, maxLength: number) {
  const value = headers.get(name);
  if (!value || value.length > maxLength) throw new InvalidWebhookIngressError();
  return value;
}

function verifiedHeaders(req: Request) {
  const id = boundedRequiredHeader(req.headers, "svix-id", MAX_SVIX_ID_LENGTH);
  if (!SVIX_ID_PATTERN.test(id)) throw new InvalidWebhookIngressError();
  return Object.freeze({
    id,
    timestamp: boundedRequiredHeader(req.headers, "svix-timestamp", MAX_SVIX_TIMESTAMP_LENGTH),
    signature: boundedRequiredHeader(req.headers, "svix-signature", MAX_SVIX_SIGNATURE_LENGTH),
  });
}

async function boundedWebhookText(req: Request) {
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(contentLength) || contentLength.length > 12) {
      cancelUnlockedBody(req.body);
      throw new InvalidWebhookIngressError();
    }
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_WEBHOOK_BYTES) {
      cancelUnlockedBody(req.body);
      throw new InvalidWebhookIngressError();
    }
  }

  if (!req.body) return "";
  const reader = req.body.getReader();
  let cancelStarted = false;
  const cancel = () => {
    if (cancelStarted) return;
    cancelStarted = true;
    nonBlockingCancel(() => reader.cancel());
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      cancel();
      reject(new InvalidWebhookIngressError());
    }, WEBHOOK_READ_TIMEOUT_MS);
  });

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await Promise.race([reader.read(), deadline]);
      } catch {
        cancel();
        throw new InvalidWebhookIngressError();
      }
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) {
        cancel();
        throw new InvalidWebhookIngressError();
      }
      total += chunk.value.byteLength;
      if (total > MAX_WEBHOOK_BYTES) {
        cancel();
        throw new InvalidWebhookIngressError();
      }
      chunks.push(chunk.value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      cancel();
      throw new InvalidWebhookIngressError();
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedOpaqueString(value: unknown, maxLength: number) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.trim() !== value) {
    throw new InvalidWebhookIngressError();
  }
  return value;
}

function boundedDetail(value: unknown) {
  if (typeof value !== "string" || value.length > MAX_DETAIL_INPUT_LENGTH) {
    throw new InvalidWebhookIngressError();
  }
  return value.slice(0, 1_000) || null;
}

function detailFor(type: string, data: Record<string, unknown>) {
  if (type === "email.bounced") {
    if (!isRecord(data.bounce)) throw new InvalidWebhookIngressError();
    return boundedDetail(data.bounce.message);
  }
  if (type === "email.failed") {
    if (!isRecord(data.failed)) throw new InvalidWebhookIngressError();
    return boundedDetail(data.failed.reason);
  }
  if (type === "email.suppressed") {
    if (!isRecord(data.suppressed)) throw new InvalidWebhookIngressError();
    return boundedDetail(data.suppressed.message);
  }
  return null;
}

function verifiedTrackedEvent(value: unknown): VerifiedTrackedEvent | null {
  if (!isRecord(value)) throw new InvalidWebhookIngressError();
  const type = boundedOpaqueString(value.type, MAX_EVENT_TYPE_LENGTH);
  if (!trackedTypes.has(type)) return null;
  if (!isRecord(value.data)) throw new InvalidWebhookIngressError();
  const data = value.data;
  const providerMessageId = boundedOpaqueString(data.email_id, MAX_PROVIDER_MESSAGE_ID_LENGTH);

  if (!Array.isArray(data.to) || data.to.length === 0) throw new InvalidWebhookIngressError();
  const recipient = data.to[0];
  if (typeof recipient !== "string" || recipient.length === 0 || recipient.length > MAX_EMAIL_LENGTH) {
    throw new InvalidWebhookIngressError();
  }
  const normalizedEmail = normalizeEmail(recipient);
  if (normalizedEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(normalizedEmail)) {
    throw new InvalidWebhookIngressError();
  }

  const timestamp = boundedOpaqueString(value.created_at, MAX_TIMESTAMP_LENGTH);
  const occurredAt = new Date(timestamp);
  if (!Number.isFinite(occurredAt.getTime())) throw new InvalidWebhookIngressError();

  let deliveryAttemptId: string | null = null;
  if (data.tags !== undefined) {
    if (!isRecord(data.tags)) throw new InvalidWebhookIngressError();
    const attempt = data.tags.truefantix_outreach_attempt;
    if (attempt !== undefined) {
      if (typeof attempt !== "string" || attempt.length > 36 || !UUID_PATTERN.test(attempt)) {
        throw new InvalidWebhookIngressError();
      }
      deliveryAttemptId = attempt.toLowerCase();
    }
  }

  return Object.freeze({
    type,
    providerMessageId,
    deliveryAttemptId,
    normalizedEmail,
    occurredAt,
    detail: detailFor(type, data),
  });
}

function suppressionReason(type: string) {
  if (type === "email.bounced") return "HARD_BOUNCE";
  if (type === "email.complained") return "SPAM_COMPLAINT";
  if (type === "email.suppressed") return "PROVIDER_SUPPRESSED";
  return null;
}

export function contactUpdateForDeliveryEvent(type: string) {
  return type === "email.bounced"
    ? { engagementStage: "BOUNCED" as const, followUpAt: null }
    : null;
}

export async function POST(req: Request) {
  const secret = process.env.OUTREACH_RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return privateJson({ ok: false, error: "Webhook not configured." }, 503);

  let headers: Readonly<{ id: string; timestamp: string; signature: string }>;
  let payload: string;
  try {
    headers = verifiedHeaders(req);
    payload = await boundedWebhookText(req);
  } catch {
    cancelUnlockedBody(req.body);
    return privateJson({ ok: false, error: "Invalid webhook." }, 400);
  }

  let rawEvent: unknown;
  try {
    rawEvent = new Resend(process.env.OUTREACH_RESEND_API_KEY || "verification-only").webhooks.verify({
      payload,
      headers,
      webhookSecret: secret,
    });
  } catch {
    return privateJson({ ok: false, error: "Invalid webhook." }, 400);
  }

  let event: VerifiedTrackedEvent | null;
  try {
    event = verifiedTrackedEvent(rawEvent);
  } catch {
    return privateJson({ ok: false, error: "Invalid webhook." }, 400);
  }
  if (!event) return privateJson({ ok: true, ignored: true });

  try {
    const result = await recordOutreachDeliveryEvent({
      svixId: headers.id,
      type: event.type,
      providerMessageId: event.providerMessageId,
      deliveryAttemptId: event.deliveryAttemptId,
      normalizedEmail: event.normalizedEmail,
      occurredAt: event.occurredAt,
      detail: event.detail,
      nextStatus: recipientStatuses[event.type],
      suppressionReason: suppressionReason(event.type),
      contactUpdate: contactUpdateForDeliveryEvent(event.type),
    });
    if (result.campaignId) await settleOutreachCampaign(result.campaignId);
    if (result.status === "DUPLICATE") return privateJson({ ok: true, duplicate: true });
    if (result.status === "QUARANTINED") return privateJson({ ok: true, quarantined: true });
    if (result.status === "IGNORED") return privateJson({ ok: true, ignored: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return privateJson({ ok: true, duplicate: true });
    }
    throw error;
  }

  return privateJson({ ok: true });
}
