import { sourceSettlementCurrency, stripeTransferFunding } from "@/lib/payouts/stripeTransfer";

function charge(currency: string, settlementCurrency?: string) {
  return {
    id: "ch_test",
    currency,
    balance_transaction: settlementCurrency
      ? { id: "txn_test", currency: settlementCurrency, exchange_rate: settlementCurrency === currency ? null : 1.40901 }
      : "txn_unexpanded",
  } as any;
}

describe("Stripe payout transfer funding", () => {
  it("links the source charge when settlement and payout currencies match", () => {
    expect(stripeTransferFunding(charge("usd", "usd"), "USD", 8000)).toEqual({
      source_transaction: "ch_test",
      currency: "usd",
      amount: 8000,
      fundingMode: "SOURCE_LINKED",
    });
  });

  it("blocks rather than changing the seller payout currency when settlement differs", () => {
    expect(() => stripeTransferFunding(charge("cad", "usd"), "CAD", 8000)).toThrow(
      "TrueFanTix will not change the seller's payout currency"
    );
  });

  it("blocks when the balance transaction was not expanded", () => {
    const unexpanded = charge("usd");
    expect(sourceSettlementCurrency(unexpanded)).toBeNull();
    expect(() => stripeTransferFunding(unexpanded, "USD", 8000)).toThrow("settlement details are unavailable");
  });
});
