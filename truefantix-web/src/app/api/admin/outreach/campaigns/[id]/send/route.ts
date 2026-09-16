export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { sendOutreachEmail } from "@/lib/outreach-email";
import { defaultOutreachFollowUpAt, normalizeEmail, unsubscribeUrl } from "@/lib/outreach";
import {
  outreachHtmlDocument,
  outreachLegalFooterText,
} from "@/lib/outreach-rich-text";
import { auditLog, createAuditContext } from "@/lib/audit";
import { MAX_OUTREACH_CAMPAIGN_CONTACTS } from "@/lib/outreach-config";
import { claimOutreachRecipient, settleOutreachCampaign } from "@/lib/outreach-send";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id },
    select: { id: true, name: true, status: true },
  });
  if (!campaign)
    return NextResponse.json(
      { ok: false, error: "Campaign not found." },
      { status: 404 },
    );
  if (String(body?.confirmation || "") !== campaign.name)
    return NextResponse.json(
      { ok: false, error: "Type the exact campaign name to confirm sending." },
      { status: 400 },
    );
  const limit = Math.min(
    MAX_OUTREACH_CAMPAIGN_CONTACTS,
    Math.max(
      1,
      Number(body?.limit) || MAX_OUTREACH_CAMPAIGN_CONTACTS,
    ),
  );
  const recipients = await prisma.outreachRecipient.findMany({
    where: { campaignId: id, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  if (!recipients.length) {
    const settlement = await settleOutreachCampaign(id);
    return NextResponse.json({ ok: true, sent: 0, failed: 0, remaining: settlement.pending });
  }
  await prisma.outreachCampaign.update({
    where: { id },
    data: {
      status: "SENDING",
      startedAt: campaign.status === "DRAFT" ? new Date() : undefined,
      approvedAt: campaign.status === "DRAFT" ? new Date() : undefined,
    },
  });
  let sent = 0,
    failed = 0;
  for (const candidate of recipients) {
    const claim = await claimOutreachRecipient(id, candidate.id);
    if (claim.status !== "CLAIMED") continue;
    const recipient = claim.recipient;
    const email = normalizeEmail(recipient.emailSnapshot);
    try {
      const optOutUrl = unsubscribeUrl(email);
      const result = await sendOutreachEmail({
        to: recipient.emailSnapshot,
        subject: recipient.subjectSnapshot,
        text: `${recipient.bodyTextSnapshot}\n\n${outreachLegalFooterText}\nUnsubscribe: ${optOutUrl}`,
        html: recipient.bodyHtmlSnapshot
          ? outreachHtmlDocument(recipient.bodyHtmlSnapshot, optOutUrl)
          : undefined,
        unsubscribeUrl: optOutUrl,
      });
      const sentAt = new Date();
      await prisma.$transaction([
        prisma.outreachRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "SENT",
            sentAt,
            providerMessageId: result.messageId,
            providerResult: `${result.provider}_ACCEPTED`,
          },
        }),
        prisma.outreachContact.update({
          where: { id: recipient.contactId },
          data: {
            lastContactedAt: sentAt,
            followUpAt: defaultOutreachFollowUpAt(sentAt),
            engagementStage: "CONTACTED",
          },
        }),
      ]);
      sent++;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Gmail send failed.";
      await prisma.outreachRecipient.update({
        where: { id: recipient.id },
        data: { status: "FAILED", error: message },
      });
      failed++;
    }
  }
  const settlement = await settleOutreachCampaign(id);
  const remaining = settlement.pending;
  await auditLog({
    action: "ADMIN_OUTREACH_SEND",
    userId: gate.user.id,
    targetType: "OutreachCampaign",
    targetId: id,
    metadata: { sent, failed, remaining },
    ...createAuditContext(req),
  });
  return NextResponse.json({ ok: true, sent, failed, remaining });
}
