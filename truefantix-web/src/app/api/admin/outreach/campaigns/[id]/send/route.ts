export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { OutreachEmailRejectedError, sendOutreachEmail } from "@/lib/outreach-email";
import { normalizeEmail, unsubscribeUrl } from "@/lib/outreach";
import {
  outreachHtmlDocument,
  outreachLegalFooterText,
} from "@/lib/outreach-rich-text";
import { auditLog, createAuditContext } from "@/lib/audit";
import { MAX_OUTREACH_CAMPAIGN_CONTACTS } from "@/lib/outreach-config";
import {
  claimOutreachRecipient,
  finalizeOutreachRecipientAcceptance,
  markOutreachRecipientOutcomeUncertain,
  preserveAcceptedOutreachForReconciliation,
  rejectOutreachRecipientAttempt,
  settleOutreachCampaign,
} from "@/lib/outreach-send";

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
    return NextResponse.json({
      ok: true,
      sent: 0,
      failed: 0,
      reconciliationRequired: settlement.reconciliationRequired,
      remaining: settlement.pending + settlement.sending + settlement.reconciliationRequired,
    });
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
    failed = 0,
    reconciliationRequired = 0;
  for (const candidate of recipients) {
    const claim = await claimOutreachRecipient(id, candidate.id);
    if (claim.status !== "CLAIMED") continue;
    const recipient = claim.recipient;
    const email = normalizeEmail(recipient.emailSnapshot);
    const identity = Object.freeze({
      recipientId: recipient.id,
      contactId: recipient.contactId,
      normalizedEmail: email,
      deliveryAttemptId: recipient.deliveryAttemptId,
    });
    let result: Awaited<ReturnType<typeof sendOutreachEmail>>;
    try {
      const optOutUrl = unsubscribeUrl(email);
      result = await sendOutreachEmail({
        to: recipient.emailSnapshot,
        subject: recipient.subjectSnapshot,
        text: `${recipient.bodyTextSnapshot}\n\n${outreachLegalFooterText}\nUnsubscribe: ${optOutUrl}`,
        html: recipient.bodyHtmlSnapshot
          ? outreachHtmlDocument(recipient.bodyHtmlSnapshot, optOutUrl)
          : undefined,
        unsubscribeUrl: optOutUrl,
        idempotencyKey: recipient.deliveryAttemptId,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Outreach provider outcome is unknown.";
      if (error instanceof OutreachEmailRejectedError) {
        const rejection = await rejectOutreachRecipientAttempt(identity, message);
        if (rejection === "ALREADY_RESOLVED") sent++;
        else if (rejection === "FAILED") failed++;
        else reconciliationRequired++;
      } else {
        const uncertain = await markOutreachRecipientOutcomeUncertain(identity, message);
        if (uncertain === "ALREADY_RESOLVED") sent++;
        else reconciliationRequired++;
      }
      continue;
    }
    try {
      await finalizeOutreachRecipientAcceptance(identity, result.messageId);
      sent++;
    } catch (error) {
      const message = error instanceof Error
        ? `Provider acceptance requires reconciliation: ${error.message}`.slice(0, 500)
        : "Provider acceptance requires reconciliation.";
      try {
        const preserved = await preserveAcceptedOutreachForReconciliation(
          identity,
          result.messageId,
          message,
        );
        if (preserved === "ALREADY_RESOLVED") {
          sent++;
          continue;
        }
      } catch {
        // The committed SENDING claim remains irreversible and cannot be selected
        // for another provider dispatch even if this evidence write also fails.
      }
      reconciliationRequired++;
    }
  }
  const settlement = await settleOutreachCampaign(id);
  const remaining = settlement.pending + settlement.sending + settlement.reconciliationRequired;
  await auditLog({
    action: "ADMIN_OUTREACH_SEND",
    userId: gate.user.id,
    targetType: "OutreachCampaign",
    targetId: id,
    metadata: { sent, failed, reconciliationRequired, remaining },
    ...createAuditContext(req),
  });
  return NextResponse.json({ ok: true, sent, failed, reconciliationRequired, remaining });
}
