import type { OfficialSnapshot } from "@/lib/officialPricing";
import type { ReceiptOcrReview } from "@/lib/tickets/receiptOcr";

type ListingValidationInput = {
  official: OfficialSnapshot;
  sellerTitle: string;
  sellerDate: string;
  sellerVenue: string;
  sellerRow: string | null;
  sellerSeat: string | null;
  purchaseQuantity: number;
  priceCents: number;
  sellerFaceValueCents: number | null;
  adminFeePaidCents: number;
  hasReceiptProof: boolean;
  sellerConfirmedReceiptValues: boolean;
  receiptReview: ReceiptOcrReview | null;
  action: "list" | "update";
};

type ListingValidationResult =
  | { ok: true; faceValueCents: number; faceValueSource: "official" | "receipt"; maxListPriceCents: number }
  | { ok: false; error: string; message: string; details?: ListingPricingDetails };

export type ListingPricingDetails = {
  officialFaceValueCents: number | null;
  officialPriceRangeMinCents: number | null;
  officialPriceRangeMaxCents: number | null;
  officialServiceFeesCents: number | null;
  officialServiceFeeSource: string | null;
  officialStatusCode: string | null;
  soldOut: boolean | null;
  soldOutSource: string | null;
  officialEventTitle: string | null;
  officialEventDate: string | null;
  officialEventTime: string | null;
  officialVenueName: string | null;
  sourceUrl: string | null;
  sellerFaceValueCents: number | null;
  adminFeePaidCents: number;
  maxListPriceCents: number | null;
  receiptRequired: boolean;
  sellerConfirmationRequired: boolean;
  sourceIssues: ListingSourceIssue[];
};

export type ListingSourceIssue = {
  code: string;
  field: "title" | "venue" | "date" | "time" | "faceValue" | "serviceFees" | "listPrice" | "receipt" | "quantity" | "seating";
  source: "Ticketmaster" | "Receipt";
  entered: string | null;
  found: string | null;
  message: string;
};

export function centsToDisplay(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !new Set(["the", "and", "vs", "at", "tickets", "ticket", "receipt"]).has(token));
}

function overlap(a: string | null | undefined, b: string | null | undefined): number {
  const aa = Array.from(new Set(tokenize(a ?? "")));
  const bb = new Set(tokenize(b ?? ""));
  if (!aa.length || !bb.size) return 0;
  let hits = 0;
  for (const token of aa) if (bb.has(token)) hits += 1;
  return hits / aa.length;
}

function ymd(value: string | null | undefined): string | null {
  if (!value) return null;
  const direct = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function timeMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3]?.toUpperCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (period === "PM" && hour < 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function sellerTimeFromDate(value: string): string | null {
  return value.match(/\d{1,2}:\d{2}\s*(AM|PM)/i)?.[0] ?? null;
}

function sameMoney(a: number | null | undefined, b: number | null | undefined) {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1;
}

function sellerDateConfirmedByTicketmaster(official: OfficialSnapshot, sellerDate: string) {
  const officialYmd = ymd(official.officialEventDate);
  const sellerYmd = ymd(sellerDate);
  return official.found && !!officialYmd && !!sellerYmd && officialYmd === sellerYmd;
}

function sellerTimeConfirmedByTicketmaster(official: OfficialSnapshot, sellerDate: string) {
  const officialMinutes = timeMinutes(official.officialEventTime);
  const sellerMinutes = timeMinutes(sellerTimeFromDate(sellerDate));
  return official.found && officialMinutes != null && sellerMinutes != null && Math.abs(officialMinutes - sellerMinutes) <= 15;
}

function sellerDateConfirmedByReceipt(receiptReview: ReceiptOcrReview | null, sellerDate: string) {
  const sellerYmd = ymd(sellerDate);
  const receiptYmd = ymd(receiptReview?.eventDate);
  return !!sellerYmd && !!receiptYmd && sellerYmd === receiptYmd;
}

function sellerTimeConfirmedByReceipt(receiptReview: ReceiptOcrReview | null, sellerDate: string) {
  const sellerMinutes = timeMinutes(sellerTimeFromDate(sellerDate));
  const receiptMinutes = timeMinutes(receiptReview?.eventTime);
  return sellerMinutes != null && receiptMinutes != null && Math.abs(sellerMinutes - receiptMinutes) <= 15;
}

function isBlockingOfficialConflict(reason: string | null | undefined) {
  return reason === "date-not-confirmed" ||
    reason === "title-not-confirmed" ||
    reason === "teams-not-confirmed" ||
    reason === "venue-not-confirmed";
}

function seatText(row: string | null | undefined, seat: string | null | undefined) {
  return [row ? `Row ${row}` : null, seat ? `Seat ${seat}` : null].filter(Boolean).join(" ");
}

function receiptSeatText(section: string | null | undefined, row: string | null | undefined, seat: string | null | undefined) {
  return [section ? `Section ${section}` : null, row ? `Row ${row}` : null, seat ? `Seat ${seat}` : null].filter(Boolean).join(" ");
}

function receiptSeatingMismatchMessage(receipt: ReceiptOcrReview) {
  const hasExplicitSeat = receipt.seats.some((item) => !!normalizeSeatPart(item.seat));
  if (hasExplicitSeat) {
    return "Receipt seating shows a different seat. Update the row/seat to match the receipt, or upload proof for the seat being listed.";
  }
  if (receipt.seats.length) {
    return "Receipt seating only shows section/row, not individual seat numbers. Enter a row or seat value that matches the receipt section/row, or upload proof that shows the exact seat.";
  }
  return "Receipt seating was not found. Upload proof that shows the listed row/seat, or choose General Admission if there are no assigned seats.";
}

function isGeneralAdmissionText(value: string | null | undefined) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  return /\b(ga|general admission|standing room|standing|floor)\b/.test(normalized);
}

