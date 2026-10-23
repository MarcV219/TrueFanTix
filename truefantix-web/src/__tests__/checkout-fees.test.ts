import {
  BUYER_ADMIN_FEE_BPS,
  MINIMUM_BUYER_ADMIN_FEE_CENTS,
  calculateBuyerAdminFeeCents,
  calculateTicketSelectionAdminFeeCents,
} from "@/lib/checkout-fees";

describe("buyer admin fee", () => {
  it("keeps the configured rate at exactly 8.75%", () => {
    expect(BUYER_ADMIN_FEE_BPS).toBe(875);
  });

  it("charges the $5 minimum on low-value orders", () => {
    expect(calculateBuyerAdminFeeCents(100)).toBe(MINIMUM_BUYER_ADMIN_FEE_CENTS);
    expect(calculateBuyerAdminFeeCents(5_000)).toBe(500);
  });

  it("charges 8.75% above the minimum crossover", () => {
    expect(calculateBuyerAdminFeeCents(10_000)).toBe(875);
    expect(calculateBuyerAdminFeeCents(20_000)).toBe(1_750);
  });

  it("settles fractional-cent results to the nearest cent", () => {
    expect(calculateBuyerAdminFeeCents(5_720)).toBe(501);
  });
});

describe("ticket fee waivers", () => {
  it("charges no TrueFanTix fee when every selected ticket is waived", () => {
    expect(calculateTicketSelectionAdminFeeCents([
      { priceCents: 3_500, buyerAdminFeeWaived: true },
      { priceCents: 3_500, buyerAdminFeeWaived: true },
    ])).toBe(0);
  });

  it("calculates the fee only from non-waived tickets in a mixed order", () => {
    expect(calculateTicketSelectionAdminFeeCents([
      { priceCents: 10_000, buyerAdminFeeWaived: true },
      { priceCents: 10_000, buyerAdminFeeWaived: false },
    ])).toBe(875);
  });
});
