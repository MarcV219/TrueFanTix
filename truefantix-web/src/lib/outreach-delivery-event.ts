import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/outreach";
import { lockOutreachEligibility } from "@/lib/outreach-eligibility-lock";

const statusPriority: Readonly<Record<string, number>> = Object.freeze({
  PENDING: 0,
  SENDING: 0,
  SENT: 1,
  DELIVERY_DELAYED: 2,
  DELIVERED: 3,
  FAILED: 3,
  BOUNCED: 4,
  SUPPRESSED: 4,
  COMPLAINED: 5,
});

export type OutreachDeliveryEventInput = Readonly<{
  svixId: string;
  type: string;
  providerMessageId: string;
  recipientId: string;
  normalizedEmail: string;
  occurredAt: Date;
  detail: string | null;
  nextStatus: string;
  suppressionReason: string | null;
  contactUpdate: Readonly<{ engagementStage: "BOUNCED"; followUpAt: null }> | null;
}>;

export async function recordOutreachDeliveryEvent(input: OutreachDeliveryEventInput) {
  return prisma.$transaction(async (tx) => {
    await lockOutreachEligibility(tx, input.normalizedEmail);
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "OutreachRecipient"
      WHERE "id" = ${input.recipientId}
        AND "providerMessageId" = ${input.providerMessageId}
      FOR UPDATE
    `;
    if (!locked.length) return "IDENTITY_CHANGED" as const;

    const recipient = await tx.outreachRecipient.findUnique({
      where: { id: input.recipientId },
      select: {
        id: true,
        contactId: true,
        emailSnapshot: true,
        providerMessageId: true,
        status: true,
      },
    });
    if (
      !recipient
      || recipient.providerMessageId !== input.providerMessageId
      || normalizeEmail(recipient.emailSnapshot) !== input.normalizedEmail
    ) {
      return "IDENTITY_CHANGED" as const;
    }

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
    if ((statusPriority[input.nextStatus] ?? 0) >= (statusPriority[recipient.status] ?? 0)) {
      await tx.outreachRecipient.update({
        where: { id: recipient.id },
        data: { status: input.nextStatus, error: input.detail },
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
    return "APPLIED" as const;
  });
}
