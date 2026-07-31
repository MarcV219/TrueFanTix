import { totalAdminQueueActionable } from "@/lib/adminQueueCounts";

describe("admin queue counts", () => {
  it("includes transfer proof human reviews in the actionable total", () => {
    expect(totalAdminQueueActionable({
      pending: 0,
      needsReview: 0,
      catalogRequests: 0,
      sellerStripe: 3,
      suspendedSellers: 0,
      expiredReservations: 3,
      openEscrows: 0,
      disputes: 0,
      transferProofReviews: 1,
      failedPayments: 0,
      pendingPayouts: 3,
      failedEmails: 0,
      moderatedForumItems: 0,
    })).toBe(10);
  });
});
