import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/outreach";

const clean = (value: string | undefined) => value?.trim().replace(/^['"]|['"]$/g, "") || "";
export const gmailReplyMatchingConfigured = () => Boolean(clean(process.env.OUTREACH_GMAIL_CLIENT_ID) && clean(process.env.OUTREACH_GMAIL_CLIENT_SECRET) && clean(process.env.OUTREACH_GMAIL_REFRESH_TOKEN));
const decode = (value = "") => Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const address = (value = "") => normalizeEmail(value.match(/<([^>]+)>/)?.[1] || value);
const normalizedSubject = (value = "") => value.replace(/^\s*((re|fw|fwd):\s*)+/gi, "").trim().toLowerCase();

async function accessToken() {
  const body = new URLSearchParams({ client_id: clean(process.env.OUTREACH_GMAIL_CLIENT_ID), client_secret: clean(process.env.OUTREACH_GMAIL_CLIENT_SECRET), refresh_token: clean(process.env.OUTREACH_GMAIL_REFRESH_TOKEN), grant_type: "refresh_token" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "Gmail authorization failed.");
  return String(data.access_token);
}

function bodyText(payload: any): string | null {
  if (payload?.mimeType === "text/plain" && payload.body?.data) return decode(payload.body.data).slice(0, 100000);
  for (const part of payload?.parts || []) { const found = bodyText(part); if (found) return found; }
  return null;
}

export async function syncGmailOutreachReplies() {
  if (!gmailReplyMatchingConfigured()) throw new Error("Gmail reply matching is not configured.");
  const token = await accessToken();
  const headers = { Authorization: `Bearer ${token}` };
  const mailbox = clean(process.env.OUTREACH_FROM_EMAIL) || "marc@truefantix.com";
  const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=${encodeURIComponent(`newer_than:30d to:${mailbox} -from:${mailbox}`)}`, { headers });
  const listed = await list.json();
  if (!list.ok) throw new Error(listed.error?.message || "Could not read Gmail replies.");
  let matched = 0, ignored = 0, duplicates = 0;
  for (const summary of listed.messages || []) {
    const providerEmailId = `gmail:${summary.id}`;
    if (await prisma.outreachReply.findUnique({ where: { providerEmailId }, select: { id: true } })) { duplicates++; continue; }
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${summary.id}?format=full`, { headers });
    const message = await response.json();
    if (!response.ok) { ignored++; continue; }
    const values = new Map<string, string>((message.payload?.headers || []).map((h: any) => [String(h.name).toLowerCase(), String(h.value)]));
    const fromEmail = address(values.get("from"));
    const receivedAt = new Date(Number(message.internalDate));
    const subject = values.get("subject") || "(No subject)";
    const candidates = await prisma.outreachRecipient.findMany({ where: { contact: { normalizedEmail: fromEmail }, sentAt: { lte: receivedAt } }, orderBy: { sentAt: "desc" }, take: 20 });
    const recipient = candidates.find((x) => normalizedSubject(x.subjectSnapshot) === normalizedSubject(subject)) || candidates[0];
    if (!recipient) { ignored++; continue; }
    try {
      await prisma.$transaction([
        prisma.outreachReply.create({ data: { providerEmailId, providerMessageId: values.get("message-id")?.slice(0, 1000) || null, recipientId: recipient.id, contactId: recipient.contactId, fromEmail, toEmail: address(values.get("to")), subject: subject.slice(0, 1000), textBody: bodyText(message.payload), receivedAt, attachmentCount: 0 } }),
        prisma.outreachRecipient.update({ where: { id: recipient.id }, data: { repliedAt: receivedAt, status: "REPLIED", gmailMessageId: summary.id, gmailThreadId: message.threadId || null } }),
        prisma.outreachContact.update({ where: { id: recipient.contactId }, data: { engagementStage: "REPLIED", followUpAt: null } }),
      ]);
      matched++;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") duplicates++; else throw error;
    }
  }
  return { matched, ignored, duplicates };
}
