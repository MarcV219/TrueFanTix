import { getPrimaryPreflight, requirePrimaryPreflight } from "@/lib/primary/config";
import { createPrimaryAdmissionInternalCapability } from "@/lib/primary/admission-service";
import { createPrimaryOrderInternalCapability } from "@/lib/primary/order-service";
import { requirePrimaryStripePublishableTestKey, requirePrimaryStripeTestConfig } from "@/lib/primary/payment-service";

function previewEnv(overrides: Record<string, string> = {}) {
  return {
    NODE_ENV: "production",
    PRIMARY_TICKETING_ENABLED: "true",
    PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-preview",
    PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-preview",
    VERCEL_ENV: "preview",
    DATABASE_URL: "postgresql://example.invalid/primary_preview",
    PRIMARY_TICKETING_DATABASE_URL: "postgresql://example.invalid/primary_preview",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe("primary pilot safety boundaries", () => {
  test("isolated Preview can issue only opaque internal service capabilities", () => {
    const capability = requirePrimaryPreflight(previewEnv());
    expect(createPrimaryOrderInternalCapability(capability)).toEqual({ kind: "PrimaryOrderInternalCapability" });
    expect(createPrimaryAdmissionInternalCapability(capability)).toEqual({ kind: "PrimaryAdmissionInternalCapability" });
  });

  test("Stripe configuration accepts test keys and rejects every live-key mix", () => {
    const capability = requirePrimaryPreflight(previewEnv());
    expect(requirePrimaryStripePublishableTestKey(capability, previewEnv({ PRIMARY_STRIPE_PUBLISHABLE_KEY: "pk_test_synthetic" }))).toBe("pk_test_synthetic");
    expect(() => requirePrimaryStripePublishableTestKey(capability, previewEnv({ PRIMARY_STRIPE_PUBLISHABLE_KEY: "pk_live_forbidden" }))).toThrow("STRIPE_TEST_PREFLIGHT_REQUIRED");
    expect(() => requirePrimaryStripeTestConfig(capability, previewEnv({ PRIMARY_STRIPE_SECRET_KEY: "sk_live_forbidden", PRIMARY_STRIPE_WEBHOOK_SECRET: "whsec_test" }))).toThrow("STRIPE_TEST_PREFLIGHT_REQUIRED");
  });

  test("Production identity remains unavailable even with otherwise valid test configuration", () => {
    expect(getPrimaryPreflight(previewEnv({ VERCEL_ENV: "production" }))).toEqual({ enabled: true, ready: false, reason: "LIVE_PRODUCTION_FORBIDDEN" });
  });
});
