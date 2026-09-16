import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { defaultOutreachFollowUpAt, normalizeEmail } from "@/lib/outreach";
import { lockOutreachEligibility } from "@/lib/outreach-eligibility-lock";

const statusPriority: Readonly<Record<string, number>> = Object.freeze({
  PENDING: 0,
  SENDING: 0,
  RECONCILIATION_REQUIRED: 0,
  SENT: 1,
  DELIVERY_DELAYED: 2,
  DELIVERED: 3,
  FAILED: 3,
  BOUNCED: 4,
  SUPPRESSED: 4,
  COMPLAINED: 5,
});

const QUARANTINE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CANONICAL_SVIX_ID = /^[A-Za-z0-9_-]{1,256}$/;

export type OutreachDeliveryEventInput = Readonly<{
  svixId: string;
  type: string;
  providerMessageId: string;
  deliveryAttemptId: string | null;
  normalizedEmail: string;
  occurredAt: Date;
  detail: string | null;
  nextStatus: string;
  suppressionReason: string | null;
  contactUpdate: Readonly<{ engagementStage: "BOUNCED"; followUpAt: null }> | null;
}>;

type LockedRecipient = Readonly<{
  id: string;
  campaignId: string;
  contactId: string;
  emailSnapshot: string;
  deliveryAttemptId: string | null;
  providerMessageId: string | null;
  status: string;
  deliveryStatusPriority: number | null;
  deliveryStatusOccurredAt: Date | null;
  deliveryStatusSvixId: string | null;
}>;

function shouldSelectDeliveryStatus(
  recipient: LockedRecipient,
  input: OutreachDeliveryEventInput,
) {
  const incomingPriority = statusPriority[input.nextStatus] ?? 0;
  if (
    recipient.deliveryStatusPriority === null
    || recipient.deliveryStatusOccurredAt === null
    || recipient.deliveryStatusSvixId === null
  ) {
    return incomingPriority > (statusPriority[recipient.status] ?? 0);
  }
  if (incomingPriority !== recipient.deliveryStatusPriority) {
    return incomingPriority > recipient.deliveryStatusPriority;
  }
  const occurredComparison = input.occurredAt.getTime()
    - recipient.deliveryStatusOccurredAt.getTime();
  if (occurredComparison !== 0) return occurredComparison > 0;
  return input.svixId > recipient.deliveryStatusSvixId;
}

