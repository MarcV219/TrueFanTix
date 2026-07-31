import { prisma } from "@/lib/prisma";
import {
  TRANSFER_PROOF_REVIEW_ORDER_WHERE,
  totalAdminQueueActionable,
  type AdminQueueActionableCounts,
} from "@/lib/adminQueueCounts";

export async function loadAdminQueueCounts(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [
    pending, needsReview, rejected, catalogRequests, sellerStripe,
    suspendedSellers, expiredReservations, openEscrows, disputes,
    transferProofReviews, failedPayments, pendingPayouts, failedEmails,
    hiddenForumThreads, hiddenForumPosts,
  ] = await Promise.all([
    prisma.ticket.count({ where: { verificationStatus: "PENDING" } }),
    prisma.ticket.count({ where: { verificationStatus: "NEEDS_REVIEW" } }),
    prisma.ticket.count({ where: { verificationStatus: "REJECTED" } }),
    prisma.catalogRequest.count({ where: { status: "PENDING" } }),
    prisma.seller.count({ where: { OR: [
      { status: "PENDING" }, { stripeDetailsSubmitted: false },
      { stripeChargesEnabled: false }, { stripePayoutsEnabled: false },
    ] } }),
    prisma.seller.count({ where: { status: "SUSPENDED" } }),
    prisma.ticket.count({ where: { status: "RESERVED", reservedUntil: { not: null, lt: now } } }),
    prisma.ticketEscrow.count({ where: { state: "IN_ESCROW" } }),
    prisma.order.count({ where: { buyerConfirmationStatus: "DISPUTED" } }),
    prisma.order.count({ where: TRANSFER_PROOF_REVIEW_ORDER_WHERE }),
    prisma.payment.count({ where: { status: "FAILED" } }),
    prisma.payout.count({ where: { status: "PENDING" } }),
    prisma.emailDelivery.count({ where: { status: "FAILED", sentAt: { gte: dayAgo } } }),
    prisma.forumThread.count({ where: { visibility: { not: "VISIBLE" } } }),
    prisma.forumPost.count({ where: { visibility: { not: "VISIBLE" } } }),
  ]);
  const moderatedForumItems = hiddenForumThreads + hiddenForumPosts;
  const actionableCounts: AdminQueueActionableCounts = {
    pending, needsReview, catalogRequests, sellerStripe, suspendedSellers,
    expiredReservations, openEscrows, disputes, transferProofReviews,
    failedPayments, pendingPayouts, failedEmails, moderatedForumItems,
  };

  return {
    ...actionableCounts,
    rejected,
    hiddenForumThreads,
    hiddenForumPosts,
    actionable: totalAdminQueueActionable(actionableCounts),
  };
}
