export type CheckoutOrderStatus = "PENDING" | "PAID" | "DELIVERED" | "COMPLETED" | "CANCELLED" | "REFUNDED" | "FAILED" | string;
export type CheckoutPaymentStatus =
  | "REQUIRES_PAYMENT"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | string;

export type CheckoutCompletionState = "complete" | "incomplete" | "failed";

export function getCheckoutCompletionState(order: {
  status?: CheckoutOrderStatus | null;
  payment?: { status?: CheckoutPaymentStatus | null } | null;
} | null | undefined): CheckoutCompletionState {
  if (!order) return "incomplete";

  if (order.status === "CANCELLED" || order.status === "FAILED" || order.status === "REFUNDED") {
    return "failed";
  }

  if (order.payment?.status === "FAILED" || order.payment?.status === "CANCELED" || order.payment?.status === "REFUNDED") {
    return "failed";
  }

  if (
    order.payment?.status === "SUCCEEDED" &&
    (order.status === "PAID" || order.status === "DELIVERED" || order.status === "COMPLETED")
  ) {
    return "complete";
  }

  return "incomplete";
}
