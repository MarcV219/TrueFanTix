export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { Prisma, type OutreachRecipient } from "@prisma/client";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { retrieveOutreachReplyEmail } from "@/lib/outreach-reply-email";
import {
  buildOutreachReplyForwardIntent,
  drainOutreachReplyForwardIntents,
  outreachReplyForwardingConfig,
} from "@/lib/outreach-reply-forwarding";
import {
  boundedOutreachWebhookText,
  cancelUnlockedWebhookBody,
  verifiedOutreachWebhookHeaders,
} from "@/lib/outreach-webhook-ingress";

const replyPattern = /^reply\+([a-z0-9]{1,64})@/i;
const MAX_EVENT_TYPE_LENGTH = 64;
const MAX_PROVIDER_EMAIL_ID_LENGTH = 256;
const MAX_PROVIDER_MESSAGE_ID_LENGTH = 512;
const MAX_ADDRESS_INPUT_LENGTH = 1_000;
const MAX_RECIPIENT_ADDRESSES = 20;
const MAX_TIMESTAMP_LENGTH = 64;
const mailbox = (value: string) => value.match(/<([^>]+)>/)?.[1]?.trim().toLowerCase() || value.trim().toLowerCase();

class InvalidReplyWebhookError extends Error {}

type VerifiedReplyEvent = Readonly<{
  emailId: string;
  messageId: string | null;
  from: string;
  to: readonly string[];
  receivedAt: Date;
}>;

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || value.trim() !== value
  ) {
    throw new InvalidReplyWebhookError();
  }
  return value;
}

function verifiedReplyEvent(value: unknown): VerifiedReplyEvent | null {
  if (!isRecord(value)) throw new InvalidReplyWebhookError();
  const type = boundedString(value.type, MAX_EVENT_TYPE_LENGTH);
  if (type !== "email.received") return null;
  if (!isRecord(value.data)) throw new InvalidReplyWebhookError();
  const data = value.data;
  if (
    !Array.isArray(data.to)
    || data.to.length === 0
    || data.to.length > MAX_RECIPIENT_ADDRESSES
  ) {
    throw new InvalidReplyWebhookError();
  }
  const to = data.to.map((address) => boundedString(address, MAX_ADDRESS_INPUT_LENGTH));
  const messageId = data.message_id === undefined || data.message_id === null
    ? null
    : boundedString(data.message_id, MAX_PROVIDER_MESSAGE_ID_LENGTH);
  const timestamp = boundedString(
    data.created_at ?? value.created_at,
    MAX_TIMESTAMP_LENGTH,
  );
  const receivedAt = new Date(timestamp);
  if (!Number.isFinite(receivedAt.getTime())) throw new InvalidReplyWebhookError();
  return Object.freeze({
    emailId: boundedString(data.email_id, MAX_PROVIDER_EMAIL_ID_LENGTH),
    messageId,
    from: boundedString(data.from, MAX_ADDRESS_INPUT_LENGTH),
    to: Object.freeze(to),
    receivedAt,
  });
}

async function matchingRecipient(addresses: string[]): Promise<OutreachRecipient | null> {
  for (const address of addresses) {
    const token = mailbox(address).match(replyPattern)?.[1];
    if (token) {
      const recipient = await prisma.outreachRecipient.findUnique({ where: { replyToken: token } });
      if (recipient) return recipient;
    }
  }
  return null;
}

export async function POST(req: Request) {
  const secret = process.env.OUTREACH_RESEND_INBOUND_WEBHOOK_SECRET?.trim();
  const apiKey = process.env.OUTREACH_RESEND_INBOUND_API_KEY?.trim();
  if (!secret || !apiKey) {
    return privateJson({ ok: false, error: "Reply capture is not configured." }, 503);
  }

  let headers: Readonly<{ id: string; timestamp: string; signature: string }>;
  let payload: string;
  try {
    headers = verifiedOutreachWebhookHeaders(req);
    payload = await boundedOutreachWebhookText(req);
  } catch {
    cancelUnlockedWebhookBody(req.body);
    return privateJson({ ok: false, error: "Invalid webhook." }, 400);
  }

  let rawEvent: unknown;
  try {
    rawEvent = new Resend(apiKey).webhooks.verify({
      payload,
      headers,
      webhookSecret: secret,
    });
  } catch {
    return privateJson({ ok: false, error: "Invalid webhook." }, 400);
  }

  let event: VerifiedReplyEvent | null;
  try {
    event = verifiedReplyEvent(rawEvent);
  } catch {
    return privateJson({ ok: false, error: "Invalid webhook." }, 400);
  }
  if (!event) return privateJson({ ok: true, ignored: true });
  const recipient = await matchingRecipient([...event.to]);
  if (!recipient) return privateJson({ ok: true, ignored: true });

  let received: Awaited<ReturnType<typeof retrieveOutreachReplyEmail>>;
  try {
    received = await retrieveOutreachReplyEmail(event.emailId, apiKey);
  } catch {
    return privateJson({ ok: false, error: "Could not retrieve received email." }, 502);
  }

  const toEmail = event.to.map(mailbox).find(address => replyPattern.test(address)) || mailbox(event.to[0] || "");
  const forwardConfig = outreachReplyForwardingConfig();
  const forwardIntent = forwardConfig
    ? buildOutreachReplyForwardIntent({
        providerEmailId: event.emailId,
        fromEmail: mailbox(event.from),
        subject: received.subject,
        textBody: received.text,
        htmlBody: received.html,
        attachmentCount: received.attachmentCount,
        receivedAt: event.receivedAt,
      }, forwardConfig)
    : null;
  let duplicate = false;
  try {
    await prisma.$transaction([
      prisma.outreachReply.create({ data: {
        providerEmailId: event.emailId,
        providerMessageId: event.messageId,
        recipientId: recipient.id,
        contactId: recipient.contactId,
        fromEmail: mailbox(event.from),
        toEmail,
        subject: received.subject || "(No subject)",
        textBody: received.text,
        htmlBody: received.html,
        receivedAt: event.receivedAt,
        attachmentCount: received.attachmentCount,
        ...(forwardIntent ? { forwardIntent: { create: forwardIntent } } : {}),
      } }),
      prisma.outreachRecipient.update({ where: { id: recipient.id }, data: { repliedAt: event.receivedAt, status: "REPLIED" } }),
      prisma.outreachContact.update({ where: { id: recipient.contactId }, data: { engagementStage: "REPLIED", followUpAt: null } }),
    ]);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      duplicate = true;
    } else {
      throw error;
    }
  }

  if (forwardConfig) {
    await drainOutreachReplyForwardIntents({
      providerEmailId: event.emailId,
      limit: 1,
    }).catch(() => undefined);
  }

  return privateJson({ ok: true, ...(duplicate ? { duplicate: true } : {}) });
}
