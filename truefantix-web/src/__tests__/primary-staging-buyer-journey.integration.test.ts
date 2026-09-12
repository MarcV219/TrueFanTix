/** @jest-environment node */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { advancePrimaryStagingBuyerJourney, getPrimaryStagingBuyerJourney, reseedPrimaryStagingBuyerJourney } from "@/lib/primary/staging-buyer-journey";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;
if (!databaseUrl) describe.skip("primary staging buyer journey PostgreSQL integration", () => { it("requires an isolated database", () => undefined); });
else describe("primary staging buyer journey PostgreSQL integration", () => {
  const pool = new Pool({ connectionString: databaseUrl }); const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const admin = { id: "staging-buyer-admin", email: "admin@primary-staging.example.invalid", role: "ADMIN" as const };
  const organizer = { id: "staging-buyer-organizer", email: "organizer@primary-staging.example.invalid", role: "USER" as const };
  beforeAll(async () => {
    const now = new Date();
    for (const user of [admin, organizer]) await db.user.upsert({ where: { email: user.email }, create: { ...user, passwordHash: "synthetic", emailVerifiedAt: now, firstName: "Staging", lastName: user.role, phone: user.role === "ADMIN" ? "+15550001002" : "+15550001001", phoneVerifiedAt: now, streetAddress1: "1 Synthetic Way", city: "Toronto", region: "ON", postalCode: "M5V 0A1", country: "CA" }, update: { id: user.id, role: user.role, isBanned: false, emailVerifiedAt: now } });
  });
  afterAll(async () => { await db.$disconnect(); await pool.end(); });

  it("advances only the reserved admin through a provider-free purchase and accepted admission", async () => {
    await expect(reseedPrimaryStagingBuyerJourney(db, organizer)).rejects.toMatchObject({ code: "STAGING_ADMIN_REQUIRED" });
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin); expect(seeded.generation).toBeGreaterThan(0);
    for (const expected of ["HELD", "ORDER_CREATED", "PAYMENT_PROCESSING", "PROCESSING", "PAID", "ISSUED", "CHECKED_IN"]) {
      await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: expected });
    }
    const state = await getPrimaryStagingBuyerJourney(db);
    expect(state).toMatchObject({ reservation: { status: "PAYMENT_COMMITTED" }, order: { status: "PAID", grossTotalMinor: 3800 }, payment: { status: "SUCCEEDED" }, admission: { status: "CHECKED_IN", scans: [{ result: "ACCEPTED" }] } });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_JOURNEY_COMPLETE" });
  });

  it("fails closed on reserved fixture drift and lets an admin reseed restore it", async () => {
    await reseedPrimaryStagingBuyerJourney(db, admin);
    const buyer = await db.user.findUniqueOrThrow({ where: { email: "buyer@primary-staging.example.invalid" } });
    await db.user.update({ where: { id: buyer.id }, data: { canBuy: true } });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_FIXTURE_INVALID" });
    const current = await getPrimaryStagingBuyerJourney(db);
    expect(current?.reservation).toBeNull();

    await reseedPrimaryStagingBuyerJourney(db, admin);
    await expect(db.user.findUniqueOrThrow({ where: { id: buyer.id } })).resolves.toMatchObject({ canBuy: false, canSell: false, canComment: false, role: "USER", isBanned: false });
    await db.primaryOrganizer.update({ where: { id: "primary-staging-buyer-organizer" }, data: { supportEmail: "drift@example.invalid" } });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_FIXTURE_INVALID" });
    await expect(getPrimaryStagingBuyerJourney(db)).resolves.toMatchObject({ reservation: null });

    await reseedPrimaryStagingBuyerJourney(db, admin);
    await expect(db.primaryOrganizer.findUniqueOrThrow({ where: { id: "primary-staging-buyer-organizer" } })).resolves.toMatchObject({ supportEmail: "buyer-journey@primary-staging.example.invalid", paymentStatus: "NOT_STARTED", paymentProvider: null });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: "HELD" });
  });
});
