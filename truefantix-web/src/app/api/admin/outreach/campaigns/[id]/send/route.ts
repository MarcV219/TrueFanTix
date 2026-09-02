export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { sendGmail } from "@/lib/integrations/gmail";
import { normalizeEmail, unsubscribeUrl } from "@/lib/outreach";
import { auditLog, createAuditContext } from "@/lib/audit";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res; const { id } = await context.params; const body = await req.json().catch(() => null);
  const campaign = await prisma.outreachCampaign.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  if (!campaign) return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
  if (String(body?.confirmation || "") !== campaign.name) return NextResponse.json({ ok: false, error: "Type the exact campaign name to confirm sending." }, { status: 400 });
  const limit = Math.min(10, Math.max(1, Number(body?.limit) || 10));
  const recipients = await prisma.outreachRecipient.findMany({ where: { campaignId: id, status: "PENDING" }, orderBy: { createdAt: "asc" }, take: limit, include: { contact: true } });
  if (!recipients.length) return NextResponse.json({ ok: true, sent: 0, failed: 0, remaining: 0 });
  await prisma.outreachCampaign.update({ where: { id }, data: { status: "SENDING", startedAt: campaign.status === "DRAFT" ? new Date() : undefined, approvedAt: campaign.status === "DRAFT" ? new Date() : undefined } });
  let sent = 0, failed = 0;
  for (const recipient of recipients) {
    const email = normalizeEmail(recipient.emailSnapshot);
    const suppression = await prisma.outreachSuppression.findUnique({ where: { normalizedEmail: email }, select: { reason: true } });
    if (suppression || recipient.contact.unsubscribedAt) { await prisma.outreachRecipient.update({ where: { id: recipient.id }, data: { status: "SUPPRESSED", error: suppression?.reason || "UNSUBSCRIBED" } }); continue; }
    await prisma.outreachRecipient.update({ where: { id: recipient.id }, data: { status: "SENDING", error: null } });
    try {
      const result = await sendGmail(gate.user.id, { to: recipient.emailSnapshot, subject: recipient.subjectSnapshot, text: `${recipient.bodyTextSnapshot}\n\nTrueFanTix Inc.\nToronto, Ontario, Canada\nUnsubscribe: ${unsubscribeUrl(email)}`, unsubscribeUrl: unsubscribeUrl(email) });
      await prisma.$transaction([prisma.outreachRecipient.update({ where: { id: recipient.id }, data: { status: "SENT", sentAt: new Date(), gmailMessageId: result.id, gmailThreadId: result.threadId, providerResult: "GMAIL_ACCEPTED" } }), prisma.outreachContact.update({ where: { id: recipient.contactId }, data: { lastContactedAt: new Date() } })]); sent++;
    } catch (error) { const message = error instanceof Error ? error.message.slice(0, 500) : "Gmail send failed."; await prisma.outreachRecipient.update({ where: { id: recipient.id }, data: { status: "FAILED", error: message } }); failed++; }
  }
  const remaining = await prisma.outreachRecipient.count({ where: { campaignId: id, status: "PENDING" } });
  if (!remaining) await prisma.outreachCampaign.update({ where: { id }, data: { status: failed ? "COMPLETED_WITH_ERRORS" : "COMPLETED", completedAt: new Date() } });
  await auditLog({ action: "ADMIN_OUTREACH_SEND", userId: gate.user.id, targetType: "OutreachCampaign", targetId: id, metadata: { sent, failed, remaining }, ...createAuditContext(req) });
  return NextResponse.json({ ok: true, sent, failed, remaining });
}
