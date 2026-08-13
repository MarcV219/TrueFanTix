import { LAUNCH_PROMOTION_START, launchPromotionIsActive } from "@/lib/launchPromotion";

describe("launch token promotion period", () => {
  const originalEnd = process.env.LAUNCH_PROMOTION_END_AT;

  afterEach(() => {
    if (originalEnd === undefined) delete process.env.LAUNCH_PROMOTION_END_AT;
    else process.env.LAUNCH_PROMOTION_END_AT = originalEnd;
  });

  it("does not qualify activity before public launch", () => {
    expect(launchPromotionIsActive(new Date(LAUNCH_PROMOTION_START.getTime() - 1))).toBe(false);
  });

  it("qualifies launch activity while no end date has been configured", () => {
    delete process.env.LAUNCH_PROMOTION_END_AT;
    expect(launchPromotionIsActive(LAUNCH_PROMOTION_START)).toBe(true);
  });

  it("stops awards after the configured end without changing history", () => {
    process.env.LAUNCH_PROMOTION_END_AT = "2026-08-31T23:59:59.999Z";
    expect(launchPromotionIsActive(new Date("2026-08-31T23:00:00.000Z"))).toBe(true);
    expect(launchPromotionIsActive(new Date("2026-09-01T00:00:00.000Z"))).toBe(false);
  });
});
