import {
  calculateAdminFeeTax,
  formatTaxRate,
  getTaxRateForRegion,
  getTaxRateForVenue,
} from "@/lib/tax-rates";

describe("tax rates", () => {
  it("resolves Canadian GST/HST rates by province", () => {
    expect(getTaxRateForRegion("CA", "ON")).toMatchObject({ label: "HST", rateBps: 1300, taxExempt: true });
    expect(getTaxRateForRegion("Canada", "NS")).toMatchObject({ label: "HST", rateBps: 1400 });
    expect(getTaxRateForRegion("CA", "BC")).toMatchObject({
      label: "GST/PST",
      rateBps: 1200,
      gstRateBps: 500,
      provincialTaxRateBps: 700,
      provincialTaxLabel: "PST",
      totalRateBps: 1200,
      collectionRateBps: 0,
      taxExempt: true,
    });
    expect(getTaxRateForRegion("CA", "MB")).toMatchObject({ label: "GST/RST", provincialTaxLabel: "RST", totalRateBps: 1200 });
    expect(getTaxRateForRegion("CA", "QC")).toMatchObject({ label: "GST/QST", provincialTaxLabel: "QST", totalRateBps: 1497.5 });
    expect(getTaxRateForRegion("CA", "SK")).toMatchObject({ label: "GST/PST", provincialTaxLabel: "PST", totalRateBps: 1100 });
  });

  it("resolves U.S. state rates", () => {
    expect(getTaxRateForRegion("US", "CA")).toMatchObject({
      regionName: "California",
      rateBps: 725,
      collectionRateBps: 0,
      taxExempt: true,
    });
    expect(getTaxRateForRegion("US", "CA")?.taxExemptionReason).toContain("$500,000 in sales");
    expect(getTaxRateForRegion("USA", "NY")?.taxExemptionReason).toContain("$500,000 in sales and 100 transactions");
    expect(getTaxRateForRegion("US", "AK")?.taxExemptionReason).toContain("participating local jurisdictions");
    expect(getTaxRateForRegion("US", "OR")).toMatchObject({ regionName: "Oregon", rateBps: 0, taxExempt: true });
  });

  it("infers tax region from event venue text", () => {
    expect(getTaxRateForVenue("BMO Field, Toronto, ON")).toMatchObject({ regionCode: "ON", rateBps: 1300 });
    expect(getTaxRateForVenue("Madison Square Garden, New York, NY")).toMatchObject({ regionCode: "NY", rateBps: 400 });
  });

  it("calculates tax on the admin fee only", () => {
    expect(calculateAdminFeeTax(875, {
      countryCode: "US",
      regionCode: "CA",
      regionName: "California",
      rateBps: 725,
      label: "Sales tax",
    }).taxCents).toBe(63);
  });

  it("does not collect tax for exempt regions", () => {
    const rate = getTaxRateForRegion("CA", "ON");
    expect(calculateAdminFeeTax(875, rate)).toMatchObject({
      label: "Tax exempt",
      rateBps: 0,
      taxCents: 0,
      taxExempt: true,
      totalRateBps: 1300,
    });
  });

  it("formats tax rates for display", () => {
    expect(formatTaxRate(1300)).toBe("13%");
    expect(formatTaxRate(725)).toBe("7.25%");
    expect(formatTaxRate(997.5)).toBe("9.975%");
    expect(formatTaxRate(1497.5)).toBe("14.975%");
  });
});
