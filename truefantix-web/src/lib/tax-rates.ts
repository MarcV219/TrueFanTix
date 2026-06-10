export type TaxRegionRate = {
  countryCode: "CA" | "US";
  regionCode: string;
  regionName: string;
  rateBps: number;
  label: string;
  gstRateBps?: number;
  provincialTaxRateBps?: number;
  provincialTaxLabel?: "PST" | "RST" | "QST";
  hstRateBps?: number;
  totalRateBps?: number;
};

export type AdminFeeTax = TaxRegionRate & {
  taxCents: number;
};

const BPS_DENOMINATOR = 10_000;

// Canada GST/PST/RST/QST/HST rates reviewed 2026-06-10.
// Sources:
// - CRA GST/HST and PST rates by province:
//   https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html
// - Revenu Quebec QST rate:
//   https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/basic-rules-for-applying-the-gsthst-and-qst/
// - BC PST rate:
//   https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst
// - Manitoba RST rate:
//   https://www.gov.mb.ca/finance/taxation/taxes/retail.html
// - Saskatchewan PST rate:
//   https://www.saskatchewan.ca/business/taxes-licensing-and-reporting/provincial-taxes-policies-and-bulletins/provincial-sales-tax
export const CANADA_TAX_RATES: Record<string, TaxRegionRate> = {
  AB: { countryCode: "CA", regionCode: "AB", regionName: "Alberta", rateBps: 500, label: "GST", gstRateBps: 500, totalRateBps: 500 },
  BC: { countryCode: "CA", regionCode: "BC", regionName: "British Columbia", rateBps: 1200, label: "GST/PST", gstRateBps: 500, provincialTaxRateBps: 700, provincialTaxLabel: "PST", totalRateBps: 1200 },
  MB: { countryCode: "CA", regionCode: "MB", regionName: "Manitoba", rateBps: 1200, label: "GST/RST", gstRateBps: 500, provincialTaxRateBps: 700, provincialTaxLabel: "RST", totalRateBps: 1200 },
  NB: { countryCode: "CA", regionCode: "NB", regionName: "New Brunswick", rateBps: 1500, label: "HST", hstRateBps: 1500, totalRateBps: 1500 },
  NL: { countryCode: "CA", regionCode: "NL", regionName: "Newfoundland and Labrador", rateBps: 1500, label: "HST", hstRateBps: 1500, totalRateBps: 1500 },
  NS: { countryCode: "CA", regionCode: "NS", regionName: "Nova Scotia", rateBps: 1400, label: "HST", hstRateBps: 1400, totalRateBps: 1400 },
  NT: { countryCode: "CA", regionCode: "NT", regionName: "Northwest Territories", rateBps: 500, label: "GST", gstRateBps: 500, totalRateBps: 500 },
  NU: { countryCode: "CA", regionCode: "NU", regionName: "Nunavut", rateBps: 500, label: "GST", gstRateBps: 500, totalRateBps: 500 },
  ON: { countryCode: "CA", regionCode: "ON", regionName: "Ontario", rateBps: 1300, label: "HST", hstRateBps: 1300, totalRateBps: 1300 },
  PE: { countryCode: "CA", regionCode: "PE", regionName: "Prince Edward Island", rateBps: 1500, label: "HST", hstRateBps: 1500, totalRateBps: 1500 },
  QC: { countryCode: "CA", regionCode: "QC", regionName: "Quebec", rateBps: 1498, label: "GST/QST", gstRateBps: 500, provincialTaxRateBps: 997.5, provincialTaxLabel: "QST", totalRateBps: 1497.5 },
  SK: { countryCode: "CA", regionCode: "SK", regionName: "Saskatchewan", rateBps: 1100, label: "GST/PST", gstRateBps: 500, provincialTaxRateBps: 600, provincialTaxLabel: "PST", totalRateBps: 1100 },
  YT: { countryCode: "CA", regionCode: "YT", regionName: "Yukon", rateBps: 500, label: "GST", gstRateBps: 500, totalRateBps: 500 },
};

