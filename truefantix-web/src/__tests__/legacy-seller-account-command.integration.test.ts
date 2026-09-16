/** @jest-environment node */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  SellerAccountAuthorizationChangedError,
  SellerAccountReconciliationRequiredError,
  claimLegacySellerAccountCommandInTransaction,
  finalizeLegacySellerAccountCommandInTransaction,
  markSellerAccountReconciliationRequiredInTransaction,
  persistSellerStatusProjectionInTransaction,
  stageLegacySellerAccountCommand,
  type SellerAccountProviderEvidence,
} from "@/lib/sellers/ordinary-onboarding";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) describe.skip("legacy seller-account PostgreSQL boundary", () => {
  it("requires an isolated database", () => undefined);
}); else describe("legacy seller-account PostgreSQL boundary", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const runId = `${Date.now()}-${process.pid}`;
  const sellerId = `onboarding-seller-${runId}`;
  const userId = `onboarding-user-${runId}`;
  const providerAccountId = `acct_synthetic_${runId}`;
  const verifiedAt = new Date("2026-09-16T00:00:00.000Z");
  const phone = `+1555${String(Date.now()).slice(-7)}`;

  function authorization() {
    return {
      userId,
      sellerId,
      actorUserId: userId,
      authorizedCanSell: false,
      firstName: "Synthetic",
      lastName: "Seller",
      email: `seller-${runId}@example.test`,
      phone,
      streetAddress1: "1 Test Lane",
      streetAddress2: null,
      city: "Toronto",
      region: "ON",
      postalCode: "M5V 1A1",
      country: "CA",
      accountType: "EXPRESS" as const,
      requestedCapabilities: { transfers: true as const },
      payoutScheduleInterval: "DAILY" as const,
      payoutDelayDays: "MINIMUM" as const,
      businessProfileMcc: "7922" as const,
      businessProfileUrl: `https://seller-onboarding.test.invalid/seller/${sellerId}`,
      businessProfileDescription:
        "Individual seller listing personal event tickets at or below face value through the TrueFanTix marketplace.",
      providerMetadata: { userId, sellerId, platform: "TrueFanTix" as const },
      authorizedAt: new Date(),
    };
  }

  const evidence: SellerAccountProviderEvidence = {
    id: providerAccountId,
    type: "express",
    country: "CA",
    capabilities: { transfers: "pending" },
    metadata: { platform: "TrueFanTix", sellerId, userId },
    detailsSubmitted: false,
    chargesEnabled: false,
    payoutsEnabled: false,
  };

  async function stage() {
    return db.$transaction((tx) => stageLegacySellerAccountCommand(tx, authorization()), {
      isolationLevel: "Serializable",
    });
  }

  async function forceReset() {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.legacySellerAccountCommand.deleteMany({ where: { sellerId } });
      await tx.seller.update({
        where: { id: sellerId },
        data: {
          stripeAccountId: null,
          stripeDetailsSubmitted: false,
          stripeChargesEnabled: false,
          stripePayoutsEnabled: false,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { sellerId, isBanned: false, canSell: false, emailVerifiedAt: verifiedAt, phoneVerifiedAt: verifiedAt },
      });
    });
  }

  async function installLinkedAccount() {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.seller.update({
        where: { id: sellerId },
        data: {
          stripeAccountId: providerAccountId,
          stripeDetailsSubmitted: false,
          stripeChargesEnabled: false,
          stripePayoutsEnabled: false,
          status: "PENDING",
          statusReason: null,
        },
      });
      await tx.user.update({ where: { id: userId }, data: { canSell: false } });
    });
  }

  async function persistStatus(projection: {
    detailsSubmitted: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  }) {
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Seller" WHERE "id" = ${sellerId} FOR UPDATE`;
      const current = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { seller: true },
      });
      return persistSellerStatusProjectionInTransaction(
        tx,
        current,
        { kind: "ACCOUNT", userId, sellerId, stripeAccountId: providerAccountId },
        projection,
      );
    }, { isolationLevel: "Serializable" });
  }

  beforeAll(async () => {
    await db.seller.create({ data: { id: sellerId, name: "Synthetic Seller", status: "PENDING" } });
    await db.user.create({
      data: {
        id: userId,
        email: authorization().email,
        passwordHash: "synthetic-no-login",
        emailVerifiedAt: verifiedAt,
        firstName: "Synthetic",
        lastName: "Seller",
        phone: authorization().phone,
        phoneVerifiedAt: verifiedAt,
        streetAddress1: "1 Test Lane",
        city: "Toronto",
        region: "ON",
        postalCode: "M5V 1A1",
        country: "CA",
        sellerId,
      },
    });
  });

  beforeEach(forceReset);

  afterAll(async () => {
    await forceReset();
    await db.user.delete({ where: { id: userId } });
    await db.seller.delete({ where: { id: sellerId } });
    await db.$disconnect();
    await pool.end();
  });

  it("rolls back authorization before any claim can exist", async () => {
    await expect(db.$transaction(async (tx) => {
      await stageLegacySellerAccountCommand(tx, authorization());
      throw new Error("force authorization rollback");
    })).rejects.toThrow("force authorization rollback");
    await expect(db.legacySellerAccountCommand.count({ where: { sellerId } })).resolves.toBe(0);
  });

  it("atomically persists an exact linked-account readiness projection", async () => {
    await installLinkedAccount();

    await persistStatus({ detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true });

    await expect(db.seller.findUniqueOrThrow({ where: { id: sellerId } })).resolves.toMatchObject({
      stripeAccountId: providerAccountId,
      stripeDetailsSubmitted: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      status: "APPROVED",
    });
    await expect(db.user.findUniqueOrThrow({ where: { id: userId } }))
      .resolves.toMatchObject({ canSell: true });
  });

  it("rolls back every readiness field when the final can-sell projection fails", async () => {
    await installLinkedAccount();
    const suffix = `${process.pid}${Date.now()}`;
    const functionName = `reject_status_can_sell_${suffix}`;
    const triggerName = `reject_status_can_sell_trigger_${suffix}`;
    await db.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF OLD."canSell" = FALSE AND NEW."canSell" = TRUE THEN
          RAISE EXCEPTION 'synthetic can-sell projection failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER "${triggerName}"
      BEFORE UPDATE OF "canSell" ON "User"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `);

    try {
      await expect(persistStatus({
        detailsSubmitted: true,
        chargesEnabled: true,
        payoutsEnabled: true,
      })).rejects.toThrow("synthetic can-sell projection failure");
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "User"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }

    await expect(db.seller.findUniqueOrThrow({ where: { id: sellerId } })).resolves.toMatchObject({
      stripeAccountId: providerAccountId,
      stripeDetailsSubmitted: false,
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      status: "PENDING",
    });
    await expect(db.user.findUniqueOrThrow({ where: { id: userId } }))
      .resolves.toMatchObject({ canSell: false });
  });

  it("reuses only the exact frozen authorization", async () => {
    const command = await stage();
    const replay = await db.$transaction((tx) => stageLegacySellerAccountCommand(tx, {
      ...authorization(),
      authorizedAt: new Date(command.authorizedAt.getTime() + 60_000),
    }));
    expect(replay.id).toBe(command.id);
    await expect(db.$transaction((tx) => stageLegacySellerAccountCommand(tx, {
      ...authorization(),
      city: "Ottawa",
    }))).rejects.toBeInstanceOf(SellerAccountAuthorizationChangedError);
  });

  it("gives concurrent claims one provider-dispatch owner", async () => {
    const command = await stage();
    const claims = await Promise.all([
      db.$transaction((tx) => claimLegacySellerAccountCommandInTransaction(tx, command.id)),
      db.$transaction((tx) => claimLegacySellerAccountCommandInTransaction(tx, command.id)),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await expect(db.legacySellerAccountCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({ status: "ATTEMPTING", providerAccountId: null });
  });

  it("never reclaims a crash-after-claim command", async () => {
    const command = await stage();
    await db.$transaction((tx) => claimLegacySellerAccountCommandInTransaction(tx, command.id));
    await expect(db.$transaction((tx) => claimLegacySellerAccountCommandInTransaction(tx, command.id)))
      .resolves.toBeNull();
  });

  it("rejects mismatched provider evidence without installing a seller binding", async () => {
    const command = await stage();
    await db.$transaction((tx) => claimLegacySellerAccountCommandInTransaction(tx, command.id));
    await expect(db.$transaction((tx) => finalizeLegacySellerAccountCommandInTransaction(
      tx,
      command.id,
      { ...evidence, metadata: { ...evidence.metadata, sellerId: "other-seller" } },
    ))).rejects.toBeInstanceOf(SellerAccountReconciliationRequiredError);
    await expect(db.seller.findUniqueOrThrow({ where: { id: sellerId } }))
      .resolves.toMatchObject({ stripeAccountId: null });
  });

  it("rolls back Tx2 and then preserves exact provider success as reconciliation evidence", async () => {
    const command = await stage();
    await db.$transaction((tx) => claimLegacySellerAccountCommandInTransaction(tx, command.id));
    await expect(db.$transaction(async (tx) => {
      await finalizeLegacySellerAccountCommandInTransaction(tx, command.id, evidence);
      throw new Error("force Tx2 rollback");
    })).rejects.toThrow("force Tx2 rollback");
    await expect(db.seller.findUniqueOrThrow({ where: { id: sellerId } }))
      .resolves.toMatchObject({ stripeAccountId: null });
    await db.$transaction((tx) => markSellerAccountReconciliationRequiredInTransaction(
      tx,
      command.id,
      "PROVIDER_SUCCESS_LOCAL_FINALIZATION_FAILED",
      evidence,
    ));
    await expect(db.legacySellerAccountCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({
        status: "RECONCILIATION_REQUIRED",
        providerAccountId,
        providerAccountType: "express",
        providerCountry: "CA",
      });
  });

  it("atomically installs exact provider evidence and replays success without a new claim", async () => {
    const command = await stage();
    await db.$transaction((tx) => claimLegacySellerAccountCommandInTransaction(tx, command.id));
    await db.$transaction((tx) => finalizeLegacySellerAccountCommandInTransaction(tx, command.id, evidence));
    await expect(db.seller.findUniqueOrThrow({ where: { id: sellerId } }))
      .resolves.toMatchObject({ stripeAccountId: providerAccountId });
    const replay = await db.$transaction((tx) => stageLegacySellerAccountCommand(tx, authorization()));
    expect(replay).toMatchObject({ status: "SUCCEEDED", providerAccountId });
    await expect(db.$transaction((tx) => claimLegacySellerAccountCommandInTransaction(tx, command.id)))
      .resolves.toBeNull();
  });

  it("fails closed on static history, delete, truncate, user-binding, and projection violations", async () => {
    const command = await stage();
    await expect(db.legacySellerAccountCommand.update({
      where: { id: command.id },
      data: { city: "Ottawa" },
    })).rejects.toThrow("authorization evidence is immutable");
    await expect(db.legacySellerAccountCommand.delete({ where: { id: command.id } }))
      .rejects.toThrow("evidence cannot be deleted");
    await expect(db.$executeRawUnsafe('TRUNCATE TABLE "LegacySellerAccountCommand"'))
      .rejects.toThrow("evidence cannot be truncated");
    await expect(db.user.update({ where: { id: userId }, data: { sellerId: null } }))
      .rejects.toThrow("user binding is immutable");
    await db.$transaction((tx) => claimLegacySellerAccountCommandInTransaction(tx, command.id));
    await expect(db.seller.update({
      where: { id: sellerId },
      data: { stripeAccountId: "acct_unbacked" },
    })).rejects.toThrow("not backed by successful command evidence");
  });
});
