import type Stripe from "stripe";

export function sourceSettlementCurrency(charge: Stripe.Charge): string | null {
  const balanceTransaction = charge.balance_transaction;
  if (!balanceTransaction || typeof balanceTransaction === "string") return null;
  return balanceTransaction.currency?.trim().toLowerCase() || null;
}

export function stripeTransferFunding(
  charge: Stripe.Charge,
  payoutCurrency: string,
  payoutAmount: number
): { source_transaction: string; currency: string; amount: number; fundingMode: "SOURCE_LINKED" } {
  const normalizedPayoutCurrency = payoutCurrency.trim().toLowerCase();
  const settlementCurrency = sourceSettlementCurrency(charge);

  if (!settlementCurrency || !charge.balance_transaction || typeof charge.balance_transaction === "string") {
    throw new Error("Stripe settlement details are unavailable. No payout was sent; retry after the charge has settled.");
  }

  if (settlementCurrency !== normalizedPayoutCurrency) {
    throw new Error(
      `Currency reconciliation required: this sale and seller payout are ${normalizedPayoutCurrency.toUpperCase()}, ` +
      `but Stripe settled the platform charge in ${settlementCurrency.toUpperCase()}. No payout was sent. ` +
      `Configure Stripe to retain ${normalizedPayoutCurrency.toUpperCase()} settlement funds before retrying; TrueFanTix will not change the seller's payout currency.`
    );
  }

  return { source_transaction: charge.id, currency: normalizedPayoutCurrency, amount: payoutAmount, fundingMode: "SOURCE_LINKED" };
}