export async function lockOutreachProviderMessage(
  tx: Prisma.TransactionClient,
  providerMessageId: string,
) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`outreach-provider:${providerMessageId}`}, 0)
    )
  `;
}

async function quarantineDeliveryEvent(
  tx: Prisma.TransactionClient,
  input: OutreachDeliveryEventInput,
  reason: string,
) {
  await tx.outreachEmailEventTombstone.create({
    data: { svixId: input.svixId },
  });
  await tx.outreachQuarantinedEmailEvent.create({
    data: {
      svixId: input.svixId,
      type: input.type,
      providerMessageId: input.providerMessageId,
      deliveryAttemptId: input.deliveryAttemptId,
      email: input.normalizedEmail,
      occurredAt: input.occurredAt,
      detail: input.detail,
      reason,
      deleteAfter: new Date(Date.now() + QUARANTINE_RETENTION_MS),
    },
  });
}

async function applyDeliveryEvent(
  tx: Prisma.TransactionClient,
  recipient: LockedRecipient,
  input: OutreachDeliveryEventInput,
) {
  await tx.outreachEmailEvent.create({
    data: {
      svixId: input.svixId,
      type: input.type,
      providerMessageId: input.providerMessageId,
      recipientId: recipient.id,
      email: input.normalizedEmail,
      occurredAt: input.occurredAt,
      detail: input.detail,
    },
  });
  if (shouldSelectDeliveryStatus(recipient, input)) {
    await tx.outreachRecipient.update({
      where: { id: recipient.id },
      data: {
        status: input.nextStatus,
        error: input.detail,
        deliveryStatusPriority: statusPriority[input.nextStatus] ?? 0,
        deliveryStatusOccurredAt: input.occurredAt,
        deliveryStatusSvixId: input.svixId,
      },
    });
  }
  if (input.contactUpdate) {
    await tx.outreachContact.update({
      where: { id: recipient.contactId },
      data: input.contactUpdate,
    });
  }
  if (input.suppressionReason) {
    await tx.outreachSuppression.upsert({
      where: { normalizedEmail: input.normalizedEmail },
      create: {
        normalizedEmail: input.normalizedEmail,
        email: input.normalizedEmail,
        reason: input.suppressionReason,
        source: "RESEND_WEBHOOK",
        notes: input.detail,
      },
      update: {
        reason: input.suppressionReason,
        source: "RESEND_WEBHOOK",
        notes: input.detail,
      },
    });
    await tx.outreachRecipient.updateMany({
      where: {
        emailSnapshot: { equals: input.normalizedEmail, mode: "insensitive" },
        status: "PENDING",
      },
      data: { status: "SUPPRESSED", error: input.suppressionReason },
    });
  }
}

export async function recordOutreachDeliveryEvent(input: OutreachDeliveryEventInput) {
  // Printable canonical ASCII makes JavaScript code-unit ordering identical to
  // PostgreSQL's bytewise C collation for the final deterministic tie-break.
  if (!CANONICAL_SVIX_ID.test(input.svixId)) {
    throw new Error("Invalid outreach delivery event identity.");
  }
  return prisma.$transaction(async (tx) => {
    await lockOutreachProviderMessage(tx, input.providerMessageId);
    await tx.outreachQuarantinedEmailEvent.deleteMany({
      where: { deleteAfter: { lte: new Date() } },
    });

    const prior = await tx.outreachEmailEvent.findUnique({
      where: { svixId: input.svixId },
      select: { recipient: { select: { campaignId: true } } },
    });
    if (prior) {
      return Object.freeze({
        status: "DUPLICATE" as const,
        campaignId: prior.recipient.campaignId,
      });
    }
    const quarantined = await tx.outreachEmailEventTombstone.findUnique({
      where: { svixId: input.svixId },
      select: { svixId: true },
    });
    if (quarantined) return Object.freeze({ status: "DUPLICATE" as const, campaignId: null });

    const candidate = await tx.outreachRecipient.findFirst({
      where: {
        OR: [
          { providerMessageId: input.providerMessageId },
          ...(input.deliveryAttemptId ? [{ deliveryAttemptId: input.deliveryAttemptId }] : []),
        ],
      },
      select: { id: true, emailSnapshot: true },
    });
    // This Resend account also sends transactional mail. Unknown traffic is not
    // outreach evidence and must not enter the durable inbox.
    if (!candidate) return Object.freeze({ status: "IGNORED" as const, campaignId: null });

    await lockOutreachEligibility(tx, normalizeEmail(candidate.emailSnapshot));
    await tx.$queryRaw`
      SELECT "id" FROM "OutreachRecipient" WHERE "id" = ${candidate.id} FOR UPDATE
    `;
    let recipient = await tx.outreachRecipient.findUnique({
      where: { id: candidate.id },
      select: {
        id: true,
        campaignId: true,
        contactId: true,
        emailSnapshot: true,
        deliveryAttemptId: true,
        providerMessageId: true,
        status: true,
        deliveryStatusPriority: true,
        deliveryStatusOccurredAt: true,
        deliveryStatusSvixId: true,
      },
    });
    if (!recipient) return Object.freeze({ status: "IGNORED" as const, campaignId: null });

    const attemptMatches = Boolean(
      input.deliveryAttemptId
      && input.deliveryAttemptId === recipient.deliveryAttemptId,
    );
    const providerMatches = input.providerMessageId === recipient.providerMessageId;
    if (
      normalizeEmail(recipient.emailSnapshot) !== input.normalizedEmail
      || (input.deliveryAttemptId && !attemptMatches)
      || (recipient.providerMessageId && !providerMatches)
    ) {
      await quarantineDeliveryEvent(tx, input, "OUTREACH_EVENT_IDENTITY_MISMATCH");
      return Object.freeze({ status: "QUARANTINED" as const, campaignId: null });
    }

    if (!recipient.providerMessageId) {
      if (!attemptMatches || !["SENDING", "RECONCILIATION_REQUIRED"].includes(recipient.status)) {
        return Object.freeze({ status: "IGNORED" as const, campaignId: null });
      }
      const acceptedAt = input.occurredAt;
      await tx.outreachRecipient.update({
        where: { id: recipient.id },
        data: {
          providerMessageId: input.providerMessageId,
          providerResult: "RESEND_ACCEPTED_WEBHOOK",
          sentAt: acceptedAt,
          status: "SENT",
          error: null,
        },
      });
      await tx.outreachContact.update({
        where: { id: recipient.contactId },
        data: {
          lastContactedAt: acceptedAt,
          followUpAt: defaultOutreachFollowUpAt(acceptedAt),
          engagementStage: "CONTACTED",
        },
      });
      recipient = { ...recipient, providerMessageId: input.providerMessageId, status: "SENT" };
    }

    await applyDeliveryEvent(tx, recipient, input);
    return Object.freeze({ status: "APPLIED" as const, campaignId: recipient.campaignId });
  });
}
