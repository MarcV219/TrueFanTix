import { PENDING_PAYOUT_WHERE, REVIEWABLE_ATTENTION_QUEUES, SELLER_STRIPE_ATTENTION_WHERE, reviewableAttentionFingerprint, reviewableAttentionTargetId, sellerAttentionFingerprint, sellerAttentionSeverity, totalAdminQueueActionable } from "@/lib/adminQueueCounts";

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

  it("provides one canonical pending-payout condition", () => {
    expect(PENDING_PAYOUT_WHERE).toEqual({ status: { in: ["PENDING", "FAILED"] } });
  });

  it("does not require Stripe charges for seller payout readiness", () => {
    expect(SELLER_STRIPE_ATTENTION_WHERE).toEqual({ OR: [
      { status: "PENDING" }, { stripeDetailsSubmitted: false }, { stripePayoutsEnabled: false },
    ] });
  });

  it("classifies submitted pending sellers as requiring Admin action", () => {
    const seller = { status: "PENDING", stripeAccountId: "acct_1", stripeDetailsSubmitted: true, stripePayoutsEnabled: true };
    expect(sellerAttentionSeverity(seller)).toBe("ACTION_REQUIRED");
    expect(sellerAttentionFingerprint(seller)).toBe("PENDING:linked:details:payouts");
  });

  it("uses stable queue-scoped acknowledgement identities", () => {
    expect(REVIEWABLE_ATTENTION_QUEUES).toContain("expiredReservations");
    expect(reviewableAttentionTargetId("expiredReservations", "ticket-1")).toBe("expiredReservations:ticket-1");
    expect(reviewableAttentionFingerprint(["RESERVED", "2026-08-10"])).toBe("RESERVED:2026-08-10");
  });
});
