import { OrderStatus, PaymentStatus } from "@prisma/client";

export type EscrowState =
  | "NOT_FUNDED"
  | "FUNDS_HELD"
  | "RELEASE_READY"
  | "RELEASED"
  | "REFUNDED"
  | "FAILED";

export function deriveEscrowState(input: {
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus | null;
}): EscrowState {
  const { orderStatus, paymentStatus } = input;

  if (orderStatus === OrderStatus.REFUNDED || paymentStatus === PaymentStatus.REFUNDED) return "REFUNDED";
  if (orderStatus === OrderStatus.FAILED || paymentStatus === PaymentStatus.FAILED) return "FAILED";

  if (paymentStatus !== PaymentStatus.SUCCEEDED) return "NOT_FUNDED";

  if (orderStatus === OrderStatus.PAID) return "FUNDS_HELD";
  if (orderStatus === OrderStatus.DELIVERED) return "RELEASE_READY";
  if (orderStatus === OrderStatus.COMPLETED) return "RELEASED";

  return "FUNDS_HELD";
}
