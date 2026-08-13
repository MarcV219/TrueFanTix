export const BUYER_ADMIN_FEE_BPS = 875;
export const MINIMUM_BUYER_ADMIN_FEE_CENTS = 500;

const BPS_DENOMINATOR = 10_000;

export function calculateBuyerAdminFeeCents(ticketSubtotalCents: number): number {
  const subtotal = Math.max(0, Math.trunc(ticketSubtotalCents));
  // Payments settle in whole cents. Adding half the denominator applies the
  // standard nearest-cent rule without floating-point percentage arithmetic.
  const percentageFeeCents = Math.floor(
    (subtotal * BUYER_ADMIN_FEE_BPS + BPS_DENOMINATOR / 2) / BPS_DENOMINATOR
  );

  return Math.max(MINIMUM_BUYER_ADMIN_FEE_CENTS, percentageFeeCents);
}
