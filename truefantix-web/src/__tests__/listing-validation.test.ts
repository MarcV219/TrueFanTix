import { validateListingPriceAgainstOfficial } from "@/lib/tickets/listingValidation";
import type { OfficialSnapshot } from "@/lib/officialPricing";
import type { ReceiptOcrReview } from "@/lib/tickets/receiptOcr";

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

function receipt(overrides: Partial<ReceiptOcrReview> = {}): ReceiptOcrReview {
  return {
    ok: true,
    status: "verified",
    provider: "openai",
    model: "test-model",
    reason: null,
    hasPurchaseReceipt: true,
    hasTickets: true,
    eventTitle: "Example Event",
    artistOrTeam: "Example Event",
    venue: "Example Venue",
    eventDate: "2026-10-20",
    eventTime: "7:00 PM",
    ticketQuantity: 1,
    seats: [{ section: null, row: "12", seat: "8" }],
    faceValueCents: 10000,
    totalFaceValueCents: 10000,
    serviceFeesCents: 0,
    totalServiceFeesCents: 0,
    currency: "USD",
    confidence: 0.9,
    rawTextSummary: "Example Event receipt",
    ...overrides,
  };
}

describe("listing validation", () => {
  it("allows listings at official face value", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "12",
      sellerSeat: "8",
      purchaseQuantity: 1,
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt(),
      action: "list",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.maxListPriceCents).toBe(10000);
  });

  it("allows listings below official face value", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "12",
      sellerSeat: "8",
      purchaseQuantity: 1,
      priceCents: 9500,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt(),
      action: "list",
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a different seller-entered face value with a clear mismatch", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({ officialFaceValueCents: 9500 }),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "12",
      sellerSeat: "8",
      purchaseQuantity: 1,
      priceCents: 9500,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt(),
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("OFFICIAL_FACE_VALUE_MISMATCH");
      expect(result.details?.sourceIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "OFFICIAL_FACE_VALUE_MISMATCH",
            entered: "$100.00",
            found: "$95.00",
          }),
        ])
      );
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
      sellerTitle: "Toronto Raptors vs Boston Celtics",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Wrong Venue, Toronto",
      sellerRow: "12",
      sellerSeat: "8",
      purchaseQuantity: 1,
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({
        eventTitle: "Toronto Raptors vs Boston Celtics",
        venue: "Wrong Venue, Toronto",
      }),
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
      sellerTitle: "Example Event",
      sellerDate: "2026-10-21 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "12",
      sellerSeat: "8",
      purchaseQuantity: 1,
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({ eventDate: "2026-10-21" }),
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("OFFICIAL_EVENT_DATE_MISMATCH");
      expect(result.message).toContain("not for the date you entered");
    }
  });

  it("allows receipt-confirmed face value when official face value is unavailable", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({ officialFaceValueCents: null }),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "12",
      sellerSeat: "8",
      purchaseQuantity: 1,
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt(),
      action: "list",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.faceValueCents).toBe(10000);
      expect(result.faceValueSource).toBe("receipt");
      expect(result.maxListPriceCents).toBe(10000);
    }
  });

  it("allows receipt-confirmed pricing when Ticketmaster has no event match", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({ found: false, officialFaceValueCents: null, reason: "no-event-match" }),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "12",
      sellerSeat: "8",
      purchaseQuantity: 1,
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt(),
      action: "list",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.faceValueSource).toBe("receipt");
  });

  it("still blocks when Ticketmaster finds a conflicting event detail", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({
        found: false,
        officialFaceValueCents: null,
        reason: "date-not-confirmed",
        officialEventDate: "2026-10-21",
      }),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "12",
      sellerSeat: "8",
      purchaseQuantity: 1,
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt(),
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("OFFICIAL_EVENT_DATE_MISMATCH");
  });

  it("shows receipt price cap warnings when official face value is unavailable", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({ officialFaceValueCents: null }),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "12",
      sellerSeat: "8",
      purchaseQuantity: 1,
      priceCents: 12500,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 1250,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({
        serviceFeesCents: 1250,
        totalServiceFeesCents: 1250,
      }),
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("PRICE_ABOVE_RECEIPT_FACE_VALUE_WITH_FEES");
      expect(result.details?.sourceIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "PRICE_ABOVE_RECEIPT_FACE_VALUE_WITH_FEES",
            entered: "$125.00",
            found: "$112.50",
          }),
        ])
      );
    }
  });

  it("accepts general admission seating when receipt has no row or seat details", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "General Admission",
      sellerSeat: "",
      purchaseQuantity: 1,
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({
        seats: [],
      }),
      action: "list",
    });

    expect(result.ok).toBe(true);
  });

  it("accepts seller row and seat when receipt OCR places them across section and row", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "N",
      sellerSeat: "13",
      purchaseQuantity: 1,
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({
        seats: [{ section: "N", row: "13", seat: null }],
      }),
      action: "list",
    });

    expect(result.ok).toBe(true);
  });

  it("reports missing receipt dates as not found instead of mismatched", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "12",
      sellerSeat: "8",
      purchaseQuantity: 1,
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({
        eventDate: null,
      }),
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details?.sourceIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "RECEIPT_DATE_NOT_FOUND",
            message: "Receipt date was not found on the uploaded proof.",
          }),
        ])
      );
    }
  });

  it("allows service fees when receipt OCR verifies the same fees", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "12",
      sellerSeat: "8",
      purchaseQuantity: 1,
      priceCents: 11250,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 1250,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({
        serviceFeesCents: 1250,
        totalServiceFeesCents: 1250,
      }),
      action: "list",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.maxListPriceCents).toBe(11250);
  });

  it("shows source-provided service fee differences when available", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({ officialServiceFeesCents: 900, officialServiceFeeSource: "ticketmaster-checkout" }),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "12",
      sellerSeat: "8",
      purchaseQuantity: 1,
      priceCents: 11250,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 1250,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({
        serviceFeesCents: 1250,
        totalServiceFeesCents: 1250,
      }),
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("OFFICIAL_SERVICE_FEES_MISMATCH");
      expect(result.details?.officialServiceFeesCents).toBe(900);
      expect(result.details?.sourceIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "OFFICIAL_SERVICE_FEES_MISMATCH",
            entered: "$12.50",
            found: "$9.00",
          }),
        ])
      );
    }
  });

  it("rejects service fees when receipt OCR cannot verify the same fees", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "12",
      sellerSeat: "8",
      purchaseQuantity: 1,
      priceCents: 11250,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 1250,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt(),
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("RECEIPT_SERVICE_FEES_MISMATCH");
  });

  it("requires receipt proof and seller confirmation", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "12",
      sellerSeat: "8",
      purchaseQuantity: 1,
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: false,
      sellerConfirmedReceiptValues: false,
      receiptReview: null,
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("RECEIPT_PROOF_REQUIRED");
  });
});
