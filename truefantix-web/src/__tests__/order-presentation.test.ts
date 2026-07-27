import { getCheckoutCompletionState } from "@/lib/orderPresentation";

describe("getCheckoutCompletionState", () => {
  it("does not treat a pending order without payment as complete", () => {
    expect(getCheckoutCompletionState({ status: "PENDING", payment: null })).toBe("incomplete");
  });

  it("requires both a paid order state and succeeded payment", () => {
    expect(getCheckoutCompletionState({ status: "PENDING", payment: { status: "SUCCEEDED" } })).toBe("incomplete");
    expect(getCheckoutCompletionState({ status: "PAID", payment: { status: "SUCCEEDED" } })).toBe("complete");
    expect(getCheckoutCompletionState({ status: "COMPLETED", payment: { status: "SUCCEEDED" } })).toBe("complete");
  });

  it("marks failed/cancelled/refunded orders as failed", () => {
    expect(getCheckoutCompletionState({ status: "CANCELLED", payment: null })).toBe("failed");
    expect(getCheckoutCompletionState({ status: "PAID", payment: { status: "FAILED" } })).toBe("failed");
  });
});
