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

  it("returns a date-specific error when neither Ticketmaster nor the receipt confirms the submitted date", () => {
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
      receiptReview: receipt({ eventDate: null }),
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

  it("does not keep ticket-confirmation warnings when receipt summary clearly proves tickets", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({ officialFaceValueCents: 8500 }),
      sellerTitle: "Ice Cube",
      sellerDate: "2026-06-26 9:00 PM",
      sellerVenue: "Casino Rama Resort",
      sellerRow: "N",
      sellerSeat: "14",
      purchaseQuantity: 3,
      priceCents: 9715,
      sellerFaceValueCents: 8500,
      adminFeePaidCents: 1365,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({
        hasTickets: false,
        eventTitle: "Ice Cube",
        venue: "Casino Rama Resort",
        eventDate: "2026-06-26",
        eventTime: "9:00 PM",
        ticketQuantity: 3,
        seats: [{ section: "N", row: "13", seat: null }],
        faceValueCents: 8500,
        totalFaceValueCents: 25500,
        serviceFeesCents: 1215,
        totalServiceFeesCents: 3645,
        rawTextSummary:
          "Ticketmaster page for Ice Cube at Casino Rama Resort, Rama, ON. Visible date/time: Fri Jun 26, 9:00 PM. Selected location Sec N, Row 13. Quantity 3 Standard Adult Tickets at CA $97.15 each. Subtotal CA $295.95 including taxes: Tickets CA $291.45 + Order Processing Fee CA $4.50. Breakdown shows Face Value CA $255.00, Service Fee CA $36.45, Order Processing Fee CA $4.50.",
      }),
      action: "list",
    });

    expect(result.ok).toBe(true);
  });

  it("allows listing fewer tickets than the receipt quantity purchased", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({ officialFaceValueCents: 8500 }),
      sellerTitle: "Ice Cube",
      sellerDate: "2026-06-26 9:00 PM",
      sellerVenue: "Casino Rama Resort",
      sellerRow: "N",
      sellerSeat: "14",
      purchaseQuantity: 1,
      priceCents: 9865,
      sellerFaceValueCents: 8500,
      adminFeePaidCents: 1365,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({
        eventTitle: "Ice Cube",
        venue: "Casino Rama Resort",
        eventDate: "2026-06-26",
        eventTime: "9:00 PM",
        ticketQuantity: 3,
        seats: [{ section: "N", row: "13", seat: null }],
        faceValueCents: 8500,
        totalFaceValueCents: 25500,
        totalServiceFeesCents: 4095,
        currency: "CAD",
      }),
      sellerCurrency: "CAD",
      action: "list",
    });

    expect(result.ok).toBe(true);
  });

  it.each([
    { receiptQuantity: 1, listingQuantity: 1 },
    { receiptQuantity: 2, listingQuantity: 1 },
    { receiptQuantity: 5, listingQuantity: 3 },
    { receiptQuantity: 12, listingQuantity: 11 },
    { receiptQuantity: 20, listingQuantity: 20 },
  ])(
    "allows listing $listingQuantity ticket(s) when the receipt proves $receiptQuantity purchased",
    ({ receiptQuantity, listingQuantity }) => {
      const result = validateListingPriceAgainstOfficial({
        official: official({ officialFaceValueCents: 8500 }),
        sellerTitle: "Ice Cube",
        sellerDate: "2026-06-26 9:00 PM",
        sellerVenue: "Casino Rama Resort",
        sellerRow: "N",
        sellerSeat: "14",
        purchaseQuantity: listingQuantity,
        priceCents: 9865,
        sellerFaceValueCents: 8500,
        adminFeePaidCents: 1365,
        hasReceiptProof: true,
        sellerConfirmedReceiptValues: true,
        receiptReview: receipt({
          eventTitle: "Ice Cube",
          venue: "Casino Rama Resort",
          eventDate: "2026-06-26",
          eventTime: "9:00 PM",
          ticketQuantity: receiptQuantity,
          seats: [{ section: "N", row: "13", seat: null }],
          faceValueCents: 8500,
          totalFaceValueCents: 8500 * receiptQuantity,
          totalServiceFeesCents: 1365 * receiptQuantity,
          currency: "CAD",
        }),
        sellerCurrency: "CAD",
        action: "list",
      });

      expect(result.ok).toBe(true);
    },
  );

  it.each([
    { receiptQuantity: 1, listingQuantity: 2 },
    { receiptQuantity: 4, listingQuantity: 5 },
    { receiptQuantity: 10, listingQuantity: 12 },
  ])(
    "blocks listing $listingQuantity ticket(s) when the receipt only proves $receiptQuantity purchased",
    ({ receiptQuantity, listingQuantity }) => {
      const result = validateListingPriceAgainstOfficial({
        official: official({ officialFaceValueCents: 8500 }),
        sellerTitle: "Ice Cube",
        sellerDate: "2026-06-26 9:00 PM",
        sellerVenue: "Casino Rama Resort",
        sellerRow: "N",
        sellerSeat: "14",
        purchaseQuantity: listingQuantity,
        priceCents: 9865,
        sellerFaceValueCents: 8500,
        adminFeePaidCents: 1365,
        hasReceiptProof: true,
        sellerConfirmedReceiptValues: true,
        receiptReview: receipt({
          eventTitle: "Ice Cube",
          venue: "Casino Rama Resort",
          eventDate: "2026-06-26",
          eventTime: "9:00 PM",
          ticketQuantity: receiptQuantity,
          seats: [{ section: "N", row: "13", seat: null }],
          faceValueCents: 8500,
          totalFaceValueCents: 8500 * receiptQuantity,
          totalServiceFeesCents: 1365 * receiptQuantity,
          currency: "CAD",
        }),
        sellerCurrency: "CAD",
        action: "list",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.details?.sourceIssues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "RECEIPT_QUANTITY_MISMATCH",
              message: "Receipt confirms fewer tickets than the number being listed.",
            }),
          ]),
        );
      }
    },
  );

  it("blocks listing more tickets than the receipt quantity purchased", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({ officialFaceValueCents: 8500 }),
      sellerTitle: "Ice Cube",
      sellerDate: "2026-06-26 9:00 PM",
      sellerVenue: "Casino Rama Resort",
      sellerRow: "N",
      sellerSeat: "14",
      purchaseQuantity: 4,
      priceCents: 9865,
      sellerFaceValueCents: 8500,
      adminFeePaidCents: 1365,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({
        eventTitle: "Ice Cube",
        venue: "Casino Rama Resort",
        eventDate: "2026-06-26",
        eventTime: "9:00 PM",
        ticketQuantity: 3,
        seats: [{ section: "N", row: "13", seat: null }],
        faceValueCents: 8500,
        totalFaceValueCents: 25500,
        totalServiceFeesCents: 4095,
        currency: "CAD",
      }),
      sellerCurrency: "CAD",
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details?.sourceIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "RECEIPT_QUANTITY_MISMATCH",
            message: "Receipt confirms fewer tickets than the number being listed.",
          }),
        ]),
      );
    }
  });

  it("includes order processing fees in receipt-confirmed service fees", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({ officialFaceValueCents: 8500 }),
      sellerTitle: "Ice Cube",
      sellerDate: "2026-06-26 9:00 PM",
      sellerVenue: "Casino Rama Resort",
      sellerRow: "N",
      sellerSeat: "14",
      purchaseQuantity: 3,
      priceCents: 9865,
      sellerFaceValueCents: 8500,
      adminFeePaidCents: 1365,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({
        eventTitle: "Ice Cube",
        venue: "Casino Rama Resort",
        eventDate: "2026-06-26",
        eventTime: "9:00 PM",
        ticketQuantity: 3,
        seats: [{ section: "N", row: "13", seat: null }],
        faceValueCents: 8500,
        totalFaceValueCents: 25500,
        serviceFeesCents: 1215,
        totalServiceFeesCents: 3645,
        rawTextSummary:
          "Tickets CA $291.45 + Order Processing Fee CA $4.50. Breakdown shows Face Value CA $255.00, Service Fee CA $36.45, Order Processing Fee CA $4.50.",
      }),
      action: "list",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.maxListPriceCents).toBe(9865);
  });

  it("does not add parsed processing fees again when OCR already returned all fees", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({ officialFaceValueCents: 8500 }),
      sellerTitle: "Ice Cube",
      sellerDate: "2026-06-26 9:00 PM",
      sellerVenue: "Casino Rama Resort",
      sellerRow: "N",
      sellerSeat: "14",
      purchaseQuantity: 3,
      priceCents: 9865,
      sellerFaceValueCents: 8500,
      adminFeePaidCents: 1365,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({
        eventTitle: "Ice Cube",
        venue: "Casino Rama Resort",
        eventDate: "2026-06-26",
        eventTime: "9:00 PM",
        ticketQuantity: 3,
        seats: [{ section: "N", row: "13", seat: null }],
        faceValueCents: 8500,
        totalFaceValueCents: 25500,
        serviceFeesCents: 1365,
        totalServiceFeesCents: 4095,
        rawTextSummary:
          "Tickets CA $291.45 + Order Processing Fee CA $4.50. Breakdown shows Face Value CA $255.00, Service Fee CA $36.45, Order Processing Fee CA $4.50.",
      }),
      action: "list",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.maxListPriceCents).toBe(9865);
  });

  it("includes multiple receipt admin fee types in the max list price", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({ officialFaceValueCents: 8500 }),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "N",
      sellerSeat: "14",
      purchaseQuantity: 2,
      priceCents: 10150,
      sellerFaceValueCents: 8500,
      adminFeePaidCents: 1650,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({
        ticketQuantity: 2,
        seats: [{ section: "N", row: "13", seat: null }],
        faceValueCents: 8500,
        totalFaceValueCents: 17000,
        serviceFeesCents: 1000,
        totalServiceFeesCents: 2000,
        rawTextSummary:
          "Service Fee CA $20.00. Order Processing Fee CA $5.00. Facility Fee CA $4.00. Delivery Fee CA $4.00. Order Processing Fee CA $5.00.",
      }),
      action: "list",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.maxListPriceCents).toBe(10150);
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

  it("does not require receipt date or time when Ticketmaster confirms the submitted event timing", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({
        officialEventDate: "2026-10-20",
        officialEventTime: "7:00 PM",
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
      receiptReview: receipt({
        eventDate: null,
        eventTime: null,
      }),
      action: "list",
    });

    expect(result.ok).toBe(true);
  });

  it("allows receipt-confirmed event timing when Ticketmaster cannot confirm the submitted date", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({
        found: false,
        officialFaceValueCents: null,
        reason: "date-not-confirmed",
        officialEventDate: "2026-10-21",
        officialEventTime: "7:00 PM",
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
      receiptReview: receipt({
        eventDate: "2026-10-20",
        eventTime: "7:00 PM",
      }),
      action: "list",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.faceValueSource).toBe("receipt");
  });

  it("still blocks when Ticketmaster finds a conflicting date and the receipt does not confirm the submitted date", () => {
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
      receiptReview: receipt({ eventDate: null }),
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

  it("accepts seller seat numbers when receipt confirms section or row but omits explicit seats", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "N",
      sellerSeat: "14",
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

  it("accepts seller section and seat when receipt confirms section but omits explicit seats", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerSection: "N",
      sellerRow: "",
      sellerSeat: "14",
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

  it("accepts an individual seller seat inside an explicit receipt seat range", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official({ officialFaceValueCents: 30000 }),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerSection: "429",
      sellerRow: "34",
      sellerSeat: "3",
      purchaseQuantity: 1,
      priceCents: 35700,
      sellerCurrency: "USD",
      sellerFaceValueCents: 30000,
      adminFeePaidCents: 5700,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({
        seats: [{ section: "429", row: "34", seat: "3-6" }],
        faceValueCents: 30000,
        totalFaceValueCents: 30000,
        serviceFeesCents: 5700,
        totalServiceFeesCents: 5700,
        currency: "USD",
      }),
      action: "list",
    });

    expect(result.ok).toBe(true);
  });

  it("still rejects seating when receipt includes an explicit different seat", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "N",
      sellerSeat: "14",
      purchaseQuantity: 1,
      priceCents: 10000,
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({
        seats: [{ section: "N", row: "13", seat: "15" }],
      }),
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("RECEIPT_SEATING_MISMATCH");
      expect(result.details?.sourceIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "RECEIPT_SEATING_MISMATCH",
            message: "Receipt seating shows a different seat. Update the row/seat to match the receipt, or upload proof for the seat being listed.",
          }),
        ])
      );
    }
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

  it("rejects selected listing currency when the receipt shows a different currency", () => {
    const result = validateListingPriceAgainstOfficial({
      official: official(),
      sellerTitle: "Example Event",
      sellerDate: "2026-10-20 7:00 PM",
      sellerVenue: "Example Venue",
      sellerRow: "12",
      sellerSeat: "8",
      purchaseQuantity: 1,
      priceCents: 10000,
      sellerCurrency: "CAD",
      sellerFaceValueCents: 10000,
      adminFeePaidCents: 0,
      hasReceiptProof: true,
      sellerConfirmedReceiptValues: true,
      receiptReview: receipt({ currency: "USD" }),
      action: "list",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("RECEIPT_CURRENCY_MISMATCH");
      expect(result.details?.sourceIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "RECEIPT_CURRENCY_MISMATCH",
            entered: "CAD",
            found: "USD",
          }),
        ])
      );
    }
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
