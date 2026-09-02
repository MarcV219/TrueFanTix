/** @jest-environment node */
import { isAutoApprovalEligible } from "@/lib/outreach-import-policy";

const valid = {
  email: "agent@example.com",
  sourceUrl: "https://artist.example/contact",
  sourceType: "Official artist site",
  role: "Booking — North America",
  confidence: "HIGH",
  researchStatus: "RESEARCHED",
};

describe("outreach contact import approval policy", () => {
  it("accepts explicitly published professional evidence", () => {
    expect(isAutoApprovalEligible(valid)).toBe(true);
  });

  it.each([
    ["missing source", { sourceUrl: null }],
    ["combined invalid URL", { sourceUrl: "https://one.example | https://two.example" }],
    ["ambiguous role", { role: "General inquiries" }],
    ["consumer support", { role: "Store customer support" }],
    ["unverified directory", { sourceType: "Industry directory" }],
    ["medium confidence", { confidence: "MEDIUM" }],
    ["manual review", { researchStatus: "NEEDS_REVIEW" }],
  ])("rejects %s", (_label, override) => {
    expect(isAutoApprovalEligible({ ...valid, ...override })).toBe(false);
  });
});
