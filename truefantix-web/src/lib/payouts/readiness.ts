export type PayoutReadinessInput = {
  amountCents: number;
  status: string;
  seller: {
    status: string;
    payoutHold: boolean;
    stripeAccountId: string | null;
    stripeDetailsSubmitted: boolean;
    stripePayoutsEnabled: boolean;
  };
  order: null | {
    status: string;
    amountCents: number;
    buyerConfirmationStatus: string | null;
    buyerConfirmationAt: Date | string | null;
    transferVerificationStatus: string | null;
    payment: null | { status: string; providerRef: string; currency: string };
  };
};

export function payoutReadinessError(payout: PayoutReadinessInput): string | null {
  if (!["PENDING", "FAILED", "PROCESSING"].includes(payout.status)) return "Payout is not awaiting processing.";
  if (payout.amountCents <= 0) return "Payout amount must be greater than zero.";
  if (!payout.order) return "Payout is not linked to an order.";
  if (payout.order.status !== "COMPLETED") return "Order is not completed.";
  if (!["CONFIRMED", "AUTO_CONFIRMED"].includes(payout.order.buyerConfirmationStatus || "") || !payout.order.buyerConfirmationAt) return "Buyer receipt confirmation is missing.";
  if (payout.order.transferVerificationStatus === "MANUAL_REVIEW" || payout.order.buyerConfirmationStatus === "DISPUTED") return "Order is under dispute or manual review.";
  if (!payout.order.payment || payout.order.payment.status !== "SUCCEEDED") return "Original payment is not successful.";
  if (payout.amountCents > payout.order.amountCents) return "Payout exceeds the seller amount on the order.";
  if (payout.seller.status !== "APPROVED") return "Seller is not approved.";
  if (payout.seller.payoutHold) return "Seller has a payout hold.";
  if (!payout.seller.stripeAccountId) return "Seller has no connected Stripe account.";
  if (!payout.seller.stripeDetailsSubmitted || !payout.seller.stripePayoutsEnabled) return "Seller Stripe payout setup is incomplete.";
  return null;
}
