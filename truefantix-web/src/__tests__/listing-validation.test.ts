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
  it("allows listings at official face value", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      action: "list",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.maxListPriceCents).toBe(10000);
  });

  it("allows listings below official face value", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      priceCents: 9500,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
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
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("OFFICIAL_FACE_VALUE_MISMATCH");
      expect(result.message).toContain("We found a different official face value");
    }
  });

  it("returns a venue-specific error when the official match has a different venue", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({
        found: false,
        officialFaceValueCents: null,
        reason: "venue-not-confirmed",
        officialVenueName: "Scotiabank Arena",
      }),
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("OFFICIAL_EVENT_VENUE_MISMATCH");
      expect(result.message).toContain("Official venue found: Scotiabank Arena");
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
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("OFFICIAL_EVENT_DATE_MISMATCH");
      expect(result.message).toContain("not for the date you entered");
    }
  });

  it("rejects receipt-entered face value when official face value is unavailable", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({ officialFaceValueCents: null }),
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("OFFICIAL_FACE_VALUE_NOT_CONFIRMED");
  });

  it("rejects service fees until receipt fee verification exists", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      priceCents: 11250,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 1250,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SERVICE_FEES_NOT_VERIFIED");
  });

  it("requires receipt proof and seller confirmation", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: false,
      sellerConfirmedReceiptValues: false,
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("RECEIPT_PROOF_REQUIRED");
  });
});
