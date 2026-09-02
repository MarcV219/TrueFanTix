export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { Prisma, type OutreachRecipient } from "@prisma/client";
import { Resend, type WebhookEventPayload } from "resend";
import { prisma } from "@/lib/prisma";

const replyPattern = /^reply\+([a-z0-9]+)@/i;
const limited = (value: string | null | undefined, max: number) => value ? value.slice(0, max) : null;
const mailbox = (value: string) => value.match(/<([^>]+)>/)?.[1]?.trim().toLowerCase() || value.trim().toLowerCase();

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
  if (!secret || !apiKey) return NextResponse.json({ ok: false, error: "Reply capture is not configured." }, { status: 503 });

  const payload = await req.text();
  let event: WebhookEventPayload;
  try {
    event = new Resend(apiKey).webhooks.verify({
      payload,
      headers: { id: req.headers.get("svix-id") || "", timestamp: req.headers.get("svix-timestamp") || "", signature: req.headers.get("svix-signature") || "" },
      webhookSecret: secret,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid webhook signature." }, { status: 400 });
  }

  if (event.type !== "email.received") return NextResponse.json({ ok: true, ignored: true });
  const recipient = await matchingRecipient(event.data.to);
  if (!recipient) return NextResponse.json({ ok: true, ignored: true });

  const resend = new Resend(apiKey);
  const received = await resend.emails.receiving.get(event.data.email_id);
  if (received.error || !received.data) return NextResponse.json({ ok: false, error: "Could not retrieve received email." }, { status: 502 });

  const toEmail = event.data.to.map(mailbox).find(address => replyPattern.test(address)) || mailbox(event.data.to[0] || "");
  const receivedAt = new Date(event.data.created_at || event.created_at);
  try {
    await prisma.$transaction([
      prisma.outreachReply.create({ data: {
        providerEmailId: event.data.email_id,
        providerMessageId: event.data.message_id || null,
        recipientId: recipient.id,
        contactId: recipient.contactId,
        fromEmail: mailbox(event.data.from),
        toEmail,
        subject: limited(received.data.subject, 1000) || "(No subject)",
        textBody: limited(received.data.text, 100000),
        htmlBody: limited(received.data.html, 250000),
        receivedAt,
        attachmentCount: received.data.attachments.length,
      } }),
      prisma.outreachRecipient.update({ where: { id: recipient.id }, data: { repliedAt: receivedAt, status: "REPLIED" } }),
      prisma.outreachContact.update({ where: { id: recipient.contactId }, data: { engagementStage: "REPLIED", followUpAt: null } }),
    ]);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ ok: true, duplicate: true });
    throw error;
  }

  const forwardTo = process.env.OUTREACH_REPLY_FORWARD_TO?.trim();
  if (forwardTo) {
    const forwarded = await resend.emails.receiving.forward({ emailId: event.data.email_id, to: forwardTo, from: process.env.OUTREACH_FROM_EMAIL || "marc@truefantix.com", passthrough: true });
    if (!forwarded.error) await prisma.outreachReply.update({ where: { providerEmailId: event.data.email_id }, data: { forwardedAt: new Date() } });
  }

  return NextResponse.json({ ok: true });
}
