export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { Resend, type WebhookEventPayload } from "resend";
import { normalizeEmail } from "@/lib/outreach";
import { recordOutreachDeliveryEvent } from "@/lib/outreach-delivery-event";
import { settleOutreachCampaign } from "@/lib/outreach-send";

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

export function contactUpdateForDeliveryEvent(type: string) {
  return type === "email.bounced"
    ? { engagementStage: "BOUNCED" as const, followUpAt: null }
    : null;
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
  const tags = "tags" in event.data ? event.data.tags : undefined;
  const taggedAttempt = tags?.truefantix_outreach_attempt;
  const deliveryAttemptId = typeof taggedAttempt === "string" && taggedAttempt.length <= 128
    ? taggedAttempt
    : null;
  const email = normalizeEmail(event.data.to[0] || "");
  const reason = suppressionReason(event.type);
  const detail = detailFor(event)?.slice(0, 1000) || null;
  const occurredAt = new Date(event.created_at);

  try {
    const result = await recordOutreachDeliveryEvent({
      svixId,
      type: event.type,
      providerMessageId,
      deliveryAttemptId,
      normalizedEmail: email,
      occurredAt,
      detail,
      nextStatus: recipientStatuses[event.type],
      suppressionReason: reason,
      contactUpdate: contactUpdateForDeliveryEvent(event.type),
    });
    if (result.campaignId) {
      await settleOutreachCampaign(result.campaignId);
    }
    if (result.status === "DUPLICATE") return NextResponse.json({ ok: true, duplicate: true });
    if (result.status === "QUARANTINED") return NextResponse.json({ ok: true, quarantined: true });
    if (result.status === "IGNORED") return NextResponse.json({ ok: true, ignored: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ ok: true, duplicate: true });
    throw error;
  }

  return NextResponse.json({ ok: true });
}
