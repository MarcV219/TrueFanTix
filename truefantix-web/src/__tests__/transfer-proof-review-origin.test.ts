/** @jest-environment node */

import {
  TRANSFER_PROOF_REVIEW_STAGING_ORIGIN,
  TRANSFER_PROOF_REVIEW_TEST_ORIGIN,
  canonicalTransferProofReviewOrigin,
} from "@/lib/orders/transferProofReviewDelivery";

describe("transfer-proof review origin binding", () => {
  it("derives the fixed disposable-test origin without caller input", () => {
    expect(canonicalTransferProofReviewOrigin({ NODE_ENV: "test" }))
      .toBe(TRANSFER_PROOF_REVIEW_TEST_ORIGIN);
    expect(canonicalTransferProofReviewOrigin({
      NODE_ENV: "production",
      PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-test",
      PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-test",
      APP_ORIGIN: TRANSFER_PROOF_REVIEW_TEST_ORIGIN,
    })).toBe(TRANSFER_PROOF_REVIEW_TEST_ORIGIN);
  });

  it("derives the fixed isolated-preview origin from matching configuration", () => {
    expect(canonicalTransferProofReviewOrigin({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      APP_ORIGIN: TRANSFER_PROOF_REVIEW_STAGING_ORIGIN,
      NEXT_PUBLIC_APP_URL: TRANSFER_PROOF_REVIEW_STAGING_ORIGIN,
    })).toBe(TRANSFER_PROOF_REVIEW_STAGING_ORIGIN);
  });

  it("refuses cross-environment application configuration", () => {
    expect(() => canonicalTransferProofReviewOrigin({
      NODE_ENV: "test",
      APP_ORIGIN: "https://www.truefantix.com",
    })).toThrow("does not match the isolated-test identity");
    expect(() => canonicalTransferProofReviewOrigin({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      APP_ORIGIN: TRANSFER_PROOF_REVIEW_STAGING_ORIGIN,
      NEXT_PUBLIC_APP_URL: "https://www.truefantix.com",
    })).toThrow("does not match the isolated-preview identity");
  });
});
