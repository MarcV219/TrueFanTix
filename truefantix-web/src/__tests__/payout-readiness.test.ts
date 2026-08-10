import { payoutReadinessError, type PayoutReadinessInput } from "@/lib/payouts/readiness";

function readyPayout(): PayoutReadinessInput {
  return {
    amountCents: 8000,
    status: "PENDING",
    seller: { status: "APPROVED", payoutHold: false, stripeAccountId: "acct_test", stripeDetailsSubmitted: true, stripePayoutsEnabled: true },
    order: { status: "COMPLETED", amountCents: 8000, buyerConfirmationStatus: "CONFIRMED", buyerConfirmationAt: new Date(), transferVerificationStatus: "MATCHED", payment: { status: "SUCCEEDED", providerRef: "pi_test", currency: "CAD" } },
  };
}

describe("payout readiness", () => {
  it("allows a completed, confirmed, paid order for a ready seller", () => {
    expect(payoutReadinessError(readyPayout())).toBeNull();
  });

  it("blocks seller payout holds", () => {
    const payout = readyPayout();
    payout.seller.payoutHold = true;
    expect(payoutReadinessError(payout)).toBe("Seller has a payout hold.");
  });

  it("blocks missing buyer confirmation and unsuccessful payments", () => {
    const unconfirmed = readyPayout();
    unconfirmed.order!.buyerConfirmationAt = null;
    expect(payoutReadinessError(unconfirmed)).toBe("Buyer receipt confirmation is missing.");
    const unpaid = readyPayout();
    unpaid.order!.payment!.status = "FAILED";
    expect(payoutReadinessError(unpaid)).toBe("Original payment is not successful.");
  });
});
