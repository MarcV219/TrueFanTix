import fs from "node:fs";
import path from "node:path";

describe("support review agent boundary", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/internal/support-review-agent/route.ts"),
    "utf8",
  );

  it("keeps recommendations advisory and cannot change verification status", () => {
    expect(source).toContain('advisoryOnly: true');
    expect(source).toContain('verificationStatus: "NEEDS_REVIEW"');
    expect(source).not.toContain("verificationStatus: parsed.data");
    expect(source).not.toContain("verifiedAt:");
  });

  it("requires a dedicated bearer token and records an audit event", () => {
    expect(source).toContain("SUPPORT_REVIEW_AGENT_TOKEN");
    expect(source).toContain("timingSafeEqual");
    expect(source).toContain('action: "SUPPORT_REVIEW_AGENT_RECOMMEND"');
  });

  it("does not expose the original receipt upload to the agent", () => {
    expect(source).not.toContain("verificationImage: true");
    expect(source).toContain("receiptSummary");
  });
});
