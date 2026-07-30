import { canBuyerCancelDispute, parseDisputeCase } from "@/lib/dispute-case";

describe("dispute case", () => {
  it("allows the buyer to close disputes under review or marked for refund", () => {
    expect(canBuyerCancelDispute("DISPUTED", "MANUAL_REVIEW")).toBe(true);
    expect(canBuyerCancelDispute("DISPUTED", "REFUND_REQUIRED")).toBe(true);
  });

  it("does not allow cancellation after the dispute is already closed", () => {
    expect(canBuyerCancelDispute("CONFIRMED", "MATCHED")).toBe(false);
    expect(canBuyerCancelDispute("PENDING", "PENDING")).toBe(false);
  });

  it("finds the original dispute beneath admin resolution records", () => {
    const dispute = {
      type: "BUYER_DISPUTE",
      openedByUserId: "buyer-1",
      ticketIds: ["ticket-1"],
    };
    const stored = JSON.stringify({
      dispute: {
        dispute,
        resolution: { type: "ADMIN_DISPUTE_RESOLUTION", action: "MARK_REFUND_REQUIRED" },
      },
      resolution: { type: "ADMIN_DISPUTE_RESOLUTION", action: "KEEP_UNDER_REVIEW" },
    });

    expect(parseDisputeCase(stored)).toEqual(dispute);
  });
});