function normalizeSeatPart(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function receiptHasSeat(receipt: ReceiptOcrReview, sellerRow: string | null, sellerSeat: string | null) {
  const row = normalizeSeatPart(sellerRow);
  const seat = normalizeSeatPart(sellerSeat);
  if (!row && !seat) return true;
  if (isGeneralAdmissionText(row) && !seat) {
    if (!receipt.seats.length) return true;
    return receipt.seats.some((item) => {
      return (
        isGeneralAdmissionText(item.section) ||
        isGeneralAdmissionText(item.row) ||
        isGeneralAdmissionText(item.seat)
      );
    });
  }
  return receipt.seats.some((item) => {
    const receiptParts = [item.section, item.row, item.seat].map(normalizeSeatPart).filter(Boolean);
    const receiptHasExplicitSeat = !!normalizeSeatPart(item.seat);
    if (!receiptHasExplicitSeat) {
      // Some Ticketmaster receipts show only Sec/Row, not individual seat numbers.
      // Treat the seating area as confirmed when the seller-entered row or seat matches
      // the receipt section/row, and do not block on a seat number the receipt omitted.
      return Boolean([row, seat].filter(Boolean).some((part) => receiptParts.includes(part)));
    }
    return (!row || receiptParts.includes(row)) && (!seat || receiptParts.includes(seat));
  });
}

export function validateListingPriceAgainstOfficial({
  official,
  sellerTitle,
  sellerDate,
  sellerVenue,
  sellerRow,
  sellerSeat,
  purchaseQuantity,
  priceCents,
  sellerFaceValueCents,
  adminFeePaidCents,
  hasReceiptProof,
  sellerConfirmedReceiptValues,
  receiptReview,
  action,
}: ListingValidationInput): ListingValidationResult {
  const notChanged = action === "list" ? "The tickets were not listed." : "The listing was not updated.";
  const normalizedAdminFeePaidCents = Math.max(0, adminFeePaidCents);
  let verifiedServiceFeesCents = 0;
  let receiptFaceValueCents: number | null = null;
  let receiptServiceFeesCents: number | null = null;

  const details = (officialFaceValueCents: number | null, sourceIssues: ListingSourceIssue[] = []): ListingPricingDetails => ({
    officialFaceValueCents,
    officialPriceRangeMinCents: official.officialPriceRangeMinCents ?? null,
    officialPriceRangeMaxCents: official.officialPriceRangeMaxCents ?? null,
    officialServiceFeesCents: official.officialServiceFeesCents ?? null,
    officialServiceFeeSource: official.officialServiceFeeSource ?? null,
    officialStatusCode: official.officialStatusCode ?? null,
    soldOut: official.soldOut ?? null,
    soldOutSource: official.soldOutSource ?? null,
    officialEventTitle: official.officialEventTitle ?? null,
    officialEventDate: official.officialEventDate ?? null,
    officialEventTime: official.officialEventTime ?? null,
    officialVenueName: official.officialVenueName ?? null,
    sourceUrl: official.sourceUrl ?? null,
    sellerFaceValueCents,
    adminFeePaidCents: normalizedAdminFeePaidCents,
    maxListPriceCents: officialFaceValueCents == null ? null : officialFaceValueCents + verifiedServiceFeesCents,
    receiptRequired: !hasReceiptProof,
    sellerConfirmationRequired: !sellerConfirmedReceiptValues,
    sourceIssues,
  });

  const receiptIssues: ListingSourceIssue[] = [];
  if (!hasReceiptProof || !sellerConfirmedReceiptValues) {
    receiptIssues.push({
      code: "RECEIPT_PROOF_REQUIRED",
      field: "receipt",
      source: "Receipt",
      entered: hasReceiptProof ? "Uploaded" : "Missing",
      found: null,
      message: "Upload the original purchase receipt and confirm it shows the event, tickets, face value, and service fees paid.",
    });
  }

  if (hasReceiptProof && sellerConfirmedReceiptValues) {
    if (!receiptReview || receiptReview.status === "unavailable") {
      receiptIssues.push({
        code: "RECEIPT_OCR_UNAVAILABLE",
        field: "receipt",
        source: "Receipt",
        entered: "Uploaded",
        found: null,
        message: "Automated receipt review is unavailable, so the receipt cannot be confirmed yet.",
      });
    } else if (receiptReview.status === "unsupported") {
      receiptIssues.push({
        code: "RECEIPT_OCR_UNSUPPORTED",
        field: "receipt",
        source: "Receipt",
        entered: "Uploaded",
        found: null,
        message: "Automated receipt review supports JPG, PNG, WebP, GIF, and PDF receipt uploads.",
      });
    } else {
      if (!receiptReview.hasPurchaseReceipt) {
        receiptIssues.push({
          code: "RECEIPT_PURCHASE_NOT_CONFIRMED",
          field: "receipt",
          source: "Receipt",
          entered: "Uploaded",
          found: receiptReview.rawTextSummary,
          message: "The uploaded receipt does not clearly show a ticket purchase receipt.",
        });
      }

      if (!receiptReview.hasTickets) {
        receiptIssues.push({
          code: "RECEIPT_TICKETS_NOT_CONFIRMED",
          field: "receipt",
          source: "Receipt",
          entered: "Tickets purchased",
          found: receiptReview.rawTextSummary,
          message: "The uploaded receipt does not clearly confirm tickets were purchased.",
        });
      }

      if (!receiptReview.eventTitle || overlap(sellerTitle, receiptReview.eventTitle) < 0.45) {
        receiptIssues.push({
          code: "RECEIPT_EVENT_MISMATCH",
          field: "title",
          source: "Receipt",
          entered: sellerTitle || null,
          found: receiptReview.eventTitle,
          message: "Receipt event does not match the event entered.",
        });
      }

      if (!receiptReview.venue || overlap(sellerVenue, receiptReview.venue) < 0.45) {
        receiptIssues.push({
          code: "RECEIPT_VENUE_MISMATCH",
          field: "venue",
          source: "Receipt",
          entered: sellerVenue || null,
          found: receiptReview.venue,
          message: "Receipt venue does not match the venue entered.",
        });
      }

      const sellerYmd = ymd(sellerDate);
      const receiptYmd = ymd(receiptReview.eventDate);
      if (!sellerDateConfirmedByTicketmaster(official, sellerDate) && !sellerDateConfirmedByReceipt(receiptReview, sellerDate)) {
        const missingDate = !receiptYmd;
        receiptIssues.push({
          code: missingDate ? "RECEIPT_DATE_NOT_FOUND" : "RECEIPT_DATE_MISMATCH",
          field: "date",
          source: "Receipt",
          entered: sellerYmd,
          found: receiptYmd,
          message: missingDate
            ? "Receipt date was not found on the uploaded proof."
            : "Receipt date does not match the event date entered.",
        });
      }

      const sellerMinutes = timeMinutes(sellerTimeFromDate(sellerDate));
      const receiptMinutes = timeMinutes(receiptReview.eventTime);
      if (!sellerTimeConfirmedByTicketmaster(official, sellerDate) && !sellerTimeConfirmedByReceipt(receiptReview, sellerDate)) {
        const missingTime = receiptMinutes == null;
        receiptIssues.push({
          code: missingTime ? "RECEIPT_TIME_NOT_FOUND" : "RECEIPT_TIME_MISMATCH",
          field: "time",
          source: "Receipt",
          entered: sellerTimeFromDate(sellerDate),
          found: receiptReview.eventTime,
          message: missingTime
            ? "Receipt time was not found on the uploaded proof."
            : "Receipt time does not match the event time entered.",
        });
      }

      if (receiptReview.ticketQuantity == null || receiptReview.ticketQuantity !== purchaseQuantity) {
        receiptIssues.push({
          code: "RECEIPT_QUANTITY_MISMATCH",
          field: "quantity",
          source: "Receipt",
          entered: String(purchaseQuantity),
          found: receiptReview.ticketQuantity == null ? null : String(receiptReview.ticketQuantity),
          message: "Receipt ticket quantity does not match the number of tickets being listed.",
        });
      }

      if (!receiptHasSeat(receiptReview, sellerRow, sellerSeat)) {
        const receiptSeats = receiptReview.seats.map((seat) => receiptSeatText(seat.section, seat.row, seat.seat)).filter(Boolean).join("; ");
        receiptIssues.push({
          code: "RECEIPT_SEATING_MISMATCH",
          field: "seating",
          source: "Receipt",
          entered: seatText(sellerRow, sellerSeat) || null,
          found: receiptSeats || null,
          message: receiptSeatingMismatchMessage(receiptReview),
        });
      }

      receiptFaceValueCents =
        receiptReview.faceValueCents ??
        (receiptReview.totalFaceValueCents != null && receiptReview.ticketQuantity
          ? Math.round(receiptReview.totalFaceValueCents / receiptReview.ticketQuantity)
          : null);
      receiptServiceFeesCents =
        receiptReview.serviceFeesCents ??
        (receiptReview.totalServiceFeesCents != null && receiptReview.ticketQuantity
          ? Math.round(receiptReview.totalServiceFeesCents / receiptReview.ticketQuantity)
          : null);

      if (!sameMoney(receiptFaceValueCents, sellerFaceValueCents)) {
        receiptIssues.push({
          code: "RECEIPT_FACE_VALUE_MISMATCH",
          field: "faceValue",
          source: "Receipt",
          entered: sellerFaceValueCents == null ? null : centsToDisplay(sellerFaceValueCents),
          found: receiptFaceValueCents == null ? null : centsToDisplay(receiptFaceValueCents),
          message: "Receipt face value does not match the face value entered.",
        });
      }

      if (!sameMoney(receiptServiceFeesCents, normalizedAdminFeePaidCents)) {
        receiptIssues.push({
          code: "RECEIPT_SERVICE_FEES_MISMATCH",
          field: "serviceFees",
          source: "Receipt",
          entered: centsToDisplay(normalizedAdminFeePaidCents),
          found: receiptServiceFeesCents == null ? null : centsToDisplay(receiptServiceFeesCents),
          message: "Receipt service fees do not match the service fees entered.",
        });
      } else {
        verifiedServiceFeesCents = normalizedAdminFeePaidCents;
      }
    }
  }

  const receiptVerifiedMaxListPriceCents =
    receiptFaceValueCents != null &&
    sameMoney(receiptFaceValueCents, sellerFaceValueCents) &&
    sameMoney(receiptServiceFeesCents, normalizedAdminFeePaidCents)
      ? receiptFaceValueCents + normalizedAdminFeePaidCents
      : null;

  const receiptPriceIssues: ListingSourceIssue[] =
    receiptVerifiedMaxListPriceCents != null && priceCents > receiptVerifiedMaxListPriceCents
      ? [
          {
            code: "PRICE_ABOVE_RECEIPT_FACE_VALUE_WITH_FEES",
            field: "listPrice",
            source: "Receipt",
            entered: centsToDisplay(priceCents),
            found: centsToDisplay(receiptVerifiedMaxListPriceCents),
            message: "List price is above the face value plus service fees found on the receipt.",
          },
        ]
      : [];

  if (!hasReceiptProof || !sellerConfirmedReceiptValues) {
    return {
      ok: false,
      error: "RECEIPT_PROOF_REQUIRED",
      message: `${notChanged} Upload the original purchase receipt and confirm it shows the event, tickets, face value, and service fees paid.`,
      details: details(official.officialFaceValueCents, receiptIssues),
    };
  }

  if (!official.found && isBlockingOfficialConflict(official.reason)) {
    if (official.reason === "date-not-confirmed") {
      if (sellerDateConfirmedByReceipt(receiptReview, sellerDate)) {
        const issues = [...receiptIssues, ...receiptPriceIssues].filter((issue) => issue.field !== "date");
        if (!issues.length && receiptVerifiedMaxListPriceCents != null && receiptFaceValueCents != null) {
          return {
            ok: true,
            faceValueCents: receiptFaceValueCents,
            faceValueSource: "receipt",
            maxListPriceCents: receiptVerifiedMaxListPriceCents,
          };
        }

        return {
          ok: false,
          error: issues[0]?.code ?? "RECEIPT_PRICING_NOT_CONFIRMED",
          message: issues.length
            ? `${notChanged} We found ${issues.length} receipt difference${issues.length === 1 ? "" : "s"} to review before this listing can go live.`
            : `${notChanged} Ticketmaster did not confirm the event date, but the receipt did. We still could not confirm price and service fees from the receipt.`,
          details: details(receiptFaceValueCents, issues),
        };
      }

      const issues = [
        {
          code: "OFFICIAL_EVENT_DATE_MISMATCH",
          field: "date",
          source: "Ticketmaster",
          entered: sellerDate || null,
          found: official.officialEventDate ?? null,
          message: "Ticketmaster found a possible event, but not for the date entered.",
        } satisfies ListingSourceIssue,
        ...receiptIssues,
        ...receiptPriceIssues,
      ];

      return {
        ok: false,
        error: "OFFICIAL_EVENT_DATE_MISMATCH",
        message: `We found a possible official event match, but not for the date you entered. ${notChanged} Check the event date and start time, then try again.`,
        details: details(official.officialFaceValueCents, issues),
      };
    }

    if (official.reason === "title-not-confirmed" || official.reason === "teams-not-confirmed") {
      const issues = [
        {
          code: "OFFICIAL_EVENT_DETAILS_MISMATCH",
          field: "title",
          source: "Ticketmaster",
          entered: sellerTitle || null,
          found: official.officialEventTitle ?? null,
          message: "Ticketmaster found official event data, but the title/teams did not match what was entered.",
        } satisfies ListingSourceIssue,
        ...receiptIssues,
        ...receiptPriceIssues,
      ];

      return {
        ok: false,
        error: "OFFICIAL_EVENT_DETAILS_MISMATCH",
        message: `We found official event data, but it did not match the event details you entered. ${notChanged} Check the artist/team names, opponent, venue, and date.`,
        details: details(official.officialFaceValueCents, issues),
      };
    }

    if (official.reason === "venue-not-confirmed") {
      const officialVenue = official.officialVenueName ? ` Official venue found: ${official.officialVenueName}.` : "";
      const issues = [
        {
          code: "OFFICIAL_EVENT_VENUE_MISMATCH",
          field: "venue",
          source: "Ticketmaster",
          entered: sellerVenue || null,
          found: official.officialVenueName ?? null,
          message: "Ticketmaster found a possible event, but not for the venue entered.",
        } satisfies ListingSourceIssue,
        ...receiptIssues,
        ...receiptPriceIssues,
      ];

      return {
        ok: false,
        error: "OFFICIAL_EVENT_VENUE_MISMATCH",
        message: `We found a possible official event match, but not for the venue you entered.${officialVenue} ${notChanged} Update the venue to match the official ticketing source.`,
        details: details(official.officialFaceValueCents, issues),
      };
    }
  }

  if (!official.found) {
    const issues = [...receiptIssues, ...receiptPriceIssues];
    if (!issues.length && receiptVerifiedMaxListPriceCents != null && receiptFaceValueCents != null) {
      return {
        ok: true,
        faceValueCents: receiptFaceValueCents,
        faceValueSource: "receipt",
        maxListPriceCents: receiptVerifiedMaxListPriceCents,
      };
    }

    return {
      ok: false,
      error: issues[0]?.code ?? "RECEIPT_PRICING_NOT_CONFIRMED",
      message: issues.length
        ? `${notChanged} We found ${issues.length} receipt difference${issues.length === 1 ? "" : "s"} to review before this listing can go live.`
        : `${notChanged} We could not confirm price and service fees from Ticketmaster or the receipt.`,
      details: details(receiptFaceValueCents, issues),
    };
  }

  if (official.officialFaceValueCents == null) {
    const issues = [...receiptIssues, ...receiptPriceIssues];
    if (!issues.length && receiptVerifiedMaxListPriceCents != null && receiptFaceValueCents != null) {
      return {
        ok: true,
        faceValueCents: receiptFaceValueCents,
        faceValueSource: "receipt",
        maxListPriceCents: receiptVerifiedMaxListPriceCents,
      };
    }

    return {
      ok: false,
      error: issues[0]?.code ?? "RECEIPT_PRICING_NOT_CONFIRMED",
      message: issues.length
        ? `${notChanged} We found ${issues.length} receipt difference${issues.length === 1 ? "" : "s"} to review before this listing can go live.`
        : `${notChanged} Ticketmaster did not provide price data, and the receipt did not confirm face value and service fees.`,
      details: details(receiptFaceValueCents, issues),
    };
  }

  const issues: ListingSourceIssue[] = [...receiptIssues];
  const officialServiceFeesCents = official.officialServiceFeesCents ?? null;

  if (sellerFaceValueCents != null && sellerFaceValueCents !== official.officialFaceValueCents) {
    issues.push({
      code: "OFFICIAL_FACE_VALUE_MISMATCH",
      field: "faceValue",
      source: "Ticketmaster",
      entered: centsToDisplay(sellerFaceValueCents),
      found: centsToDisplay(official.officialFaceValueCents),
      message: "Ticketmaster official face value differs from the face value entered.",
    });
  }

  if (officialServiceFeesCents != null && !sameMoney(officialServiceFeesCents, normalizedAdminFeePaidCents)) {
    issues.push({
      code: "OFFICIAL_SERVICE_FEES_MISMATCH",
      field: "serviceFees",
      source: "Ticketmaster",
      entered: centsToDisplay(normalizedAdminFeePaidCents),
      found: centsToDisplay(officialServiceFeesCents),
      message: "Ticketmaster official service fees differ from the service fees entered.",
    });
  }

  const maxListPriceCents = official.officialFaceValueCents + verifiedServiceFeesCents;

  if (priceCents > maxListPriceCents) {
    issues.push({
      code: "PRICE_ABOVE_OFFICIAL_FACE_VALUE",
      field: "listPrice",
      source: "Ticketmaster",
      entered: centsToDisplay(priceCents),
      found: centsToDisplay(maxListPriceCents),
      message: "List price is above the currently verified maximum from Ticketmaster.",
    });
  }

  if (issues.length > 0) {
    const primary = issues[0];
    const error =
      primary.code === "PRICE_ABOVE_OFFICIAL_FACE_VALUE"
        ? "PRICE_ABOVE_FACE_VALUE_WITH_FEES"
        : primary.code;
    const message =
      issues.length === 1
        ? `${notChanged} ${primary.message}`
        : `${notChanged} We found ${issues.length} source difference${issues.length === 1 ? "" : "s"} to review before this listing can go live.`;

    return {
      ok: false,
      error,
      message,
      details: details(official.officialFaceValueCents, issues),
    };
  }

  return {
    ok: true,
    faceValueCents: official.officialFaceValueCents,
    faceValueSource: "official",
    maxListPriceCents,
  };
}
