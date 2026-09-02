export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { Resend, type WebhookEventPayload } from "resend";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/outreach";

const trackedTypes = new Set([
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
]);

const recipientStatuses: Record<string, string> = {
  "email.sent": "SENT",
  "email.delivered": "DELIVERED",
  "email.delivery_delayed": "DELIVERY_DELAYED",
  "email.bounced": "BOUNCED",
  "email.complained": "COMPLAINED",
  "email.failed": "FAILED",
  "email.suppressed": "SUPPRESSED",
};
const statusPriority: Record<string, number> = { PENDING: 0, SENDING: 0, SENT: 1, DELIVERY_DELAYED: 2, DELIVERED: 3, FAILED: 3, BOUNCED: 4, SUPPRESSED: 4, COMPLAINED: 5 };

function detailFor(event: WebhookEventPayload) {
  if (event.type === "email.bounced") return event.data.bounce.message;
  if (event.type === "email.failed") return event.data.failed.reason;
  if (event.type === "email.suppressed") return event.data.suppressed.message;
  return null;
}

function suppressionReason(type: string) {
  if (type === "email.bounced") return "HARD_BOUNCE";
  if (type === "email.complained") return "SPAM_COMPLAINT";
  if (type === "email.suppressed") return "PROVIDER_SUPPRESSED";
  return null;
}

export async function POST(req: Request) {
  const secret = process.env.OUTREACH_RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "Webhook not configured." }, { status: 503 });

  const payload = await req.text();
  let event: WebhookEventPayload;
  try {
    event = new Resend(process.env.OUTREACH_RESEND_API_KEY || "verification-only").webhooks.verify({
      payload,
      headers: {
        id: req.headers.get("svix-id") || "",
        timestamp: req.headers.get("svix-timestamp") || "",
        signature: req.headers.get("svix-signature") || "",
      },
      webhookSecret: secret,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature." }, { status: 400 });
  }

  if (!trackedTypes.has(event.type) || !("email_id" in event.data)) return NextResponse.json({ ok: true, ignored: true });
  const svixId = req.headers.get("svix-id")!;
  const providerMessageId = event.data.email_id;
  const recipient = await prisma.outreachRecipient.findFirst({ where: { providerMessageId }, select: { id: true, emailSnapshot: true, status: true } });
  // The Resend account also sends transactional mail. Ignore events that do not
  // match a message sent by the isolated Outreach system.
  if (!recipient) return NextResponse.json({ ok: true, ignored: true });

  const email = normalizeEmail(event.data.to[0] || recipient.emailSnapshot);
  const reason = suppressionReason(event.type);
  const detail = detailFor(event)?.slice(0, 1000) || null;
  const occurredAt = new Date(event.created_at);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.outreachEmailEvent.create({ data: { svixId, type: event.type, providerMessageId, recipientId: recipient.id, email, occurredAt, detail } });
      const nextStatus = recipientStatuses[event.type];
      if ((statusPriority[nextStatus] || 0) >= (statusPriority[recipient.status] || 0)) {
        await tx.outreachRecipient.update({ where: { id: recipient.id }, data: { status: nextStatus, error: detail } });
      }
      if (reason) {
        await tx.outreachSuppression.upsert({
          where: { normalizedEmail: email },
          create: { normalizedEmail: email, email, reason, source: "RESEND_WEBHOOK", notes: detail },
          update: { reason, source: "RESEND_WEBHOOK", notes: detail },
        });
        await tx.outreachRecipient.updateMany({ where: { emailSnapshot: { equals: email, mode: "insensitive" }, status: "PENDING" }, data: { status: "SUPPRESSED", error: reason } });
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ ok: true, duplicate: true });
    throw error;
  }

  return NextResponse.json({ ok: true });
}
