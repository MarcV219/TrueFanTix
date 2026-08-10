import { prisma } from "@/lib/prisma";
import {
  TRANSFER_PROOF_REVIEW_ORDER_WHERE,
  PENDING_PAYOUT_WHERE,
  SELLER_STRIPE_ATTENTION_WHERE,
  SELLER_ATTENTION_ACKNOWLEDGED_ACTION,
  sellerAttentionFingerprint,
  REVIEWABLE_ATTENTION_ACKNOWLEDGED_ACTION,
  reviewableAttentionTargetId,
  reviewableAttentionFingerprint,
  FAILED_PAYMENT_WHERE,
  SUSPENDED_SELLER_WHERE,
  MODERATED_FORUM_WHERE,
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
    prisma.seller.findMany({ where: SUSPENDED_SELLER_WHERE, select: { id: true, status: true, statusReason: true, updatedAt: true } }),
    prisma.ticket.findMany({ where: { status: "RESERVED", reservedUntil: { not: null, lt: now } }, select: { id: true, status: true, reservedUntil: true, updatedAt: true } }),
    prisma.ticketEscrow.count({ where: { state: "IN_ESCROW" } }),
    prisma.order.count({ where: { buyerConfirmationStatus: "DISPUTED" } }),
    prisma.order.count({ where: TRANSFER_PROOF_REVIEW_ORDER_WHERE }),
    prisma.payment.findMany({ where: FAILED_PAYMENT_WHERE, select: { id: true, status: true, providerRef: true, updatedAt: true } }),
    prisma.payout.count({ where: PENDING_PAYOUT_WHERE }),
    prisma.emailDelivery.findMany({ where: { status: "FAILED", sentAt: { gte: dayAgo } }, select: { id: true, status: true, error: true, sentAt: true } }),
    prisma.forumThread.findMany({ where: MODERATED_FORUM_WHERE, select: { id: true, visibility: true, visibilityReason: true, updatedAt: true } }),
    prisma.forumPost.findMany({ where: MODERATED_FORUM_WHERE, select: { id: true, visibility: true, visibilityReason: true, updatedAt: true } }),
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
  const reviewableItems = [
    ...suspendedSellers.map((item) => ({ targetId: reviewableAttentionTargetId("suspendedSellers", item.id), fingerprint: reviewableAttentionFingerprint([item.status, item.statusReason, item.updatedAt]) })),
    ...expiredReservations.map((item) => ({ targetId: reviewableAttentionTargetId("expiredReservations", item.id), fingerprint: reviewableAttentionFingerprint([item.status, item.reservedUntil, item.updatedAt]) })),
    ...failedPayments.map((item) => ({ targetId: reviewableAttentionTargetId("failedPayments", item.id), fingerprint: reviewableAttentionFingerprint([item.status, item.providerRef, item.updatedAt]) })),
    ...failedEmails.map((item) => ({ targetId: reviewableAttentionTargetId("failedEmails", item.id), fingerprint: reviewableAttentionFingerprint([item.status, item.error, item.sentAt]) })),
    ...hiddenForumThreads.map((item) => ({ targetId: reviewableAttentionTargetId("moderatedForumItems", `thread-${item.id}`), fingerprint: reviewableAttentionFingerprint([item.visibility, item.visibilityReason, item.updatedAt]) })),
    ...hiddenForumPosts.map((item) => ({ targetId: reviewableAttentionTargetId("moderatedForumItems", `post-${item.id}`), fingerprint: reviewableAttentionFingerprint([item.visibility, item.visibilityReason, item.updatedAt]) })),
  ];
  const reviewAcks = reviewableItems.length ? await prisma.auditLog.findMany({ where: { action: REVIEWABLE_ATTENTION_ACKNOWLEDGED_ACTION, targetType: "AdminQueueItem", targetId: { in: reviewableItems.map((item) => item.targetId) } }, orderBy: { createdAt: "desc" }, select: { targetId: true, metadata: true } }) : [];
  const ackFingerprintByTarget = new Map<string, string>();
  for (const acknowledgement of reviewAcks) {
    if (!acknowledgement.targetId || ackFingerprintByTarget.has(acknowledgement.targetId)) continue;
    try { ackFingerprintByTarget.set(acknowledgement.targetId, JSON.parse(acknowledgement.metadata || "{}").fingerprint || ""); } catch { /* ignore malformed historical metadata */ }
  }
  const activeCount = (queue: string) => reviewableItems.filter((item) => item.targetId.startsWith(`${queue}:`) && ackFingerprintByTarget.get(item.targetId) !== item.fingerprint).length;
  const moderatedForumItems = activeCount("moderatedForumItems");
  const actionableCounts: AdminQueueActionableCounts = {
    pending, needsReview, catalogRequests, sellerStripe: sellerStripeCount, suspendedSellers: activeCount("suspendedSellers"),
    expiredReservations: activeCount("expiredReservations"), openEscrows, disputes, transferProofReviews,
    failedPayments: activeCount("failedPayments"), pendingPayouts, failedEmails: activeCount("failedEmails"), moderatedForumItems,
  };

  return {
    ...actionableCounts,
    rejected,
    hiddenForumThreads: hiddenForumThreads.length,
    hiddenForumPosts: hiddenForumPosts.length,
    actionable: totalAdminQueueActionable(actionableCounts),
  };
}
