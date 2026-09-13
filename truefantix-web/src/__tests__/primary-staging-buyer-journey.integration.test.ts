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
    await db.user.upsert({ where: { email: admin.email }, create: { ...admin, passwordHash: "synthetic", emailVerifiedAt: now, firstName: "Staging", lastName: admin.role, phone: "+15550001002", phoneVerifiedAt: now, streetAddress1: "1 Synthetic Way", city: "Toronto", region: "ON", postalCode: "M5V 0A1", country: "CA" }, update: { id: admin.id, role: admin.role, isBanned: false, emailVerifiedAt: now } });
  });
  afterAll(async () => { await db.$disconnect(); await pool.end(); });

  it("advances only the reserved admin through a provider-free purchase and accepted admission", async () => {
    await expect(reseedPrimaryStagingBuyerJourney(db, organizer)).rejects.toMatchObject({ code: "STAGING_ADMIN_REQUIRED" });
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin); expect(seeded.generation).toBeGreaterThan(0);
    await expect(db.user.findUniqueOrThrow({ where: { email: organizer.email } })).resolves.toMatchObject({ firstName: "Staging", lastName: "Organizer", role: "USER", canBuy: false, canSell: false, canComment: false });
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
    const organizerUser = await db.user.findUniqueOrThrow({ where: { email: "organizer@primary-staging.example.invalid" } });
    await db.user.update({ where: { id: organizerUser.id }, data: { firstName: "Drifted", canSell: true, passwordHash: "externally-mutated", phoneVerifiedAt: null, sellerId: null } });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_FIXTURE_INVALID" });
    await expect(getPrimaryStagingBuyerJourney(db)).resolves.toMatchObject({ reservation: null });

    const beforeRestore = await getPrimaryStagingBuyerJourney(db);
    const restored = await reseedPrimaryStagingBuyerJourney(db, admin);
    expect(restored.generation).toBe((beforeRestore?.generation ?? 0) + 1);
    await expect(db.user.findUniqueOrThrow({ where: { id: organizerUser.id } })).resolves.toMatchObject({ firstName: "Staging", lastName: "Organizer", displayName: "Staging Organizer", passwordHash: "synthetic-staging-no-login", phoneVerifiedAt: expect.any(Date), canBuy: false, canSell: false, canComment: false, role: "USER", isBanned: false, sellerId: null });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: "HELD" });
  });

  it("rejects deterministic event or ticket-type drift before purchase mutation", async () => {
    const first = await reseedPrimaryStagingBuyerJourney(db, admin);
    const firstBase = `staging-buyer-g${first.generation}`;
    await db.primaryEvent.update({ where: { id: `${firstBase}-event` }, data: { contactEmail: "drift@example.invalid" } });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_SCENARIO_INVALID" });
    await expect(db.primaryInventoryReservation.count({ where: { eventId: `${firstBase}-event` } })).resolves.toBe(0);

    const second = await reseedPrimaryStagingBuyerJourney(db, admin);
    expect(second.generation).toBe(first.generation + 1);
    const secondBase = `staging-buyer-g${second.generation}`;
    await db.primaryTicketType.update({ where: { id: `${secondBase}-type` }, data: { basePriceMinor: 9999 } });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_SCENARIO_INVALID" });
    await expect(db.primaryInventoryReservation.count({ where: { eventId: `${secondBase}-event` } })).resolves.toBe(0);
  });

  it("rejects reservation drift before order mutation", async () => {
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin);
    const base = `staging-buyer-g${seeded.generation}`;
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: "HELD" });
    await db.primaryInventoryReservation.update({ where: { id: `${base}-reservation` }, data: { quantity: 2 } });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_RESERVATION_INVALID" });
    await expect(db.primaryOrder.count({ where: { eventId: `${base}-event` } })).resolves.toBe(0);

    const releaseSeed = await reseedPrimaryStagingBuyerJourney(db, admin);
    const releaseBase = `staging-buyer-g${releaseSeed.generation}`;
    await advancePrimaryStagingBuyerJourney(db, admin);
    await db.primaryInventoryReservation.update({ where: { id: `${releaseBase}-reservation` }, data: { releaseIdempotencyKey: `${releaseBase}:unexpected-release` } });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_RESERVATION_INVALID" });
    await expect(db.primaryOrder.count({ where: { eventId: `${releaseBase}-event` } })).resolves.toBe(0);

    const expirySeed = await reseedPrimaryStagingBuyerJourney(db, admin);
    const expiryBase = `staging-buyer-g${expirySeed.generation}`;
    await advancePrimaryStagingBuyerJourney(db, admin);
    await db.primaryInventoryReservation.update({ where: { id: `${expiryBase}-reservation` }, data: { expireIdempotencyKey: `${expiryBase}:unexpected-expiry` } });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_RESERVATION_INVALID" });
    await expect(db.primaryOrder.count({ where: { eventId: `${expiryBase}-event` } })).resolves.toBe(0);
  });

  it("rejects order snapshot drift before payment mutation", async () => {
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin);
    const base = `staging-buyer-g${seeded.generation}`;
    await advancePrimaryStagingBuyerJourney(db, admin);
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: "ORDER_CREATED" });
    await db.$executeRawUnsafe(`ALTER TABLE "PrimaryOrder" DISABLE TRIGGER "PrimaryOrder_snapshot_immutable"`);
    try {
      await db.primaryOrder.update({ where: { id: `${base}-order` }, data: { grossTotalMinor: 9999 } });
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "PrimaryOrder" ENABLE TRIGGER "PrimaryOrder_snapshot_immutable"`);
    }
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_ORDER_INVALID" });
    await expect(db.primaryPaymentAttempt.count({ where: { eventId: `${base}-event` } })).resolves.toBe(0);
    await expect(db.primaryInventoryReservation.findUniqueOrThrow({ where: { id: `${base}-reservation` } })).resolves.toMatchObject({ status: "HELD", paymentCommittedAt: null });
  });
});
