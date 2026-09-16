import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeEmail, recentContactCutoff } from "@/lib/outreach";
import { lockOutreachEligibility } from "@/lib/outreach-eligibility-lock";

export type ClaimedOutreachRecipient = Readonly<{
  id: string;
  contactId: string;
  emailSnapshot: string;
  subjectSnapshot: string;
  bodyTextSnapshot: string;
  bodyHtmlSnapshot: string | null;
}>;

export type OutreachRecipientClaimResult =
  | Readonly<{ status: "CLAIMED"; recipient: ClaimedOutreachRecipient }>
  | Readonly<{ status: "NOT_CLAIMED" | "SUPPRESSED" | "SKIPPED_RECENT" }>;

export type OutreachCampaignSettlement = Readonly<{
  pending: number;
  sending: number;
  failed: number;
}>;

async function lockRow(
  tx: Prisma.TransactionClient,
  table: "OutreachCampaign" | "OutreachRecipient" | "OutreachContact",
  id: string,
) {
  if (table === "OutreachCampaign") {
    return tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "OutreachCampaign" WHERE "id" = ${id} FOR UPDATE
    `;
  }
  if (table === "OutreachRecipient") {
    return tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "OutreachRecipient" WHERE "id" = ${id} FOR UPDATE
    `;
  }
  return tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "OutreachContact" WHERE "id" = ${id} FOR UPDATE
  `;
}

/**
 * Atomically moves one currently eligible recipient from PENDING to SENDING.
 * Provider work is authorized only by a CLAIMED result returned after commit.
 */
export async function claimOutreachRecipient(
  campaignId: string,
  recipientId: string,
): Promise<OutreachRecipientClaimResult> {
  const candidate = await prisma.outreachRecipient.findUnique({
    where: { id: recipientId },
    select: { campaignId: true, emailSnapshot: true },
  });
  if (!candidate || candidate.campaignId !== campaignId) {
    return Object.freeze({ status: "NOT_CLAIMED" as const });
  }
  const candidateEmail = normalizeEmail(candidate.emailSnapshot);

  return prisma.$transaction(async (tx) => {
    await lockOutreachEligibility(tx, candidateEmail);
    const campaignLock = await lockRow(tx, "OutreachCampaign", campaignId);
    if (!campaignLock.length) return Object.freeze({ status: "NOT_CLAIMED" as const });

    const recipientLock = await lockRow(tx, "OutreachRecipient", recipientId);
    if (!recipientLock.length) return Object.freeze({ status: "NOT_CLAIMED" as const });

    const recipient = await tx.outreachRecipient.findUnique({
      where: { id: recipientId },
      select: {
        id: true,
        campaignId: true,
        contactId: true,
        emailSnapshot: true,
        subjectSnapshot: true,
        bodyTextSnapshot: true,
        bodyHtmlSnapshot: true,
        status: true,
      },
    });
    if (
      !recipient
      || recipient.campaignId !== campaignId
      || recipient.status !== "PENDING"
      || normalizeEmail(recipient.emailSnapshot) !== candidateEmail
    ) {
      return Object.freeze({ status: "NOT_CLAIMED" as const });
    }

    await lockRow(tx, "OutreachContact", recipient.contactId);
    const [campaign, contact] = await Promise.all([
      tx.outreachCampaign.findUnique({
        where: { id: campaignId },
        select: { allowRecentContact: true },
      }),
      tx.outreachContact.findUnique({
        where: { id: recipient.contactId },
        select: { unsubscribedAt: true, lastContactedAt: true },
      }),
    ]);
    if (!campaign || !contact) return Object.freeze({ status: "NOT_CLAIMED" as const });

    const normalizedEmail = normalizeEmail(recipient.emailSnapshot);
    const suppression = normalizedEmail
      ? await tx.outreachSuppression.findUnique({
          where: { normalizedEmail },
          select: { reason: true },
        })
      : null;

    if (!normalizedEmail || suppression || contact.unsubscribedAt) {
      const updated = await tx.outreachRecipient.updateMany({
        where: { id: recipient.id, campaignId, status: "PENDING" },
        data: {
          status: "SUPPRESSED",
          error: suppression?.reason || (contact.unsubscribedAt ? "UNSUBSCRIBED" : "INVALID_EMAIL"),
        },
      });
      return Object.freeze({
        status: updated.count === 1 ? "SUPPRESSED" as const : "NOT_CLAIMED" as const,
      });
    }

    if (
      !campaign.allowRecentContact
      && contact.lastContactedAt
      && contact.lastContactedAt >= recentContactCutoff()
    ) {
      const updated = await tx.outreachRecipient.updateMany({
        where: { id: recipient.id, campaignId, status: "PENDING" },
        data: { status: "SKIPPED_RECENT", error: "CONTACTED_WITHIN_30_DAYS" },
      });
      return Object.freeze({
        status: updated.count === 1 ? "SKIPPED_RECENT" as const : "NOT_CLAIMED" as const,
      });
    }

    const claimed = await tx.outreachRecipient.updateMany({
      where: { id: recipient.id, campaignId, status: "PENDING" },
      data: { status: "SENDING", error: null },
    });
    if (claimed.count !== 1) return Object.freeze({ status: "NOT_CLAIMED" as const });

    return Object.freeze({
      status: "CLAIMED" as const,
      recipient: Object.freeze({
        id: recipient.id,
        contactId: recipient.contactId,
        emailSnapshot: recipient.emailSnapshot,
        subjectSnapshot: recipient.subjectSnapshot,
        bodyTextSnapshot: recipient.bodyTextSnapshot,
        bodyHtmlSnapshot: recipient.bodyHtmlSnapshot,
      }),
    });
  }, { isolationLevel: "ReadCommitted", timeout: 120_000 });
}

export async function settleOutreachCampaign(
  campaignId: string,
): Promise<OutreachCampaignSettlement> {
  return prisma.$transaction(async (tx) => {
    const campaignLock = await lockRow(tx, "OutreachCampaign", campaignId);
    if (!campaignLock.length) return Object.freeze({ pending: 0, sending: 0, failed: 0 });

    const grouped = await tx.outreachRecipient.groupBy({
      by: ["status"],
      where: { campaignId },
      _count: { _all: true },
    });
    const count = (status: string) => grouped.find((row) => row.status === status)?._count._all ?? 0;
    const settlement = Object.freeze({
      pending: count("PENDING"),
      sending: count("SENDING"),
      failed: count("FAILED"),
    });
    const unresolved = settlement.pending + settlement.sending;
    await tx.outreachCampaign.update({
      where: { id: campaignId },
      data: unresolved > 0
        ? { status: "SENDING", completedAt: null }
        : {
            status: settlement.failed > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
            completedAt: new Date(),
          },
    });
    return settlement;
  }, { isolationLevel: "ReadCommitted", timeout: 120_000 });
}
