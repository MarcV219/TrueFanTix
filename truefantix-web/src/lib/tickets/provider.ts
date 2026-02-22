export type ProviderVerificationInput = {
  eventId?: string | null;
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

// Stub adapter. Replace with Ticketmaster/AXS/venue integrations when available.
export async function verifyWithProvider(
  _input: ProviderVerificationInput
): Promise<ProviderVerificationResult> {
  return {
    confirmed: false,
    confidence: 0,
    reason: "No issuer provider integration configured yet",
    provider: "provider-stub",
  };
}
