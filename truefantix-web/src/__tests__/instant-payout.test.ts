import { instantPayoutDestination, instantPayoutStatusLabel } from "@/lib/payouts/instantPayout";

describe("instant payout eligibility", () => {
  const standard = { id: "ba_standard", currency: "cad", available_payout_methods: ["standard"] };
  const instant = { id: "card_instant", currency: "cad", available_payout_methods: ["standard", "instant"] };

  it("selects a Stripe-verified instant destination in the payout currency", () => {
    expect(instantPayoutDestination([standard, instant], "CAD")).toEqual(instant);
  });

  it("does not use standard-only or wrong-currency destinations", () => {
    expect(instantPayoutDestination([standard, { ...instant, currency: "usd" }], "CAD")).toBeNull();
  });

  it("provides unambiguous seller-facing states", () => {
    expect(instantPayoutStatusLabel(true, true)).toBe("INSTANT_READY");
    expect(instantPayoutStatusLabel(false, true)).toBe("STANDARD_ONLY");
    expect(instantPayoutStatusLabel(false, false)).toBe("SETUP_REQUIRED");
  });
});
