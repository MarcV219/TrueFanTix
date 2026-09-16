/** @jest-environment node */

import {
  SELLER_ONBOARDING_PRODUCTION_ORIGIN,
  SELLER_ONBOARDING_STAGING_ORIGIN,
  SELLER_ONBOARDING_TEST_ORIGIN,
  canonicalSellerOnboardingOrigin,
} from "@/lib/sellers/ordinary-onboarding";

describe("seller onboarding canonical origin", () => {
  it("binds isolated test, preview, and production identities to exact HTTPS origins", () => {
    expect(canonicalSellerOnboardingOrigin({
      NODE_ENV: "test",
      APP_ORIGIN: SELLER_ONBOARDING_TEST_ORIGIN,
      NEXT_PUBLIC_APP_URL: SELLER_ONBOARDING_TEST_ORIGIN,
    })).toBe(SELLER_ONBOARDING_TEST_ORIGIN);
    expect(canonicalSellerOnboardingOrigin({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      APP_ORIGIN: SELLER_ONBOARDING_STAGING_ORIGIN,
    })).toBe(SELLER_ONBOARDING_STAGING_ORIGIN);
    expect(canonicalSellerOnboardingOrigin({
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      NEXT_PUBLIC_APP_URL: SELLER_ONBOARDING_PRODUCTION_ORIGIN,
    })).toBe(SELLER_ONBOARDING_PRODUCTION_ORIGIN);
  });

  it("rejects missing, mismatched, hostile, and cross-environment configuration", () => {
    expect(() => canonicalSellerOnboardingOrigin({ NODE_ENV: "test" }))
      .toThrow("requires one matching configured application origin");
    expect(() => canonicalSellerOnboardingOrigin({
      NODE_ENV: "test",
      APP_ORIGIN: SELLER_ONBOARDING_TEST_ORIGIN,
      NEXT_PUBLIC_APP_URL: "https://hostile.example",
    })).toThrow("requires one matching configured application origin");
    expect(() => canonicalSellerOnboardingOrigin({
      NODE_ENV: "test",
      APP_ORIGIN: "http://seller-onboarding.test.invalid",
    })).toThrow("Invalid seller-onboarding application origin");
    expect(() => canonicalSellerOnboardingOrigin({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      APP_ORIGIN: SELLER_ONBOARDING_PRODUCTION_ORIGIN,
    })).toThrow("does not match the isolated-preview identity");
    expect(() => canonicalSellerOnboardingOrigin({
      NODE_ENV: "production",
      APP_ORIGIN: SELLER_ONBOARDING_PRODUCTION_ORIGIN,
    })).toThrow("requires a recognized deployment identity");
  });
});
