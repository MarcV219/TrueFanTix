import { prisma } from "@/lib/prisma";
import { createNotification, createNotificationOncePerWindow } from "@/lib/notifications/service";

export const SELLER_TRANSFER_DEADLINE_HOURS = 24;
export const BUYER_CONFIRMATION_DEADLINE_HOURS = 24;
export const TRANSFER_REMINDER_INTERVAL_HOURS = 6;

export function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function formatDeadline(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function sellerTransferDeadline(order: { createdAt: Date; payment?: { updatedAt: Date } | null }) {
  return addHours(order.payment?.updatedAt ?? order.createdAt, SELLER_TRANSFER_DEADLINE_HOURS);
}

export function buyerConfirmationDeadline(transferSubmittedAt: Date) {
  return addHours(transferSubmittedAt, BUYER_CONFIRMATION_DEADLINE_HOURS);
}

function reminderWindowStart(now = new Date()) {
  return new Date(now.getTime() - TRANSFER_REMINDER_INTERVAL_HOURS * 60 * 60 * 1000);
}

export async function notifySellerTransferRequired(params: {
  sellerUserId: string;
  orderId: string;
  ticketCount: number;
  deadline: Date;
  now?: Date;
}) {
  const overdue = params.deadline.getTime() <= (params.now ?? new Date()).getTime();
  const ticketWord = params.ticketCount === 1 ? "ticket" : "tickets";
  const message = overdue
    ? `Transfer ${params.ticketCount} sold ${ticketWord} now. The 24-hour transfer deadline passed at ${formatDeadline(params.deadline)}.`
    : `Transfer ${params.ticketCount} sold ${ticketWord} to the buyer by ${formatDeadline(params.deadline)}. Payment stays protected until transfer is confirmed.`;

  return createNotificationOncePerWindow({
    userId: params.sellerUserId,
    type: "TRANSFER_REQUIRED",
    message,
    link: "/account/tickets/seller-holding",
    windowStart: reminderWindowStart(params.now),
  });
}

export async function notifyBuyerTransferConfirmationRequired(params: {
  buyerUserId: string;
  orderId: string;
  ticketCount: number;
  deadline: Date;
  now?: Date;
}) {
  const ticketWord = params.ticketCount === 1 ? "ticket" : "tickets";
  const message = `Confirm you received ${params.ticketCount} transferred ${ticketWord} by ${formatDeadline(params.deadline)}. If you do not confirm within 24 hours, the seller payout will be released.`;

  return createNotificationOncePerWindow({
    userId: params.buyerUserId,
    type: "TRANSFER_CONFIRMATION_REQUIRED",
    message,
    link: "/account/tickets/holding",
    windowStart: reminderWindowStart(params.now),
  });
}

export async function notifySellerBuyerConfirmed(params: {
  sellerUserId: string;
  orderId: string;
  ticketCount: number;
}) {
  const ticketWord = params.ticketCount === 1 ? "ticket" : "tickets";
  return createNotification({
    userId: params.sellerUserId,
    type: "TRANSFER_RECEIVED",
    message: `The buyer confirmed receipt of ${params.ticketCount} ${ticketWord}. The payment hold has moved to the pending payout queue.`,
    link: "/account/tickets/seller-holding",
  });
}

export async function notifyBuyerAutoConfirmed(params: {
  buyerUserId: string;
  orderId: string;
  ticketCount: number;
}) {
  const ticketWord = params.ticketCount === 1 ? "ticket" : "tickets";
  return createNotification({
    userId: params.buyerUserId,
    type: "ESCROW_RELEASED",
    message: `The 24-hour confirmation window ended for ${params.ticketCount} ${ticketWord}. Seller payout has been released because no dispute was opened.`,
    link: "/account/tickets/bought",
  });
}

export async function notifySellerAutoConfirmed(params: {
  sellerUserId: string;
  orderId: string;
  ticketCount: number;
}) {
  const ticketWord = params.ticketCount === 1 ? "ticket" : "tickets";
  return createNotification({
    userId: params.sellerUserId,
    type: "ESCROW_RELEASED",
    message: `The buyer did not dispute ${params.ticketCount} transferred ${ticketWord} within 24 hours. The payment hold has moved to the pending payout queue.`,
    link: "/account/tickets/sold",
  });
}

async function autoReleaseTimedOutBuyerConfirmation(orderId: string, now: Date) {
  return prisma.$transaction(async (tx: any) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { ticket: true } },
        payment: true,
        seller: { include: { user: true } },
        buyerSeller: { include: { user: true } },
      },
    });

    if (
      !order ||
      order.status !== "PAID" ||
      order.transferVerificationStatus !== "PENDING" ||
      order.buyerConfirmationStatus !== "PENDING" ||
      !order.disputeWindowEndsAt ||
      order.disputeWindowEndsAt > now ||
      order.payment?.status !== "SUCCEEDED"
    ) {
      return null;
    }

    const ticketIds = order.items.map((item: any) => item.ticketId);

    await tx.ticket.updateMany({
      where: { id: { in: ticketIds } },
      data: {
        status: "SOLD",
        soldAt: now,
        reservedByOrderId: null,
        reservedUntil: null,
      },
    });

    const completedGate = await tx.order.updateMany({
      where: {
        id: order.id,
        status: "PAID",
        buyerConfirmationStatus: "PENDING",
      },
      data: {
        status: "COMPLETED",
        buyerConfirmationStatus: "AUTO_CONFIRMED",
        buyerConfirmationAt: now,
      },
    });

    if (completedGate.count === 0) {
      return null;
    }

    await tx.sellerMetrics.upsert({
      where: { sellerId: order.sellerId },
      create: {
        sellerId: order.sellerId,
        lifetimeSalesCents: order.amountCents,
        lifetimeOrders: 1,
        lifetimeTicketsSold: order.items.length,
      },
      update: {
        lifetimeSalesCents: { increment: order.amountCents },
        lifetimeOrders: { increment: 1 },
        lifetimeTicketsSold: { increment: order.items.length },
      },
    });

    const providerRef = `order:${order.id}`;
    const existingPayout = await tx.payout.findFirst({
      where: { sellerId: order.sellerId, provider: "ESCROW_INTERNAL", providerRef },
      select: { id: true },
    });

    if (!existingPayout) {
      await tx.payout.create({
        data: {
          sellerId: order.sellerId,
          amountCents: order.amountCents,
          feeCents: 0,
          netCents: order.amountCents,
          status: "PENDING",
          provider: "ESCROW_INTERNAL",
          providerRef,
        },
      });
    }

    return {
      orderId: order.id,
      ticketCount: order.items.length,
      sellerUserId: order.seller.user?.id ?? null,
      buyerUserId: order.buyerSeller.user?.id ?? null,
    };
  });
}

