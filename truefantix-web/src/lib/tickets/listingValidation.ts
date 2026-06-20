import type { OfficialSnapshot } from "@/lib/officialPricing";

type ListingValidationInput = {
  official: OfficialSnapshot;
  sellerTitle: string;
  sellerDate: string;
  sellerVenue: string;
  priceCents: number;
  sellerFaceValueCents: number | null;
  adminFeePaidCents: number;
  hasReceiptProof: boolean;
  sellerConfirmedReceiptValues: boolean;
  action: "list" | "update";
};

type ListingValidationResult =
  | { ok: true; faceValueCents: number; faceValueSource: "official"; maxListPriceCents: number }
  | { ok: false; error: string; message: string; details?: ListingPricingDetails };

export type ListingPricingDetails = {
  officialFaceValueCents: number | null;
  officialEventTitle: string | null;
  officialEventDate: string | null;
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
  field: "title" | "venue" | "date" | "faceValue" | "serviceFees" | "listPrice" | "receipt";
  source: "Ticketmaster" | "Receipt";
  entered: string | null;
  found: string | null;
  message: string;
};

export function centsToDisplay(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function validateListingPriceAgainstOfficial({
  official,
  sellerTitle,
  sellerDate,
  sellerVenue,
  priceCents,
  sellerFaceValueCents,
  adminFeePaidCents,
  hasReceiptProof,
  sellerConfirmedReceiptValues,
  action,
}: ListingValidationInput): ListingValidationResult {
  const notChanged = action === "list" ? "The tickets were not listed." : "The listing was not updated.";
  const normalizedAdminFeePaidCents = Math.max(0, adminFeePaidCents);

  const details = (officialFaceValueCents: number | null, sourceIssues: ListingSourceIssue[] = []): ListingPricingDetails => ({
    officialFaceValueCents,
    officialEventTitle: official.officialEventTitle ?? null,
    officialEventDate: official.officialEventDate ?? null,
    officialVenueName: official.officialVenueName ?? null,
    sourceUrl: official.sourceUrl ?? null,
    sellerFaceValueCents,
    adminFeePaidCents: normalizedAdminFeePaidCents,
    maxListPriceCents: officialFaceValueCents,
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

  if (normalizedAdminFeePaidCents > 0) {
    receiptIssues.push({
      code: "SERVICE_FEES_NOT_VERIFIED",
      field: "serviceFees",
      source: "Receipt",
      entered: centsToDisplay(normalizedAdminFeePaidCents),
      found: null,
      message: "Service fees paid above face value must be verified from the uploaded receipt before they can increase the allowed list price.",
    });
  }

  if (!hasReceiptProof || !sellerConfirmedReceiptValues) {
    return {
      ok: false,
      error: "RECEIPT_PROOF_REQUIRED",
      message: `${notChanged} Upload the original purchase receipt and confirm it shows the event, tickets, face value, and service fees paid.`,
      details: details(official.officialFaceValueCents, receiptIssues),
    };
  }

  if (!official.found) {
    if (official.reason === "date-not-confirmed") {
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
      ];

      return {
        ok: false,
        error: "OFFICIAL_EVENT_VENUE_MISMATCH",
        message: `We found a possible official event match, but not for the venue you entered.${officialVenue} ${notChanged} Update the venue to match the official ticketing source.`,
        details: details(official.officialFaceValueCents, issues),
      };
    }

    return {
      ok: false,
      error: "OFFICIAL_EVENT_NOT_CONFIRMED",
      message: `We could not confirm this event with an official primary-market source. ${notChanged} Please request the event be added or try again with the official event details.`,
      details: details(official.officialFaceValueCents, receiptIssues),
    };
  }

  if (official.officialFaceValueCents == null) {
    const issues = [
      {
        code: "OFFICIAL_FACE_VALUE_NOT_CONFIRMED",
        field: "faceValue",
        source: "Ticketmaster",
        entered: sellerFaceValueCents == null ? null : centsToDisplay(sellerFaceValueCents),
        found: null,
        message: "Ticketmaster confirmed the event but did not provide official face value.",
      } satisfies ListingSourceIssue,
      ...receiptIssues,
    ];

    return {
      ok: false,
      error: "OFFICIAL_FACE_VALUE_NOT_CONFIRMED",
      message: `We confirmed the event, but could not confirm its official face value from the official ticketing source. ${notChanged} Seller-entered receipt values cannot be used to override official pricing.`,
      details: details(null, issues),
    };
  }

  const issues: ListingSourceIssue[] = [...receiptIssues];

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

  const maxListPriceCents = official.officialFaceValueCents;

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
