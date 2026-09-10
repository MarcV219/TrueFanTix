/** @jest-environment node */
import { getPrimaryPreflight, PrimaryFeatureUnavailableError, requirePrimaryPreflight } from "@/lib/primary/config";

const isolatedEnv = {
  NODE_ENV: "test",
  PRIMARY_TICKETING_ENABLED: "true",
  PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-test",
  PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-test",
  PRIMARY_TICKETING_DATABASE_URL: "postgresql://localhost:5432/primary_ticketing_test",
  DATABASE_URL: "postgresql://localhost:5432/primary_ticketing_test",
} as NodeJS.ProcessEnv;

describe("primary ticketing environment preflight", () => {
  it("fails closed when the feature flag is absent", () => {
    expect(getPrimaryPreflight({ NODE_ENV: "test" })).toEqual({
      enabled: false,
      ready: false,
      reason: "FEATURE_DISABLED",
    });
  });

  it("accepts an explicitly isolated PostgreSQL test database", () => {
    expect(getPrimaryPreflight(isolatedEnv)).toMatchObject({
      enabled: true,
      ready: true,
      environmentId: "isolated-test",
      databaseName: "primary_ticketing_test",
    });
  });

  it("accepts an isolated preview even when the runtime NODE_ENV is production", () => {
    expect(getPrimaryPreflight({
      ...isolatedEnv,
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-preview",
      PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-preview",
      DATABASE_URL: "postgresql://localhost:5432/primary_ticketing_preview",
      PRIMARY_TICKETING_DATABASE_URL: "postgresql://localhost:5432/primary_ticketing_preview",
    })).toMatchObject({ ready: true, environmentId: "isolated-preview" });
  });

  it.each([
    [{ ...isolatedEnv, NODE_ENV: "production", VERCEL_ENV: "production" }, "LIVE_PRODUCTION_FORBIDDEN"],
    [{ ...isolatedEnv, PRIMARY_TICKETING_DEPLOYMENT_ID: "live-production" }, "LIVE_PRODUCTION_FORBIDDEN"],
    [{ ...isolatedEnv, PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-preview" }, "DEPLOYMENT_IDENTITY_MISMATCH"],
    [{ ...isolatedEnv, PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-preview", PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-preview" }, "PREVIEW_IDENTITY_REQUIRED"],
    [{ ...isolatedEnv, PRIMARY_TICKETING_ENVIRONMENT_ID: "development" }, "ISOLATED_ENVIRONMENT_REQUIRED"],
    [{ ...isolatedEnv, PRIMARY_TICKETING_DATABASE_URL: "postgresql://localhost/other" }, "DEDICATED_DATABASE_REQUIRED"],
    [{ ...isolatedEnv, DATABASE_URL: "postgresql://localhost/ordinary_dev", PRIMARY_TICKETING_DATABASE_URL: "postgresql://localhost/ordinary_dev" }, "ISOLATED_DATABASE_NAME_REQUIRED"],
  ])("rejects an unsafe environment", (env, reason) => {
    expect(getPrimaryPreflight(env as NodeJS.ProcessEnv)).toMatchObject({ ready: false, reason });
  });

  it("throws a non-secret-bearing unavailable error", () => {
    expect(() => requirePrimaryPreflight({ NODE_ENV: "test" })).toThrow(PrimaryFeatureUnavailableError);
    try {
      requirePrimaryPreflight({ NODE_ENV: "test" });
    } catch (error) {
      expect(error).toMatchObject({ message: "Primary ticketing is unavailable.", reason: "FEATURE_DISABLED" });
    }
  });
});
