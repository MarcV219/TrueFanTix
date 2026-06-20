import type { OfficialSnapshot } from "@/lib/officialPricing";

type ListingValidationInput = {
  official: OfficialSnapshot;
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
  sellerFaceValueCents: number | null;
  adminFeePaidCents: number;
  maxListPriceCents: number | null;
  receiptRequired: boolean;
  sellerConfirmationRequired: boolean;
};

export function centsToDisplay(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function validateListingPriceAgainstOfficial({
  official,
  priceCents,
  sellerFaceValueCents,
  adminFeePaidCents,
  hasReceiptProof,
  sellerConfirmedReceiptValues,
  action,
}: ListingValidationInput): ListingValidationResult {
  const verb = action === "list" ? "list this ticket" : "update this ticket";
  const notChanged = action === "list" ? "The tickets were not listed." : "The listing was not updated.";
  const normalizedAdminFeePaidCents = Math.max(0, adminFeePaidCents);

  const details = (officialFaceValueCents: number | null): ListingPricingDetails => ({
    officialFaceValueCents,
    sellerFaceValueCents,
    adminFeePaidCents: normalizedAdminFeePaidCents,
    maxListPriceCents:
      officialFaceValueCents != null
        ? officialFaceValueCents
        : sellerFaceValueCents != null
        ? sellerFaceValueCents + normalizedAdminFeePaidCents
        : null,
    receiptRequired: !hasReceiptProof,
    sellerConfirmationRequired: !sellerConfirmedReceiptValues,
  });

  if (!hasReceiptProof || !sellerConfirmedReceiptValues) {
    return {
      ok: false,
      error: "RECEIPT_PROOF_REQUIRED",
      message: `${notChanged} Upload the original purchase receipt and confirm it shows the event, tickets, face value, and service fees paid.`,
      details: details(official.officialFaceValueCents),
    };
  }

  if (!official.found) {
    if (official.reason === "date-not-confirmed") {
      return {
        ok: false,
        error: "OFFICIAL_EVENT_DATE_MISMATCH",
        message: `We found a possible official event match, but not for the date you entered. ${notChanged} Check the event date and start time, then try again.`,
        details: details(official.officialFaceValueCents),
      };
    }

    if (official.reason === "title-not-confirmed" || official.reason === "teams-not-confirmed") {
      return {
        ok: false,
        error: "OFFICIAL_EVENT_DETAILS_MISMATCH",
        message: `We found official event data, but it did not match the event details you entered. ${notChanged} Check the artist/team names, opponent, venue, and date.`,
        details: details(official.officialFaceValueCents),
      };
    }

    if (official.reason === "venue-not-confirmed") {
      const officialVenue = official.officialVenueName ? ` Official venue found: ${official.officialVenueName}.` : "";
      return {
        ok: false,
        error: "OFFICIAL_EVENT_VENUE_MISMATCH",
        message: `We found a possible official event match, but not for the venue you entered.${officialVenue} ${notChanged} Update the venue to match the official ticketing source.`,
        details: details(official.officialFaceValueCents),
      };
    }

    return {
      ok: false,
      error: "OFFICIAL_EVENT_NOT_CONFIRMED",
      message: `We could not confirm this event with an official primary-market source. ${notChanged} Please request the event be added or try again with the official event details.`,
      details: details(official.officialFaceValueCents),
    };
  }

  if (official.officialFaceValueCents == null) {
    return {
      ok: false,
      error: "OFFICIAL_FACE_VALUE_NOT_CONFIRMED",
      message: `We confirmed the event, but could not confirm its official face value from the official ticketing source. ${notChanged} Seller-entered receipt values cannot be used to override official pricing.`,
      details: details(null),
    };
  }

  if (sellerFaceValueCents != null && sellerFaceValueCents !== official.officialFaceValueCents) {
    return {
      ok: false,
      error: "OFFICIAL_FACE_VALUE_MISMATCH",
      message: `We found a different official face value: ${centsToDisplay(official.officialFaceValueCents)}. You entered ${centsToDisplay(sellerFaceValueCents)}. ${notChanged} Confirm the official amount against your receipt and update the face value to match.`,
      details: details(official.officialFaceValueCents),
    };
  }

  if (normalizedAdminFeePaidCents > 0) {
    return {
      ok: false,
      error: "SERVICE_FEES_NOT_VERIFIED",
      message: `${notChanged} Service fees paid above face value must be verified from the uploaded receipt before they can increase the allowed list price. Set service fees paid to $0 to list at or below the official face value, or wait for receipt review support.`,
      details: details(official.officialFaceValueCents),
    };
  }

  const maxListPriceCents = official.officialFaceValueCents;

  if (priceCents > maxListPriceCents) {
    return {
      ok: false,
      error: "PRICE_ABOVE_FACE_VALUE_WITH_FEES",
      message: `This listing is above the allowed maximum. Confirmed face value is ${centsToDisplay(official.officialFaceValueCents)}. Service fees have not been verified, so the highest list price is ${centsToDisplay(maxListPriceCents)}. Lower the price to ${verb}.`,
      details: details(official.officialFaceValueCents),
    };
  }

  return {
    ok: true,
    faceValueCents: official.officialFaceValueCents,
    faceValueSource: "official",
    maxListPriceCents,
  };
}
