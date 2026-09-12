/** @jest-environment node */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  ensurePrimaryStagingPersona,
  establishPrimaryStagingPersonaSession,
} from "@/lib/primary/staging-console";

const mockCookieState = { token: undefined as string | undefined };
const mockedCookieSet = jest.fn((name: string, value: string) => {
  if (name === "tft_session") mockCookieState.token = value || undefined;
});

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => ({
    get: jest.fn(() => mockCookieState.token ? { value: mockCookieState.token } : undefined),
    set: mockedCookieSet,
  })),
}));

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) describe.skip("primary staging session PostgreSQL integration", () => {
  it("requires an isolated database", () => undefined);
}); else describe("primary staging session PostgreSQL integration", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const originalEnv = { ...process.env };

  beforeAll(() => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      VERCEL_ENV: "preview",
      PRIMARY_TICKETING_ENABLED: "true",
      PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-preview",
      PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-preview",
      DATABASE_URL: databaseUrl,
      PRIMARY_TICKETING_DATABASE_URL: databaseUrl,
      PRIMARY_STAGING_CONSOLE_ENABLED: "true",
      PRIMARY_STAGING_CONSOLE_ACCESS_TOKEN: "disposable-integration-access-token-1234567890",
      SESSION_SECRET: "disposable-integration-session-secret-1234567890",
    });
  });

  beforeEach(async () => {
    mockCookieState.token = undefined;
    const personas = await db.user.findMany({
      where: { email: { in: [
        "admin@primary-staging.example.invalid",
        "organizer@primary-staging.example.invalid",
      ] } },
      select: { id: true },
    });
    await db.session.deleteMany({ where: { userId: { in: personas.map(({ id }) => id) } } });
  });

  afterAll(async () => {
    await db.$disconnect();
    await pool.end();
    process.env = originalEnv;
  });

  it("atomically replaces every stale persona bearer with one access-token session", async () => {
    const admin = await ensurePrimaryStagingPersona("admin", db);
    await db.session.deleteMany({ where: { userId: admin.id } });
    await db.session.createMany({
      data: [
        { userId: admin.id, tokenHash: "stale-staging-session-a", expiresAt: new Date("2038-01-01T00:00:00Z") },
        { userId: admin.id, tokenHash: "stale-staging-session-b", expiresAt: new Date("2038-01-01T00:00:00Z") },
      ],
    });

    await expect(establishPrimaryStagingPersonaSession("admin", db)).resolves.toMatchObject({
      id: admin.id,
      email: "admin@primary-staging.example.invalid",
      role: "ADMIN",
    });

    const sessions = await db.session.findMany({ where: { userId: admin.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).not.toMatch(/^stale-staging-session-/);
    expect(mockedCookieSet).toHaveBeenCalledWith(
      "tft_session",
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });

  it("revokes the caller's prior persona bearer when switching personas", async () => {
    const admin = await establishPrimaryStagingPersonaSession("admin", db);
    const adminToken = mockCookieState.token;
    expect(adminToken).toMatch(/^[0-9a-f]{64}$/);
    await expect(db.session.count({ where: { userId: admin.id } })).resolves.toBe(1);

    const organizer = await establishPrimaryStagingPersonaSession("organizer", db);

    await expect(db.session.count({ where: { userId: admin.id } })).resolves.toBe(0);
    await expect(db.session.count({ where: { userId: organizer.id } })).resolves.toBe(1);
    expect(mockCookieState.token).toMatch(/^[0-9a-f]{64}$/);
    expect(mockCookieState.token).not.toBe(adminToken);
  });
});
