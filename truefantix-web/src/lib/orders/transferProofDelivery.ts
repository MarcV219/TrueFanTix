import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateBuyerTransferConfirmationRequiredEmail, sendEmail } from "@/lib/email";
import { ADMIN_ACTIVITY_EMAIL, sendAdminActivityEmail } from "@/lib/adminActivityEmail";
import { reminderWindowStart } from "@/lib/orders/transferWorkflow";

const BUYER_EMAIL_TYPE = "BUYER_CONFIRMATION";

function configuredEmailProvider() {
  if (process.env.RESEND_API_KEY?.trim()) return "RESEND";
  if (process.env.SENDGRID_API_KEY?.trim()) return "SENDGRID";
  return "CONSOLE";
}

export type TransferProofDeliveryIntent = {
  orderId: string;
  buyerUserId: string;
  buyerEmail: string;
  buyerFirstName: string | null;
  sellerEmail: string;
  ticketCount: number;
  transferProofType: string;
  deadline: Date;
  windowStart: Date;
  adminEmailType: string;
};

export async function stageTransferProofDeliveryIntent(
  tx: Prisma.TransactionClient,
  params: Omit<TransferProofDeliveryIntent, "windowStart" | "adminEmailType"> & { now: Date },
): Promise<TransferProofDeliveryIntent> {
  const windowStart = reminderWindowStart(params.now);
  const adminEmailType = `ADMIN_TRANSFER_SUBMITTED_${windowStart.toISOString()}`;
  const ticketWord = params.ticketCount === 1 ? "ticket" : "tickets";
  const message = `Confirm you received ${params.ticketCount} transferred ${ticketWord} by ${params.deadline.toLocaleString("en-CA")}. If you do not confirm within 24 hours, the seller payout will be released.`;

  const existingNotification = await tx.notification.findFirst({
    where: {
      userId: params.buyerUserId,
      type: "TRANSFER_CONFIRMATION_REQUIRED",
      link: "/account/tickets/holding",
      createdAt: { gte: windowStart },
    },
    select: { id: true },
  });
  if (!existingNotification) {
    await tx.notification.create({
      data: {
        userId: params.buyerUserId,
        type: "TRANSFER_CONFIRMATION_REQUIRED",
        message,
        link: "/account/tickets/holding",
        isRead: false,
      },
    });
  }

  const provider = configuredEmailProvider();
  await tx.reminderDelivery.upsert({
    where: {
      orderId_reminderType_recipient_windowStart: {
        orderId: params.orderId,
        reminderType: BUYER_EMAIL_TYPE,
        recipient: params.buyerEmail,
        windowStart,
      },
    },
    create: {
      orderId: params.orderId,
      reminderType: BUYER_EMAIL_TYPE,
      recipient: params.buyerEmail,
      windowStart,
      deadline: params.deadline,
      provider,
      status: "PENDING",
    },
    update: { deadline: params.deadline },
  });
  await tx.emailDelivery.upsert({
    where: {
      orderId_emailType_recipient: {
        orderId: params.orderId,
        emailType: adminEmailType,
        recipient: ADMIN_ACTIVITY_EMAIL,
      },
    },
    create: {
      orderId: params.orderId,
      emailType: adminEmailType,
      recipient: ADMIN_ACTIVITY_EMAIL,
      provider,
      status: "PENDING",
    },
    update: {},
  });

  return { ...params, windowStart, adminEmailType };
}

export async function dispatchTransferProofDeliveryIntent(
  intent: TransferProofDeliveryIntent,
  db: Pick<Prisma.TransactionClient, "reminderDelivery" | "emailDelivery"> = prisma,
) {
  const reminderKey = {
    orderId: intent.orderId,
    reminderType: BUYER_EMAIL_TYPE,
    recipient: intent.buyerEmail,
    windowStart: intent.windowStart,
  };
  const buyerClaim = await db.reminderDelivery.updateMany({
    where: { ...reminderKey, status: "PENDING" },
    data: { status: "ATTEMPTING", attemptedAt: new Date(), completedAt: null },
  });
  if (buyerClaim.count === 1) {
    try {
      const email = generateBuyerTransferConfirmationRequiredEmail(
        intent.orderId,
        intent.buyerFirstName,
        intent.ticketCount,
        intent.deadline,
      );
      const result = await sendEmail({ to: intent.buyerEmail, ...email });
      await db.reminderDelivery.updateMany({
        where: { ...reminderKey, status: "ATTEMPTING" },
        data: {
          provider: result.provider || configuredEmailProvider(),
          status: result.ok ? "SENT" : "FAILED",
          providerResult: result.providerResult || (result.ok ? "ACCEPTED" : "REJECTED"),
          failureReason: result.ok ? null : result.error || "Unknown provider error",
          completedAt: new Date(),
        },
      });
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : "Unknown provider error";
      await db.reminderDelivery.updateMany({
        where: { ...reminderKey, status: "ATTEMPTING" },
        data: { status: "FAILED", providerResult: "EXCEPTION", failureReason, completedAt: new Date() },
      });
    }
  }

  const adminClaim = await db.emailDelivery.updateMany({
    where: {
      orderId: intent.orderId,
      emailType: intent.adminEmailType,
      recipient: ADMIN_ACTIVITY_EMAIL,
      status: "PENDING",
    },
    data: { status: "ATTEMPTING", sentAt: new Date(), error: null },
  });
  if (adminClaim.count === 1) {
    const result = await sendAdminActivityEmail({
      activity: "TICKETS_TRANSFERRED",
      summary: `Ticket transfer submitted — order ${intent.orderId}`,
      details: {
        "Order ID": intent.orderId,
        Seller: intent.sellerEmail,
        Buyer: intent.buyerEmail,
        "Ticket count": intent.ticketCount,
        "Proof type": intent.transferProofType,
        "Buyer confirmation deadline": intent.deadline.toISOString(),
      },
    });
    await db.emailDelivery.updateMany({
      where: {
        orderId: intent.orderId,
        emailType: intent.adminEmailType,
        recipient: ADMIN_ACTIVITY_EMAIL,
        status: "ATTEMPTING",
      },
      data: { status: result.ok ? "SENT" : "FAILED", error: result.ok ? null : result.error || "Unknown provider error" },
    });
  }
}
