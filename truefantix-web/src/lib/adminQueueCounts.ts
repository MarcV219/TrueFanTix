export type AdminQueueActionableCounts = {
  pending: number;
  needsReview: number;
  catalogRequests: number;
  sellerStripe: number;
  suspendedSellers: number;
  expiredReservations: number;
  openEscrows: number;
  disputes: number;
  transferProofReviews: number;
  failedPayments: number;
  pendingPayouts: number;
  failedEmails: number;
  moderatedForumItems: number;
};

export const TRANSFER_PROOF_REVIEW_ORDER_WHERE = {
  transferVerificationStatus: "MANUAL_REVIEW",
} as const;

export const PENDING_PAYOUT_WHERE = {
  status: { in: ["PENDING", "FAILED"] },
} satisfies Prisma.PayoutWhereInput;

export const SELLER_STRIPE_ATTENTION_WHERE = {
  OR: [
    { status: "PENDING" },
    { stripeDetailsSubmitted: false },
    { stripePayoutsEnabled: false },
  ],
} satisfies Prisma.SellerWhereInput;

export const SELLER_ATTENTION_ACKNOWLEDGED_ACTION = "SELLER_ATTENTION_ACKNOWLEDGED";
export const REVIEWABLE_ATTENTION_ACKNOWLEDGED_ACTION = "REVIEWABLE_ATTENTION_ACKNOWLEDGED";
export const REVIEWABLE_ATTENTION_QUEUES = ["expiredReservations", "failedPayments", "failedEmails", "suspendedSellers", "moderatedForumItems"] as const;
export type ReviewableAttentionQueue = typeof REVIEWABLE_ATTENTION_QUEUES[number];

export const EXPIRED_RESERVATION_WHERE = { status: "RESERVED", reservedUntil: { not: null } } satisfies Prisma.TicketWhereInput;
export const FAILED_PAYMENT_WHERE = { status: "FAILED" } satisfies Prisma.PaymentWhereInput;
export const SUSPENDED_SELLER_WHERE = { status: "SUSPENDED" } satisfies Prisma.SellerWhereInput;
export const MODERATED_FORUM_WHERE = { visibility: { not: "VISIBLE" } } satisfies Prisma.ForumThreadWhereInput;

export function reviewableAttentionTargetId(queue: ReviewableAttentionQueue, id: string) { return `${queue}:${id}`; }
export function reviewableAttentionFingerprint(parts: Array<string | number | boolean | Date | null | undefined>) {
  return parts.map((part) => part instanceof Date ? part.toISOString() : String(part ?? "")).join(":");
}

export type SellerAttentionState = {
  status: string;
  stripeAccountId: string | null;
  stripeDetailsSubmitted: boolean;
  stripePayoutsEnabled: boolean;
};

export function sellerAttentionFingerprint(seller: SellerAttentionState) {
  return [seller.status, seller.stripeAccountId ? "linked" : "unlinked", seller.stripeDetailsSubmitted ? "details" : "no-details", seller.stripePayoutsEnabled ? "payouts" : "no-payouts"].join(":");
}

export function sellerAttentionSeverity(seller: SellerAttentionState): "ACTION_REQUIRED" | "INCOMPLETE" {
  return seller.status === "PENDING" && seller.stripeDetailsSubmitted ? "ACTION_REQUIRED" : "INCOMPLETE";
}

export function totalAdminQueueActionable(counts: AdminQueueActionableCounts) {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}
import type { Prisma } from "@prisma/client";
