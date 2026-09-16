import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { defaultOutreachFollowUpAt, normalizeEmail, recentContactCutoff } from "@/lib/outreach";
import { lockOutreachEligibility } from "@/lib/outreach-eligibility-lock";
import { lockOutreachProviderMessage } from "@/lib/outreach-delivery-event";

export type ClaimedOutreachRecipient = Readonly<{
  id: string;
  contactId: string;
  emailSnapshot: string;
  subjectSnapshot: string;
  bodyTextSnapshot: string;
  bodyHtmlSnapshot: string | null;
  deliveryAttemptId: string;
}>;

export type OutreachRecipientClaimResult =
  | Readonly<{ status: "CLAIMED"; recipient: ClaimedOutreachRecipient }>
  | Readonly<{ status: "NOT_CLAIMED" | "SUPPRESSED" | "SKIPPED_RECENT" }>;

export type OutreachCampaignSettlement = Readonly<{
  pending: number;
  sending: number;
  reconciliationRequired: number;
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

    const deliveryAttemptId = randomUUID();
    const claimed = await tx.outreachRecipient.updateMany({
      where: { id: recipient.id, campaignId, status: "PENDING" },
      data: {
        status: "SENDING",
        deliveryAttemptId,
        providerResult: "RESEND_ATTEMPTING",
        error: null,
      },
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
        deliveryAttemptId,
      }),
    });
  }, { isolationLevel: "ReadCommitted", timeout: 120_000 });
}

type ClaimedAttemptIdentity = Readonly<{
  recipientId: string;
  contactId: string;
  normalizedEmail: string;
  deliveryAttemptId: string;
}>;

async function lockClaimedAttempt(
  tx: Prisma.TransactionClient,
  identity: ClaimedAttemptIdentity,
) {
  await lockOutreachEligibility(tx, identity.normalizedEmail);
  await tx.$queryRaw`
    SELECT "id" FROM "OutreachRecipient" WHERE "id" = ${identity.recipientId} FOR UPDATE
  `;
  const recipient = await tx.outreachRecipient.findUnique({
    where: { id: identity.recipientId },
    select: {
      id: true,
      campaignId: true,
      contactId: true,
      emailSnapshot: true,
      deliveryAttemptId: true,
      providerMessageId: true,
      status: true,
    },
  });
  if (
    !recipient
    || recipient.contactId !== identity.contactId
    || recipient.deliveryAttemptId !== identity.deliveryAttemptId
    || normalizeEmail(recipient.emailSnapshot) !== identity.normalizedEmail
  ) {
    throw new Error("Outreach delivery attempt identity changed.");
  }
  return recipient;
}

export async function rejectOutreachRecipientAttempt(
  identity: ClaimedAttemptIdentity,
  error: string,
) {
  return prisma.$transaction(async (tx) => {
    const recipient = await lockClaimedAttempt(tx, identity);
    if (recipient.providerMessageId && !["SENDING", "RECONCILIATION_REQUIRED"].includes(recipient.status)) {
      return "ALREADY_RESOLVED" as const;
    }
    if (recipient.status !== "SENDING" || recipient.providerMessageId) return "IDENTITY_CHANGED" as const;
    await tx.outreachRecipient.update({
      where: { id: recipient.id },
      data: { status: "FAILED", providerResult: "RESEND_REJECTED", error },
    });
    return "FAILED" as const;
  });
}

export async function markOutreachRecipientOutcomeUncertain(
  identity: ClaimedAttemptIdentity,
  error: string,
) {
  const contactedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const recipient = await lockClaimedAttempt(tx, identity);
    if (recipient.providerMessageId && !["SENDING", "RECONCILIATION_REQUIRED"].includes(recipient.status)) {
      return "ALREADY_RESOLVED" as const;
    }
    if (recipient.status !== "SENDING" || recipient.providerMessageId) return "IDENTITY_CHANGED" as const;
    await tx.outreachRecipient.update({
      where: { id: recipient.id },
      data: {
        status: "RECONCILIATION_REQUIRED",
        providerResult: "RESEND_OUTCOME_UNCERTAIN",
        error,
      },
    });
    await tx.outreachContact.update({
      where: { id: recipient.contactId },
      data: {
        lastContactedAt: contactedAt,
        followUpAt: null,
        engagementStage: "CONTACTED",
      },
    });
    return "RECONCILIATION_REQUIRED" as const;
  });
}

