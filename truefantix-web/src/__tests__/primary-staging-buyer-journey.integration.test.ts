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

  it("rejects future-dated order snapshot evidence before payment mutation", async () => {
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin);
    const base = `staging-buyer-g${seeded.generation}`;
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: "HELD" });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: "ORDER_CREATED" });
    const futureCreatedAt = new Date(Date.now() + 60_000);
    await db.$executeRawUnsafe(`ALTER TABLE "PrimaryOrder" DISABLE TRIGGER "PrimaryOrder_snapshot_immutable"`);
    try {
      await db.primaryOrder.update({ where: { id: `${base}-order` }, data: { createdAt: futureCreatedAt } });
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "PrimaryOrder" ENABLE TRIGGER "PrimaryOrder_snapshot_immutable"`);
    }
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_ORDER_INVALID" });
    await expect(db.primaryInventoryReservation.findUniqueOrThrow({ where: { id: `${base}-reservation` } })).resolves.toMatchObject({ status: "HELD", paymentCommittedAt: null });
    await expect(db.primaryPaymentAttempt.count({ where: { eventId: `${base}-event` } })).resolves.toBe(0);
  });

  it("rejects payment-attempt drift before provider or admission mutation", async () => {
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin);
    const base = `staging-buyer-g${seeded.generation}`;
    for (const expected of ["HELD", "ORDER_CREATED", "PAYMENT_PROCESSING"]) {
      await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: expected });
    }
    await db.$executeRawUnsafe(`ALTER TABLE "PrimaryPaymentAttempt" DISABLE TRIGGER "PrimaryPaymentAttempt_immutable_evidence"`);
    try {
      await db.primaryPaymentAttempt.update({ where: { id: `${base}-payment` }, data: { expectedAmountMinor: 9999 } });
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "PrimaryPaymentAttempt" ENABLE TRIGGER "PrimaryPaymentAttempt_immutable_evidence"`);
    }
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_PAYMENT_INVALID" });
    await expect(db.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: `${base}-payment` } })).resolves.toMatchObject({ status: "PENDING_PROVIDER", providerIntentId: null, terminalAt: null });
    await expect(db.primaryAdmissionTicket.count({ where: { eventId: `${base}-event` } })).resolves.toBe(0);

    const lifecycleSeed = await reseedPrimaryStagingBuyerJourney(db, admin);
    const lifecycleBase = `staging-buyer-g${lifecycleSeed.generation}`;
    for (const expected of ["HELD", "ORDER_CREATED", "PAYMENT_PROCESSING", "PROCESSING"]) {
      await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: expected });
    }
    const terminalAt = new Date();
    await db.$executeRawUnsafe(`ALTER TABLE "PrimaryPaymentAttempt" DISABLE TRIGGER "PrimaryPaymentAttempt_immutable_evidence"`);
    try {
      await db.primaryPaymentAttempt.update({ where: { id: `${lifecycleBase}-payment` }, data: { status: "SUCCEEDED", terminalAt } });
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "PrimaryPaymentAttempt" ENABLE TRIGGER "PrimaryPaymentAttempt_immutable_evidence"`);
    }
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_PAYMENT_INVALID" });
    await expect(db.primaryOrder.findUniqueOrThrow({ where: { id: `${lifecycleBase}-order` } })).resolves.toMatchObject({ status: "PAYMENT_PROCESSING", paidAt: null });
    await expect(db.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: `${lifecycleBase}-payment` } })).resolves.toMatchObject({ status: "SUCCEEDED", terminalAt });
    await expect(db.primaryAdmissionTicket.count({ where: { eventId: `${lifecycleBase}-event` } })).resolves.toBe(0);
  });

  it("rejects admission credential drift before check-in mutation", async () => {
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin);
    const base = `staging-buyer-g${seeded.generation}`;
    for (const expected of ["HELD", "ORDER_CREATED", "PAYMENT_PROCESSING", "PROCESSING", "PAID", "ISSUED"]) {
      await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: expected });
    }
    await db.$executeRawUnsafe(`ALTER TABLE "PrimaryAdmissionCredential" DISABLE TRIGGER "PrimaryAdmissionCredential_immutable"`);
    try {
      await db.primaryAdmissionCredential.update({ where: { id: `${base}-credential` }, data: { payloadDigest: "0".repeat(64) } });
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "PrimaryAdmissionCredential" ENABLE TRIGGER "PrimaryAdmissionCredential_immutable"`);
    }
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_ADMISSION_INVALID" });
    await expect(db.primaryAdmissionTicket.findUniqueOrThrow({ where: { id: `${base}-ticket` } })).resolves.toMatchObject({ status: "ISSUED" });
    await expect(db.primaryAdmissionScan.count({ where: { eventId: `${base}-event` } })).resolves.toBe(0);
  });

  it("rejects admission issuance that predates the authoritative paid lifecycle", async () => {
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin);
    const base = `staging-buyer-g${seeded.generation}`;
    for (const expected of ["HELD", "ORDER_CREATED", "PAYMENT_PROCESSING", "PROCESSING", "PAID", "ISSUED"]) {
      await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: expected });
    }
    const order = await db.primaryOrder.findUniqueOrThrow({ where: { id: `${base}-order` } });
    expect(order.paidAt).not.toBeNull();
    await db.$executeRawUnsafe(`ALTER TABLE "PrimaryAdmissionTicket" DISABLE TRIGGER "PrimaryAdmissionTicket_protected"`);
    try {
      await db.primaryAdmissionTicket.update({ where: { id: `${base}-ticket` }, data: { issuedAt: new Date(order.paidAt!.getTime() - 1) } });
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "PrimaryAdmissionTicket" ENABLE TRIGGER "PrimaryAdmissionTicket_protected"`);
    }
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_ADMISSION_INVALID" });
    await expect(db.primaryAdmissionTicket.findUniqueOrThrow({ where: { id: `${base}-ticket` } })).resolves.toMatchObject({ status: "ISSUED" });
    await expect(db.primaryAdmissionScan.count({ where: { eventId: `${base}-event` } })).resolves.toBe(0);
  });

  it("rejects future-dated admission issuance before check-in mutation", async () => {
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin);
    const base = `staging-buyer-g${seeded.generation}`;
    for (const expected of ["HELD", "ORDER_CREATED", "PAYMENT_PROCESSING", "PROCESSING", "PAID", "ISSUED"]) {
      await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: expected });
    }
    const futureIssuedAt = new Date(Date.now() + 60_000);
    await db.$executeRawUnsafe(`ALTER TABLE "PrimaryAdmissionTicket" DISABLE TRIGGER "PrimaryAdmissionTicket_protected"`);
    await db.$executeRawUnsafe(`ALTER TABLE "PrimaryAdmissionCredential" DISABLE TRIGGER "PrimaryAdmissionCredential_immutable"`);
    try {
      await db.primaryAdmissionTicket.update({ where: { id: `${base}-ticket` }, data: { issuedAt: futureIssuedAt } });
      await db.primaryAdmissionCredential.update({ where: { id: `${base}-credential` }, data: { issuedAt: futureIssuedAt } });
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "PrimaryAdmissionCredential" ENABLE TRIGGER "PrimaryAdmissionCredential_immutable"`);
      await db.$executeRawUnsafe(`ALTER TABLE "PrimaryAdmissionTicket" ENABLE TRIGGER "PrimaryAdmissionTicket_protected"`);
    }
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_ADMISSION_INVALID" });
    await expect(db.primaryAdmissionTicket.findUniqueOrThrow({ where: { id: `${base}-ticket` } })).resolves.toMatchObject({ status: "ISSUED", issuedAt: futureIssuedAt });
    await expect(db.primaryAdmissionScan.count({ where: { eventId: `${base}-event` } })).resolves.toBe(0);
  });

  it("rejects unexpected payment provenance before admission mutation", async () => {
    const eventSeed = await reseedPrimaryStagingBuyerJourney(db, admin);
    const eventBase = `staging-buyer-g${eventSeed.generation}`;
    for (const expected of ["HELD", "ORDER_CREATED", "PAYMENT_PROCESSING", "PROCESSING", "PAID"]) {
      await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: expected });
    }
    const eventPayment = await db.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: `${eventBase}-payment` } });
    await db.primaryPaymentProviderEvent.create({ data: { providerEventId: `${eventBase}:unexpected-event`, attemptId: eventPayment.id, orderId: eventPayment.orderId, organizerId: eventPayment.organizerId, eventId: eventPayment.eventId, buyerUserId: eventPayment.buyerUserId, reservationId: eventPayment.reservationId, eventType: "synthetic.unexpected", payloadDigest: "0".repeat(64), providerCreatedAt: eventPayment.terminalAt! } });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_PAYMENT_INVALID" });
    await expect(db.primaryAdmissionTicket.count({ where: { eventId: `${eventBase}-event` } })).resolves.toBe(0);

    const exceptionSeed = await reseedPrimaryStagingBuyerJourney(db, admin);
    const exceptionBase = `staging-buyer-g${exceptionSeed.generation}`;
    for (const expected of ["HELD", "ORDER_CREATED", "PAYMENT_PROCESSING", "PROCESSING", "PAID", "ISSUED"]) {
      await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: expected });
    }
    await db.primaryPaymentException.create({ data: { attemptId: `${exceptionBase}-payment`, kind: "PROVIDER_MISMATCH", providerEventId: `${exceptionBase}:unexpected-exception` } });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_PAYMENT_INVALID" });
    await expect(db.primaryAdmissionTicket.findUniqueOrThrow({ where: { id: `${exceptionBase}-ticket` } })).resolves.toMatchObject({ status: "ISSUED" });
    await expect(db.primaryAdmissionScan.count({ where: { eventId: `${exceptionBase}-event` } })).resolves.toBe(0);
  });

  it("rejects a payment attempt that predates authoritative preparation", async () => {
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin);
    const base = `staging-buyer-g${seeded.generation}`;
    for (const expected of ["HELD", "ORDER_CREATED", "PAYMENT_PROCESSING"]) {
      await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: expected });
    }
    const order = await db.primaryOrder.findUniqueOrThrow({ where: { id: `${base}-order` } });
    expect(order.paymentProcessingAt).not.toBeNull();
    await db.$executeRawUnsafe(`ALTER TABLE "PrimaryPaymentAttempt" DISABLE TRIGGER "PrimaryPaymentAttempt_immutable_evidence"`);
    try {
      await db.primaryPaymentAttempt.update({ where: { id: `${base}-payment` }, data: { createdAt: new Date(order.paymentProcessingAt!.getTime() - 1) } });
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "PrimaryPaymentAttempt" ENABLE TRIGGER "PrimaryPaymentAttempt_immutable_evidence"`);
    }
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_PAYMENT_INVALID" });
    await expect(db.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: `${base}-payment` } })).resolves.toMatchObject({ status: "PENDING_PROVIDER", providerIntentId: null });
    await expect(db.primaryAdmissionTicket.count({ where: { eventId: `${base}-event` } })).resolves.toBe(0);
  });

  it("rejects reservation commitment chronology drift before provider mutation", async () => {
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin);
    const base = `staging-buyer-g${seeded.generation}`;
    for (const expected of ["HELD", "ORDER_CREATED", "PAYMENT_PROCESSING"]) {
      await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: expected });
    }
    const reservation = await db.primaryInventoryReservation.findUniqueOrThrow({ where: { id: `${base}-reservation` } });
    expect(reservation.paymentCommittedAt).not.toBeNull();
    await db.primaryInventoryReservation.update({ where: { id: reservation.id }, data: { reconciliationAfter: new Date(reservation.paymentCommittedAt!.getTime() + 120_001) } });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_RESERVATION_INVALID" });
    await expect(db.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: `${base}-payment` } })).resolves.toMatchObject({ status: "PENDING_PROVIDER", providerIntentId: null });
    await expect(db.primaryAdmissionTicket.count({ where: { eventId: `${base}-event` } })).resolves.toBe(0);
  });

  it("rejects reservation commitment after hold expiry before provider mutation", async () => {
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin);
    const base = `staging-buyer-g${seeded.generation}`;
    for (const expected of ["HELD", "ORDER_CREATED", "PAYMENT_PROCESSING"]) {
      await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: expected });
    }
    const reservation = await db.primaryInventoryReservation.findUniqueOrThrow({ where: { id: `${base}-reservation` } });
    const lateCommit = new Date(reservation.expiresAt.getTime() + 1);
    await db.primaryInventoryReservation.update({ where: { id: reservation.id }, data: { paymentCommittedAt: lateCommit, reconciliationAfter: new Date(lateCommit.getTime() + 120_000) } });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_RESERVATION_INVALID" });
    await expect(db.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: `${base}-payment` } })).resolves.toMatchObject({ status: "PENDING_PROVIDER", providerIntentId: null });
    await expect(db.primaryAdmissionTicket.count({ where: { eventId: `${base}-event` } })).resolves.toBe(0);
  });

  it("rejects reservation and order preparation-clock divergence before provider mutation", async () => {
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin);
    const base = `staging-buyer-g${seeded.generation}`;
    for (const expected of ["HELD", "ORDER_CREATED", "PAYMENT_PROCESSING"]) {
      await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: expected });
    }
    const reservation = await db.primaryInventoryReservation.findUniqueOrThrow({ where: { id: `${base}-reservation` } });
    const driftedCommit = new Date(reservation.paymentCommittedAt!.getTime() + 1);
    await db.primaryInventoryReservation.update({ where: { id: reservation.id }, data: { paymentCommittedAt: driftedCommit, reconciliationAfter: new Date(driftedCommit.getTime() + 120_000) } });
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_PAYMENT_INVALID" });
    await expect(db.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: `${base}-payment` } })).resolves.toMatchObject({ status: "PENDING_PROVIDER", providerIntentId: null });
    await expect(db.primaryAdmissionTicket.count({ where: { eventId: `${base}-event` } })).resolves.toBe(0);
  });

  it("rejects future-dated reservation commitment before provider mutation", async () => {
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin);
    const base = `staging-buyer-g${seeded.generation}`;
    for (const expected of ["HELD", "ORDER_CREATED", "PAYMENT_PROCESSING"]) {
      await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: expected });
    }
    const reservation = await db.primaryInventoryReservation.findUniqueOrThrow({ where: { id: `${base}-reservation` } });
    const futureCommit = new Date(Date.now() + 60_000);
    expect(futureCommit.getTime()).toBeLessThan(reservation.expiresAt.getTime());
    await db.primaryInventoryReservation.update({
      where: { id: reservation.id },
      data: { paymentCommittedAt: futureCommit, reconciliationAfter: new Date(futureCommit.getTime() + 120_000) },
    });
    await db.$executeRawUnsafe(`ALTER TABLE "PrimaryOrder" DISABLE TRIGGER "PrimaryOrder_snapshot_immutable"`);
    try {
      await db.primaryOrder.update({ where: { id: `${base}-order` }, data: { paymentProcessingAt: futureCommit } });
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "PrimaryOrder" ENABLE TRIGGER "PrimaryOrder_snapshot_immutable"`);
    }
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_RESERVATION_INVALID" });
    await expect(db.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: `${base}-payment` } })).resolves.toMatchObject({ status: "PENDING_PROVIDER", providerIntentId: null, providerCreatedAt: null });
    await expect(db.primaryAdmissionTicket.count({ where: { eventId: `${base}-event` } })).resolves.toBe(0);
  });

  it("rejects future-dated provider attachment before payment success mutation", async () => {
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin);
    const base = `staging-buyer-g${seeded.generation}`;
    for (const expected of ["HELD", "ORDER_CREATED", "PAYMENT_PROCESSING", "PROCESSING"]) {
      await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: expected });
    }
    const futureProviderCreatedAt = new Date(Date.now() + 60_000);
    await db.$executeRawUnsafe(`ALTER TABLE "PrimaryPaymentAttempt" DISABLE TRIGGER "PrimaryPaymentAttempt_immutable_evidence"`);
    try {
      await db.primaryPaymentAttempt.update({ where: { id: `${base}-payment` }, data: { providerCreatedAt: futureProviderCreatedAt } });
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "PrimaryPaymentAttempt" ENABLE TRIGGER "PrimaryPaymentAttempt_immutable_evidence"`);
    }
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_PAYMENT_INVALID" });
    await expect(db.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: `${base}-payment` } })).resolves.toMatchObject({ status: "PROCESSING", providerCreatedAt: futureProviderCreatedAt, terminalAt: null });
    await expect(db.primaryOrder.findUniqueOrThrow({ where: { id: `${base}-order` } })).resolves.toMatchObject({ status: "PAYMENT_PROCESSING", paidAt: null });
    await expect(db.primaryAdmissionTicket.count({ where: { eventId: `${base}-event` } })).resolves.toBe(0);
  });

  it("rejects a future-dated payment attempt before provider mutation", async () => {
    const seeded = await reseedPrimaryStagingBuyerJourney(db, admin);
    const base = `staging-buyer-g${seeded.generation}`;
    for (const expected of ["HELD", "ORDER_CREATED", "PAYMENT_PROCESSING"]) {
      await expect(advancePrimaryStagingBuyerJourney(db, admin)).resolves.toEqual({ step: expected });
    }
    const futureCreatedAt = new Date(Date.now() + 60_000);
    await db.$executeRawUnsafe(`ALTER TABLE "PrimaryPaymentAttempt" DISABLE TRIGGER "PrimaryPaymentAttempt_immutable_evidence"`);
    try {
      await db.primaryPaymentAttempt.update({ where: { id: `${base}-payment` }, data: { createdAt: futureCreatedAt } });
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "PrimaryPaymentAttempt" ENABLE TRIGGER "PrimaryPaymentAttempt_immutable_evidence"`);
    }
    await expect(advancePrimaryStagingBuyerJourney(db, admin)).rejects.toMatchObject({ code: "STAGING_BUYER_PAYMENT_INVALID" });
    await expect(db.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: `${base}-payment` } })).resolves.toMatchObject({ status: "PENDING_PROVIDER", createdAt: futureCreatedAt, providerIntentId: null, providerCreatedAt: null });
    await expect(db.primaryOrder.findUniqueOrThrow({ where: { id: `${base}-order` } })).resolves.toMatchObject({ status: "PAYMENT_PROCESSING", paidAt: null });
    await expect(db.primaryAdmissionTicket.count({ where: { eventId: `${base}-event` } })).resolves.toBe(0);
  });
});
