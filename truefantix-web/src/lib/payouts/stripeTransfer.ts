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
): { source_transaction: string; currency: string; amount: number; fundingMode: "SOURCE_LINKED" | "SOURCE_LINKED_FX" } {
  const normalizedPayoutCurrency = payoutCurrency.trim().toLowerCase();
  const settlementCurrency = sourceSettlementCurrency(charge);

  if (!settlementCurrency || !charge.balance_transaction || typeof charge.balance_transaction === "string") {
    throw new Error("Stripe settlement details are unavailable. No payout was sent; retry after the charge has settled.");
  }

  if (settlementCurrency === normalizedPayoutCurrency) {
    return { source_transaction: charge.id, currency: normalizedPayoutCurrency, amount: payoutAmount, fundingMode: "SOURCE_LINKED" };
  }

  const exchangeRate = charge.balance_transaction.exchange_rate;
  if (!exchangeRate || exchangeRate <= 0) {
    throw new Error(`Currency reconciliation required: Stripe settled this ${normalizedPayoutCurrency.toUpperCase()} charge in ${settlementCurrency.toUpperCase()}, but did not provide an exchange rate. No payout was sent.`);
  }

  // Preserve the seller's contractual presentment-currency value, converted at
  // the exact rate Stripe used on the original charge. Stripe requires the
  // source-linked transfer itself to be expressed in settlement currency.
  return {
    source_transaction: charge.id,
    currency: settlementCurrency,
    amount: Math.round(payoutAmount * exchangeRate),
    fundingMode: "SOURCE_LINKED_FX",
  };
}
