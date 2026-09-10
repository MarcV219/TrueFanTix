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
    await expect(response.json()).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("is unavailable when enabled without isolated preflight", async () => {
    process.env = { ...originalEnv, PRIMARY_TICKETING_ENABLED: "true", NODE_ENV: "test" };
    const response = await GET();
    expect(response.status).toBe(404);
  });
});
