import { parseDisputeCase, pendingAdminRequests, visibleAdminRequests } from "@/lib/dispute-case";

const dispute = {
  type: "BUYER_DISPUTE",
  openedAt: "2026-07-29T10:00:00.000Z",
  adminRequests: [
    {
      id: "request-buyer",
      requestedAt: "2026-07-29T10:10:00.000Z",
      requestedByUserId: "admin",
      recipient: "BUYER",
      message: "Buyer question",
      deliveries: [],
    },
    {
      id: "request-both",
      requestedAt: "2026-07-29T10:20:00.000Z",
      requestedByUserId: "admin",
      recipient: "BOTH",
      message: "Question for both",
      deliveries: [],
    },
  ],
  submissions: [
    {
      id: "buyer-reply",
      submittedAt: "2026-07-29T10:15:00.000Z",
      submittedByUserId: "buyer",
      submittedByRole: "BUYER",
      comments: "Buyer reply",
      evidenceFiles: [],
    },
  ],
};

describe("dispute case history", () => {
  it("finds the original dispute through nested resolution wrappers", () => {
    const wrapped = JSON.stringify({
      dispute: {
        dispute,
        resolution: { type: "ADMIN_DISPUTE_RESOLUTION" },
      },
      resolution: { type: "ADMIN_DISPUTE_RESOLUTION" },
    });
    expect(parseDisputeCase(wrapped)?.type).toBe("BUYER_DISPUTE");
  });

  it("shows only requests addressed to the current party", () => {
    const value = JSON.stringify(dispute);
    expect(visibleAdminRequests(value, "SELLER").map((request) => request.id)).toEqual(["request-both"]);
    expect(visibleAdminRequests(value, "BUYER")).toHaveLength(2);
  });

  it("clears earlier requests after a party replies but retains later requests", () => {
    const value = JSON.stringify(dispute);
    expect(pendingAdminRequests(value, "BUYER").map((request) => request.id)).toEqual(["request-both"]);
  });
});
