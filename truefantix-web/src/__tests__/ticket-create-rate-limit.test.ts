import { RateLimitConfigs } from "@/lib/rate-limit-config";

describe("ticket creation rate limit", () => {
  it("allows multiple maximum-size seller submissions without truncating a batch", () => {
    const config = RateLimitConfigs["tickets:create"];

    expect(config).toBeDefined();
    expect(config.limit).toBeGreaterThanOrEqual(20 * 5);
    expect(config.windowMs).toBe(60 * 60 * 1000);
  });
});
