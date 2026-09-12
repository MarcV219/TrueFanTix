/** @jest-environment node */
import { GET } from "@/app/api/primary/health/route";

const originalEnv = process.env;

describe("primary ticketing health route", () => {
  afterEach(() => {
    process.env = originalEnv;
  });

  it("is unavailable when the feature is disabled", async () => {
    process.env = { ...originalEnv, PRIMARY_TICKETING_ENABLED: "false" };
    const response = await GET();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("is unavailable when enabled without isolated preflight", async () => {
    process.env = { ...originalEnv, PRIMARY_TICKETING_ENABLED: "true", NODE_ENV: "test" };
    const response = await GET();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps isolated-preview health state private and non-cacheable", async () => {
    const databaseUrl = "postgresql://synthetic:synthetic@127.0.0.1:5432/primary_ticketing_preview";
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      PRIMARY_TICKETING_ENABLED: "true",
      PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-preview",
      PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-preview",
      PRIMARY_TICKETING_DATABASE_URL: databaseUrl,
      DATABASE_URL: databaseUrl,
    };

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      feature: "primary-ticketing",
      environment: "isolated-preview",
    });
  });
});
