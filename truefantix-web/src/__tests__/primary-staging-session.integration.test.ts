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

  it("atomically replaces every managed staging bearer with one access-token session", async () => {
    const admin = await ensurePrimaryStagingPersona("admin", db);
    const organizer = await ensurePrimaryStagingPersona("organizer", db);
    const buyer = await db.user.upsert({
      where: { email: "refund-buyer@primary-staging.example.invalid" },
      update: {},
      create: {
        email: "refund-buyer@primary-staging.example.invalid",
        passwordHash: "disabled-synthetic-password-hash",
        firstName: "Staging",
        lastName: "Refund Buyer",
        phone: "+15550001004",
        streetAddress1: "1 Synthetic Way",
        city: "Toronto",
        region: "ON",
        postalCode: "M5V 0A1",
        country: "CA",
      },
      select: { id: true },
    });
    const uniqueSuffix = Date.now().toString().slice(-7);
    const driftedManaged = await db.user.create({
      data: {
        email: `drifted-managed-session-${uniqueSuffix}@example.test`,
        passwordHash: "disposable-password-hash",
        firstName: "Drifted",
        lastName: "Managed",
        phone: `+1556${uniqueSuffix}`,
        streetAddress1: "1 Test Way",
        city: "Toronto",
        region: "ON",
        postalCode: "M5V 0A1",
        country: "CA",
        termsVersion: "primary-staging-only",
      },
      select: { id: true },
    });
    const ordinary = await db.user.create({
      data: {
        email: `ordinary-session-${uniqueSuffix}@example.test`,
        passwordHash: "disposable-password-hash",
        firstName: "Ordinary",
        lastName: "Session",
        phone: `+1557${uniqueSuffix}`,
        streetAddress1: "1 Test Way",
        city: "Toronto",
        region: "ON",
        postalCode: "M5V 0A1",
        country: "CA",
      },
      select: { id: true },
    });
    await db.session.deleteMany({ where: { userId: admin.id } });
    await db.session.createMany({
      data: [
        { userId: admin.id, tokenHash: `stale-staging-session-a-${uniqueSuffix}`, expiresAt: new Date("2038-01-01T00:00:00Z") },
        { userId: organizer.id, tokenHash: `stale-staging-session-b-${uniqueSuffix}`, expiresAt: new Date("2038-01-01T00:00:00Z") },
        { userId: buyer.id, tokenHash: `stale-staging-session-c-${uniqueSuffix}`, expiresAt: new Date("2038-01-01T00:00:00Z") },
        { userId: driftedManaged.id, tokenHash: `stale-staging-session-d-${uniqueSuffix}`, expiresAt: new Date("2038-01-01T00:00:00Z") },
        { userId: ordinary.id, tokenHash: `ordinary-session-${uniqueSuffix}`, expiresAt: new Date("2038-01-01T00:00:00Z") },
      ],
    });

    await expect(establishPrimaryStagingPersonaSession("admin", db)).resolves.toMatchObject({
      id: admin.id,
      email: "admin@primary-staging.example.invalid",
      role: "ADMIN",
    });

    const managedSessions = await db.session.findMany({
      where: { userId: { in: [admin.id, organizer.id, buyer.id, driftedManaged.id] } },
    });
    expect(managedSessions).toHaveLength(1);
    expect(managedSessions[0]).toMatchObject({ userId: admin.id });
    expect(managedSessions[0].tokenHash).not.toMatch(/^stale-staging-session-/);
    await expect(db.session.count({ where: { userId: ordinary.id } })).resolves.toBe(1);
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
