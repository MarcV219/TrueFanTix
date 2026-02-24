export type EscrowState =
  | "NOT_FUNDED"
  | "FUNDS_HELD"
  | "RELEASE_READY"
  | "RELEASED"
  | "REFUNDED"
  | "FAILED";

export function deriveEscrowState(input: {
  orderStatus: string;
  paymentStatus: string | null;
}): EscrowState {
  const { orderStatus, paymentStatus } = input;

  if (orderStatus === "REFUNDED" || paymentStatus === "REFUNDED") return "REFUNDED";
  if (orderStatus === "FAILED" || paymentStatus === "FAILED") return "FAILED";

  if (paymentStatus !== "SUCCEEDED") return "NOT_FUNDED";

  if (orderStatus === "PAID") return "FUNDS_HELD";
  if (orderStatus === "DELIVERED") return "RELEASE_READY";
  if (orderStatus === "COMPLETED") return "RELEASED";

  return "FUNDS_HELD";
}