// U.S. standard state-level sales/use tax rates from Sales Tax Institute,
// as of 2026-06-01, reviewed 2026-06-05. Local add-ons are intentionally excluded.
// Source: https://www.salestaxinstitute.com/resources/rates
export const US_TAX_RATES: Record<string, TaxRegionRate> = {
  AL: { countryCode: "US", regionCode: "AL", regionName: "Alabama", rateBps: 400, label: "Sales tax" },
  AK: { countryCode: "US", regionCode: "AK", regionName: "Alaska", rateBps: 0, label: "Sales tax" },
  AZ: { countryCode: "US", regionCode: "AZ", regionName: "Arizona", rateBps: 560, label: "Sales tax" },
  AR: { countryCode: "US", regionCode: "AR", regionName: "Arkansas", rateBps: 650, label: "Sales tax" },
  CA: { countryCode: "US", regionCode: "CA", regionName: "California", rateBps: 725, label: "Sales tax" },
  CO: { countryCode: "US", regionCode: "CO", regionName: "Colorado", rateBps: 290, label: "Sales tax" },
  CT: { countryCode: "US", regionCode: "CT", regionName: "Connecticut", rateBps: 635, label: "Sales tax" },
  DC: { countryCode: "US", regionCode: "DC", regionName: "District of Columbia", rateBps: 600, label: "Sales tax" },
  DE: { countryCode: "US", regionCode: "DE", regionName: "Delaware", rateBps: 0, label: "Sales tax" },
  FL: { countryCode: "US", regionCode: "FL", regionName: "Florida", rateBps: 600, label: "Sales tax" },
  GA: { countryCode: "US", regionCode: "GA", regionName: "Georgia", rateBps: 400, label: "Sales tax" },
  HI: { countryCode: "US", regionCode: "HI", regionName: "Hawaii", rateBps: 400, label: "Sales tax" },
  IA: { countryCode: "US", regionCode: "IA", regionName: "Iowa", rateBps: 600, label: "Sales tax" },
  ID: { countryCode: "US", regionCode: "ID", regionName: "Idaho", rateBps: 600, label: "Sales tax" },
  IL: { countryCode: "US", regionCode: "IL", regionName: "Illinois", rateBps: 625, label: "Sales tax" },
  IN: { countryCode: "US", regionCode: "IN", regionName: "Indiana", rateBps: 700, label: "Sales tax" },
  KS: { countryCode: "US", regionCode: "KS", regionName: "Kansas", rateBps: 650, label: "Sales tax" },
  KY: { countryCode: "US", regionCode: "KY", regionName: "Kentucky", rateBps: 600, label: "Sales tax" },
  LA: { countryCode: "US", regionCode: "LA", regionName: "Louisiana", rateBps: 500, label: "Sales tax" },
  MA: { countryCode: "US", regionCode: "MA", regionName: "Massachusetts", rateBps: 625, label: "Sales tax" },
  MD: { countryCode: "US", regionCode: "MD", regionName: "Maryland", rateBps: 600, label: "Sales tax" },
  ME: { countryCode: "US", regionCode: "ME", regionName: "Maine", rateBps: 550, label: "Sales tax" },
  MI: { countryCode: "US", regionCode: "MI", regionName: "Michigan", rateBps: 600, label: "Sales tax" },
  MN: { countryCode: "US", regionCode: "MN", regionName: "Minnesota", rateBps: 688, label: "Sales tax" },
  MO: { countryCode: "US", regionCode: "MO", regionName: "Missouri", rateBps: 423, label: "Sales tax" },
  MS: { countryCode: "US", regionCode: "MS", regionName: "Mississippi", rateBps: 700, label: "Sales tax" },
  MT: { countryCode: "US", regionCode: "MT", regionName: "Montana", rateBps: 0, label: "Sales tax" },
  NC: { countryCode: "US", regionCode: "NC", regionName: "North Carolina", rateBps: 475, label: "Sales tax" },
  ND: { countryCode: "US", regionCode: "ND", regionName: "North Dakota", rateBps: 500, label: "Sales tax" },
  NE: { countryCode: "US", regionCode: "NE", regionName: "Nebraska", rateBps: 550, label: "Sales tax" },
  NH: { countryCode: "US", regionCode: "NH", regionName: "New Hampshire", rateBps: 0, label: "Sales tax" },
  NJ: { countryCode: "US", regionCode: "NJ", regionName: "New Jersey", rateBps: 663, label: "Sales tax" },
  NM: { countryCode: "US", regionCode: "NM", regionName: "New Mexico", rateBps: 488, label: "Sales tax" },
  NV: { countryCode: "US", regionCode: "NV", regionName: "Nevada", rateBps: 685, label: "Sales tax" },
  NY: { countryCode: "US", regionCode: "NY", regionName: "New York", rateBps: 400, label: "Sales tax" },
  OH: { countryCode: "US", regionCode: "OH", regionName: "Ohio", rateBps: 575, label: "Sales tax" },
  OK: { countryCode: "US", regionCode: "OK", regionName: "Oklahoma", rateBps: 450, label: "Sales tax" },
  OR: { countryCode: "US", regionCode: "OR", regionName: "Oregon", rateBps: 0, label: "Sales tax" },
  PA: { countryCode: "US", regionCode: "PA", regionName: "Pennsylvania", rateBps: 600, label: "Sales tax" },
  RI: { countryCode: "US", regionCode: "RI", regionName: "Rhode Island", rateBps: 700, label: "Sales tax" },
  SC: { countryCode: "US", regionCode: "SC", regionName: "South Carolina", rateBps: 600, label: "Sales tax" },
  SD: { countryCode: "US", regionCode: "SD", regionName: "South Dakota", rateBps: 420, label: "Sales tax" },
  TN: { countryCode: "US", regionCode: "TN", regionName: "Tennessee", rateBps: 700, label: "Sales tax" },
  TX: { countryCode: "US", regionCode: "TX", regionName: "Texas", rateBps: 625, label: "Sales tax" },
  UT: { countryCode: "US", regionCode: "UT", regionName: "Utah", rateBps: 485, label: "Sales tax" },
  VA: { countryCode: "US", regionCode: "VA", regionName: "Virginia", rateBps: 430, label: "Sales tax" },
  VT: { countryCode: "US", regionCode: "VT", regionName: "Vermont", rateBps: 600, label: "Sales tax" },
  WA: { countryCode: "US", regionCode: "WA", regionName: "Washington", rateBps: 650, label: "Sales tax" },
  WI: { countryCode: "US", regionCode: "WI", regionName: "Wisconsin", rateBps: 500, label: "Sales tax" },
  WV: { countryCode: "US", regionCode: "WV", regionName: "West Virginia", rateBps: 600, label: "Sales tax" },
  WY: { countryCode: "US", regionCode: "WY", regionName: "Wyoming", rateBps: 400, label: "Sales tax" },
};

