import { prisma } from "@/lib/prisma";
import {
  TRANSFER_PROOF_REVIEW_ORDER_WHERE,
  PENDING_PAYOUT_WHERE,
  SELLER_STRIPE_ATTENTION_WHERE,
  SELLER_ATTENTION_ACKNOWLEDGED_ACTION,
  sellerAttentionFingerprint,
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
    prisma.seller.findMany({ where: SELLER_STRIPE_ATTENTION_WHERE, select: { id: true, status: true, stripeAccountId: true, stripeDetailsSubmitted: true, stripePayoutsEnabled: true } }),
    prisma.seller.count({ where: { status: "SUSPENDED" } }),
    prisma.ticket.count({ where: { status: "RESERVED", reservedUntil: { not: null, lt: now } } }),
    prisma.ticketEscrow.count({ where: { state: "IN_ESCROW" } }),
    prisma.order.count({ where: { buyerConfirmationStatus: "DISPUTED" } }),
    prisma.order.count({ where: TRANSFER_PROOF_REVIEW_ORDER_WHERE }),
    prisma.payment.count({ where: { status: "FAILED" } }),
    prisma.payout.count({ where: PENDING_PAYOUT_WHERE }),
    prisma.emailDelivery.count({ where: { status: "FAILED", sentAt: { gte: dayAgo } } }),
    prisma.forumThread.count({ where: { visibility: { not: "VISIBLE" } } }),
    prisma.forumPost.count({ where: { visibility: { not: "VISIBLE" } } }),
  ]);
  const sellerAcknowledgements = sellerStripe.length ? await prisma.auditLog.findMany({
    where: { action: SELLER_ATTENTION_ACKNOWLEDGED_ACTION, targetType: "Seller", targetId: { in: sellerStripe.map((seller) => seller.id) } },
    orderBy: { createdAt: "desc" },
    select: { targetId: true, metadata: true },
  }) : [];
  const acknowledgedFingerprintBySeller = new Map<string, string>();
  for (const acknowledgement of sellerAcknowledgements) {
    if (!acknowledgement.targetId || acknowledgedFingerprintBySeller.has(acknowledgement.targetId)) continue;
    try { acknowledgedFingerprintBySeller.set(acknowledgement.targetId, JSON.parse(acknowledgement.metadata || "{}").fingerprint || ""); } catch { /* ignore malformed historical metadata */ }
  }
  const sellerStripeCount = sellerStripe.filter((seller) => acknowledgedFingerprintBySeller.get(seller.id) !== sellerAttentionFingerprint(seller)).length;
  const moderatedForumItems = hiddenForumThreads + hiddenForumPosts;
  const actionableCounts: AdminQueueActionableCounts = {
    pending, needsReview, catalogRequests, sellerStripe: sellerStripeCount, suspendedSellers,
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
