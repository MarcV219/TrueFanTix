import { validateListingPriceAgainstOfficial } from "@/lib/tickets/listingValidation";
import type { OfficialSnapshot } from "@/lib/officialPricing";

function official(overrides: Partial<OfficialSnapshot> = {}): OfficialSnapshot {
  return {
    found: true,
    vendor: "ticketmaster",
    officialFaceValueCents: 10000,
    soldOut: false,
    sourceUrl: "https://example.com/event",
    ...overrides,
  };
}

describe("listing validation", () => {
  it("allows face value plus admin fees paid", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      priceCents: 11250,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 1250,
      action: "list",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.maxListPriceCents).toBe(11250);
  });

  it("allows listings below face value plus admin fees paid", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      priceCents: 9500,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 1250,
      action: "list",
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a different seller-entered face value with a clear mismatch", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({ officialFaceValueCents: 9500 }),
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("OFFICIAL_FACE_VALUE_MISMATCH");
      expect(result.message).toContain("We found a different official face value");
    }
  });

  it("returns a date-specific error when the official match has a different date", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({
        found: false,
        officialFaceValueCents: null,
        reason: "date-not-confirmed",
      }),
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("OFFICIAL_EVENT_DATE_MISMATCH");
      expect(result.message).toContain("not for the date you entered");
    }
  });
});
