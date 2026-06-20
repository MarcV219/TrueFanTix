import type { OfficialSnapshot } from "@/lib/officialPricing";

type ListingValidationInput = {
  official: OfficialSnapshot;
  priceCents: number;
  sellerFaceValueCents: number | null;
  adminFeePaidCents: number;
  action: "list" | "update";
};

type ListingValidationResult =
  | { ok: true; officialFaceValueCents: number; maxListPriceCents: number }
  | { ok: false; error: string; message: string };

export function centsToDisplay(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function validateListingPriceAgainstOfficial({
  official,
  priceCents,
  sellerFaceValueCents,
  adminFeePaidCents,
  action,
}: ListingValidationInput): ListingValidationResult {
  const verb = action === "list" ? "list this ticket" : "update this ticket";
  const notChanged = action === "list" ? "The tickets were not listed." : "The listing was not updated.";

  if (!official.found) {
    if (official.reason === "date-not-confirmed") {
      return {
        ok: false,
        error: "OFFICIAL_EVENT_DATE_MISMATCH",
        message: `We found a possible official event match, but not for the date you entered. ${notChanged} Check the event date and start time, then try again.`,
      };
    }

    if (official.reason === "title-not-confirmed" || official.reason === "teams-not-confirmed") {
      return {
        ok: false,
        error: "OFFICIAL_EVENT_DETAILS_MISMATCH",
        message: `We found official event data, but it did not match the event details you entered. ${notChanged} Check the artist/team names, opponent, venue, and date.`,
      };
    }

    return {
      ok: false,
      error: "OFFICIAL_EVENT_NOT_CONFIRMED",
      message: `We could not confirm this event with an official primary-market source. ${notChanged} Please request the event be added or try again with the official event details.`,
    };
  }

  if (official.officialFaceValueCents == null) {
    return {
      ok: false,
      error: "OFFICIAL_FACE_VALUE_NOT_CONFIRMED",
      message: `We confirmed the event, but could not confirm its official face value. ${notChanged} Listings need a confirmed face value before they can go live.`,
    };
  }

  if (sellerFaceValueCents != null && sellerFaceValueCents !== official.officialFaceValueCents) {
    return {
      ok: false,
      error: "OFFICIAL_FACE_VALUE_MISMATCH",
      message: `We found a different official face value: ${centsToDisplay(official.officialFaceValueCents)}. You entered ${centsToDisplay(sellerFaceValueCents)}. ${notChanged} Update the face value to match the official amount.`,
    };
  }

  const normalizedAdminFeePaidCents = Math.max(0, adminFeePaidCents);
  const maxListPriceCents = official.officialFaceValueCents + normalizedAdminFeePaidCents;

  if (priceCents > maxListPriceCents) {
    return {
      ok: false,
      error: "PRICE_ABOVE_FACE_VALUE_WITH_FEES",
      message: `This listing is above the allowed maximum. Confirmed face value is ${centsToDisplay(official.officialFaceValueCents)} plus ${centsToDisplay(normalizedAdminFeePaidCents)} in admin fees paid, so the highest list price is ${centsToDisplay(maxListPriceCents)}. Lower the price to ${verb}.`,
    };
  }

  return {
    ok: true,
    officialFaceValueCents: official.officialFaceValueCents,
    maxListPriceCents,
  };
}
