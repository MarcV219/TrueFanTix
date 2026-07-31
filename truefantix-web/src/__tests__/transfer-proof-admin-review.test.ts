import { transferProofAdminActionMessage, transferProofStatusForAdminAction } from "@/lib/orders/transferProofAdminReview";

describe("transfer proof Admin review", () => {
  it.each([
    ["APPROVE", "PENDING"],
    ["REJECT", "MISMATCHED"],
    ["REQUEST_INFORMATION", "MANUAL_REVIEW"],
  ] as const)("maps %s to the canonical queue state %s", (action, status) => {
    expect(transferProofStatusForAdminAction(action)).toBe(status);
  });

  it("keeps information requests in the queue", () => {
    expect(transferProofAdminActionMessage("REQUEST_INFORMATION")).toContain("remains in the Admin Queue");
  });
});