function normalizeCountry(value: string | null | undefined): "CA" | "US" | "" {
  const upper = String(value ?? "").trim().toUpperCase();
  if (upper === "CA" || upper === "CANADA") return "CA";
  if (upper === "US" || upper === "USA" || upper === "UNITED STATES" || upper === "UNITED STATES OF AMERICA") return "US";
  return "";
}

function normalizeRegion(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
}

const CITY_REGION: Record<string, { countryCode: "CA" | "US"; regionCode: string }> = {
  austin: { countryCode: "US", regionCode: "TX" },
  barrie: { countryCode: "CA", regionCode: "ON" },
  boston: { countryCode: "US", regionCode: "MA" },
  buffalo: { countryCode: "US", regionCode: "NY" },
  calgary: { countryCode: "CA", regionCode: "AB" },
  chicago: { countryCode: "US", regionCode: "IL" },
  edmonton: { countryCode: "CA", regionCode: "AB" },
  "las vegas": { countryCode: "US", regionCode: "NV" },
  "los angeles": { countryCode: "US", regionCode: "CA" },
  miami: { countryCode: "US", regionCode: "FL" },
  montreal: { countryCode: "CA", regionCode: "QC" },
  "new york": { countryCode: "US", regionCode: "NY" },
  orchardpark: { countryCode: "US", regionCode: "NY" },
  "orchard park": { countryCode: "US", regionCode: "NY" },
  ottawa: { countryCode: "CA", regionCode: "ON" },
  seattle: { countryCode: "US", regionCode: "WA" },
  toronto: { countryCode: "CA", regionCode: "ON" },
  vancouver: { countryCode: "CA", regionCode: "BC" },
};

const REGION_CODES = new Set([
  ...Object.keys(CANADA_TAX_RATES),
  ...Object.keys(US_TAX_RATES),
]);

function normalizeCityKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getTaxRateForRegion(
  country: string | null | undefined,
  region: string | null | undefined
): TaxRegionRate | null {
  const countryCode = normalizeCountry(country);
  const regionCode = normalizeRegion(region);
  if (!countryCode || !regionCode) return null;
  return countryCode === "CA" ? CANADA_TAX_RATES[regionCode] ?? null : US_TAX_RATES[regionCode] ?? null;
}

export function getTaxRateForVenue(venue: string | null | undefined): TaxRegionRate | null {
  const rawVenue = String(venue ?? "").trim();
  if (!rawVenue) return null;

  const lowerVenue = rawVenue.toLowerCase();
  const countryHint = lowerVenue.includes("canada")
    ? "CA"
    : lowerVenue.includes("united states") || lowerVenue.includes(" usa")
      ? "US"
      : "";

  const regionMatch = rawVenue.match(/(?:^|[\s,])([A-Z]{2})(?:[\s,]|$)/g);
  if (regionMatch?.length) {
    const code = normalizeRegion(regionMatch[regionMatch.length - 1]);
    if (REGION_CODES.has(code)) {
      return getTaxRateForRegion(countryHint || (CANADA_TAX_RATES[code] ? "CA" : "US"), code);
    }
  }

  const parts = rawVenue.split(",").map((part) => normalizeCityKey(part)).filter(Boolean);
  for (const part of parts.reverse()) {
    const mapped = CITY_REGION[part] ?? CITY_REGION[part.replace(/\s/g, "")];
    if (mapped) return getTaxRateForRegion(mapped.countryCode, mapped.regionCode);
  }

  return null;
}

export function calculateAdminFeeTax(adminFeeCents: number, rate: TaxRegionRate | null): AdminFeeTax {
  if (!rate) {
    return {
      countryCode: "CA",
      regionCode: "",
      regionName: "",
      rateBps: 0,
      label: "Tax",
      taxCents: 0,
    };
  }

  return {
    ...rate,
    taxCents: Math.round((adminFeeCents * rate.rateBps) / BPS_DENOMINATOR),
  };
}

export function formatTaxRate(rateBps: number): string {
  const percent = rateBps / 100;
  if (Number.isInteger(percent)) return `${percent}%`;
  return `${percent.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
}