export async function runTransferReminderWorkflow(now = new Date()) {
  const sellerOrders = await prisma.order.findMany({
    where: {
      status: "PAID",
      payment: { status: "SUCCEEDED" },
      transferProofType: null,
    },
    include: {
      payment: true,
      items: { select: { id: true } },
      seller: { include: { user: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  let sellerReminders = 0;
  for (const order of sellerOrders) {
    const sellerUserId = order.seller.user?.id;
    if (!sellerUserId) continue;
    const result = await notifySellerTransferRequired({
      sellerUserId,
      orderId: order.id,
      ticketCount: order.items.length,
      deadline: sellerTransferDeadline(order),
      now,
    });
    if (result.ok && !("skipped" in result)) sellerReminders += 1;
  }

  const buyerOrders = await prisma.order.findMany({
    where: {
      status: "PAID",
      payment: { status: "SUCCEEDED" },
      transferVerificationStatus: "PENDING",
      buyerConfirmationStatus: "PENDING",
      disputeWindowEndsAt: { not: null },
    },
    include: {
      items: { select: { id: true } },
      buyerSeller: { include: { user: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  let buyerReminders = 0;
  const autoReleased = [];

  for (const order of buyerOrders) {
    if (order.disputeWindowEndsAt && order.disputeWindowEndsAt <= now) {
      const released = await autoReleaseTimedOutBuyerConfirmation(order.id, now);
      if (released) {
        autoReleased.push(released.orderId);
        if (released.sellerUserId) {
          await notifySellerAutoConfirmed({
            sellerUserId: released.sellerUserId,
            orderId: released.orderId,
            ticketCount: released.ticketCount,
          });
        }
        if (released.buyerUserId) {
          await notifyBuyerAutoConfirmed({
            buyerUserId: released.buyerUserId,
            orderId: released.orderId,
            ticketCount: released.ticketCount,
          });
        }
      }
      continue;
    }

    const buyerUserId = order.buyerSeller.user?.id;
    if (!buyerUserId || !order.disputeWindowEndsAt) continue;
    const result = await notifyBuyerTransferConfirmationRequired({
      buyerUserId,
      orderId: order.id,
      ticketCount: order.items.length,
      deadline: order.disputeWindowEndsAt,
      now,
    });
    if (result.ok && !("skipped" in result)) buyerReminders += 1;
  }

  return {
    sellerOrdersChecked: sellerOrders.length,
    buyerOrdersChecked: buyerOrders.length,
    sellerReminders,
    buyerReminders,
    autoReleased,
  };
}
