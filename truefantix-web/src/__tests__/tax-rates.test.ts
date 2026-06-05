import {
  calculateAdminFeeTax,
  formatTaxRate,
  getTaxRateForRegion,
  getTaxRateForVenue,
} from "@/lib/tax-rates";

describe("tax rates", () => {
  it("resolves Canadian GST/HST rates by province", () => {
    expect(getTaxRateForRegion("CA", "ON")).toMatchObject({ label: "HST", rateBps: 1300 });
    expect(getTaxRateForRegion("Canada", "NS")).toMatchObject({ label: "HST", rateBps: 1400 });
    expect(getTaxRateForRegion("CA", "BC")).toMatchObject({ label: "GST", rateBps: 500 });
  });

  it("resolves U.S. state rates", () => {
    expect(getTaxRateForRegion("US", "CA")).toMatchObject({ regionName: "California", rateBps: 725 });
    expect(getTaxRateForRegion("USA", "NY")).toMatchObject({ regionName: "New York", rateBps: 400 });
    expect(getTaxRateForRegion("US", "OR")).toMatchObject({ regionName: "Oregon", rateBps: 0 });
  });

  it("infers tax region from event venue text", () => {
    expect(getTaxRateForVenue("BMO Field, Toronto, ON")).toMatchObject({ regionCode: "ON", rateBps: 1300 });
    expect(getTaxRateForVenue("Madison Square Garden, New York, NY")).toMatchObject({ regionCode: "NY", rateBps: 400 });
  });

  it("calculates tax on the admin fee only", () => {
    const rate = getTaxRateForRegion("CA", "ON");
    expect(calculateAdminFeeTax(875, rate).taxCents).toBe(114);
  });

  it("formats tax rates for display", () => {
    expect(formatTaxRate(1300)).toBe("13%");
    expect(formatTaxRate(725)).toBe("7.25%");
  });
});