export async function finalizeOutreachRecipientAcceptance(
  identity: ClaimedAttemptIdentity,
  providerMessageId: string,
) {
  const sentAt = new Date();
  return prisma.$transaction(async (tx) => {
    await lockOutreachProviderMessage(tx, providerMessageId);
    const recipient = await lockClaimedAttempt(tx, identity);
    if (
      recipient.providerMessageId === providerMessageId
      && !["SENDING", "RECONCILIATION_REQUIRED"].includes(recipient.status)
    ) {
      return "ALREADY_RESOLVED" as const;
    }
    if (
      recipient.status !== "SENDING"
      || (recipient.providerMessageId && recipient.providerMessageId !== providerMessageId)
    ) {
      throw new Error("Outreach delivery attempt cannot be finalized.");
    }
    await tx.outreachRecipient.update({
      where: { id: recipient.id },
      data: {
        status: "SENT",
        sentAt,
        providerMessageId,
        providerResult: "RESEND_ACCEPTED",
        error: null,
      },
    });
    await tx.outreachContact.update({
      where: { id: recipient.contactId },
      data: {
        lastContactedAt: sentAt,
        followUpAt: defaultOutreachFollowUpAt(sentAt),
        engagementStage: "CONTACTED",
      },
    });
    return "SENT" as const;
  });
}

export async function preserveAcceptedOutreachForReconciliation(
  identity: ClaimedAttemptIdentity,
  providerMessageId: string,
  error: string,
) {
  const acceptedAt = new Date();
  return prisma.$transaction(async (tx) => {
    await lockOutreachProviderMessage(tx, providerMessageId);
    const recipient = await lockClaimedAttempt(tx, identity);
    if (recipient.providerMessageId && recipient.providerMessageId !== providerMessageId) {
      throw new Error("Outreach provider message identity changed.");
    }
    if (
      recipient.providerMessageId === providerMessageId
      && !["SENDING", "RECONCILIATION_REQUIRED"].includes(recipient.status)
    ) {
      return "ALREADY_RESOLVED" as const;
    }
    if (!["SENDING", "RECONCILIATION_REQUIRED"].includes(recipient.status)) {
      return "IDENTITY_CHANGED" as const;
    }
    await tx.outreachRecipient.update({
      where: { id: recipient.id },
      data: {
        status: "RECONCILIATION_REQUIRED",
        sentAt: acceptedAt,
        providerMessageId,
        providerResult: "RESEND_ACCEPTED_RECONCILIATION_REQUIRED",
        error,
      },
    });
    await tx.outreachContact.update({
      where: { id: recipient.contactId },
      data: {
        lastContactedAt: acceptedAt,
        followUpAt: null,
        engagementStage: "CONTACTED",
      },
    });
    return "RECONCILIATION_REQUIRED" as const;
  });
}

export async function settleOutreachCampaign(
  campaignId: string,
): Promise<OutreachCampaignSettlement> {
  return prisma.$transaction(async (tx) => {
    const campaignLock = await lockRow(tx, "OutreachCampaign", campaignId);
    if (!campaignLock.length) return Object.freeze({ pending: 0, sending: 0, reconciliationRequired: 0, failed: 0 });

    const grouped = await tx.outreachRecipient.groupBy({
      by: ["status"],
      where: { campaignId },
      _count: { _all: true },
    });
    const count = (status: string) => grouped.find((row) => row.status === status)?._count._all ?? 0;
    const settlement = Object.freeze({
      pending: count("PENDING"),
      sending: count("SENDING"),
      reconciliationRequired: count("RECONCILIATION_REQUIRED"),
      failed: count("FAILED"),
    });
    const unresolved = settlement.pending + settlement.sending + settlement.reconciliationRequired;
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
