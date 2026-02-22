export type ProviderVerificationInput = {
  eventId?: string | null;
  title?: string | null;
  venue?: string;
  date?: string;
  barcodeHash?: string | null;
  barcodeType?: string | null;
};

export type ProviderVerificationResult = {
  confirmed: boolean;
  confidence: number;
  reason: string;
  provider: string;
};

/**
 * Public-document validation profile (no private issuer integration required).
 * This is NOT a cryptographic ticket authenticity proof; it is a risk-scoring layer.
 */
export async function verifyWithProvider(
  input: ProviderVerificationInput
): Promise<ProviderVerificationResult> {
  let confidence = 0;
  const reasons: string[] = [];

  const title = String(input.title ?? "").trim();
  const venue = String(input.venue ?? "").trim();
  const date = String(input.date ?? "").trim();

  if (input.eventId) {
    confidence += 25;
    reasons.push("Event linked");
  }

  if (title.length >= 8) {
    confidence += 15;
  } else {
    reasons.push("Short/weak title");
  }

  if (venue.length >= 4) {
    confidence += 15;
  } else {
    reasons.push("Missing/weak venue");
  }

  // Basic temporal sanity check from public-listing style date strings
  const parsed = new Date(date);
  if (date && !Number.isNaN(parsed.getTime())) {
    confidence += 15;
    const now = Date.now();
    const twoYearsMs = 1000 * 60 * 60 * 24 * 365 * 2;
    if (parsed.getTime() < now - 1000 * 60 * 60 * 24) {
      reasons.push("Event date appears in the past");
      confidence -= 10;
    }
    if (parsed.getTime() > now + twoYearsMs) {
      reasons.push("Event date very far in future");
      confidence -= 5;
    }
  } else {
    reasons.push("Unparseable date");
  }

  if (input.barcodeHash) {
    confidence += 20;
  } else {
    reasons.push("No barcode evidence");
  }

  if (input.barcodeType) {
    confidence += 5;
  }

  const suspiciousPatterns = [
    /parking pass/i,
    /test(ing)? ticket/i,
    /placeholder/i,
    /tbd/i,
  ];
  if (suspiciousPatterns.some((r) => r.test(title) || r.test(venue))) {
    confidence -= 20;
    reasons.push("Suspicious listing metadata");
  }

  confidence = Math.max(0, Math.min(100, confidence));

  return {
    confirmed: confidence >= 70,
    confidence,
    reason: reasons.length ? reasons.join("; ") : "Public validation checks passed",
    provider: "public-doc-rules-v1",
  };
}
