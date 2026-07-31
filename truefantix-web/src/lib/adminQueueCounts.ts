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

export function totalAdminQueueActionable(counts: AdminQueueActionableCounts) {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}
