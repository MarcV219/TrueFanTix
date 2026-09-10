/** @jest-environment node */
import { generateKeyPairSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { requirePrimaryPreflight } from "@/lib/primary/config";
import { createPrimaryOrderInternalCapabilityForTests, PrimaryOrderService } from "@/lib/primary/order-service";
import { createPrimaryAdmissionInternalCapabilityForTests, PrimaryAdmissionService, requirePrimaryAdmissionTestConfig } from "@/lib/primary/admission-service";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;
if (!databaseUrl) describe.skip("primary admission PostgreSQL integration", () => { it("requires an isolated database", () => undefined); });
else describe("primary admission PostgreSQL integration", () => {
  const pool = new Pool({ connectionString: databaseUrl }); const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const capability = requirePrimaryPreflight({ NODE_ENV: "test", PRIMARY_TICKETING_ENABLED: "true", PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-test", PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-test", PRIMARY_TICKETING_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl } as NodeJS.ProcessEnv);
  const pair = generateKeyPairSync("ed25519"); const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(); const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const config = requirePrimaryAdmissionTestConfig(capability, { NODE_ENV: "test", PRIMARY_ADMISSION_SIGNING_KEY_ID: "test_admission_1", PRIMARY_ADMISSION_PRIVATE_KEY: privatePem, PRIMARY_ADMISSION_PUBLIC_KEY: publicPem } as NodeJS.ProcessEnv);
  const now = new Date("2037-02-01T12:00:00Z"); const runId = `${process.pid}-${Date.now()}`; let sequence = 0;
  const orderService = new PrimaryOrderService(db, capability, () => new Date(now)); let internal: ReturnType<typeof createPrimaryAdmissionInternalCapabilityForTests>;

  async function seed(quantity = 2, paid = true) {
    const n = ++sequence; const buyer = await db.user.create({ data: { email: `admission-${runId}-${n}@example.test`, passwordHash: "synthetic", emailVerifiedAt: now, firstName: "Admission", lastName: `${n}`, phone: `+1${String(Date.now() + n).slice(-10)}`, phoneVerifiedAt: now, streetAddress1: "1 Test", city: "Toronto", region: "ON", postalCode: "A1A1A1", country: "CA" } });
    const organizer = await db.primaryOrganizer.create({ data: { legalName: `Admission ${n}`, displayName: `Admission ${n}`, addressLine1: "1 Test", city: "Toronto", region: "ON", postalCode: "A1A1A1", country: "CA", supportEmail: `admission-org-${runId}-${n}@example.test`, status: "APPROVED", createdByUserId: buyer.id } });
    const event = await db.primaryEvent.create({ data: { organizerId: organizer.id, title: "Admission Event", description: "Synthetic", category: "CONCERT", venueName: "Hall", venueAddressLine1: "1 Test", venueCity: "Toronto", venueRegion: "ON", venuePostalCode: "A1A1A1", venueCountry: "CA", startsAtLocal: new Date("2038-01-01T19:00:00Z"), endsAtLocal: new Date("2038-01-01T22:00:00Z"), timezone: "America/Toronto", contactEmail: "events@example.test", draftPolicyText: "Synthetic", totalCapacity: 10, status: "APPROVED" } });
    const ticketType = await db.primaryTicketType.create({ data: { organizerId: organizer.id, eventId: event.id, name: "GA", allocatedQuantity: 10, status: "ACTIVE", currency: "CAD", basePriceMinor: 2500 } });
    const reservation = await db.primaryInventoryReservation.create({ data: { organizerId: organizer.id, eventId: event.id, ticketTypeId: ticketType.id, buyerUserId: buyer.id, quantity, expiresAt: new Date(now.getTime() + 60_000), createIdempotencyKey: `admission-res-${runId}-${n}` } });
    const orderInternal = createPrimaryOrderInternalCapabilityForTests(); const order = await orderService.create({ internalCapability: orderInternal, actor: { id: buyer.id, role: buyer.role }, organizerId: organizer.id, eventId: event.id, reservationId: reservation.id, idempotencyKey: `admission-order-${runId}-${n}` });
    let attempt = null;
    if (paid) {
      await orderService.prepareForPayment({ internalCapability: orderInternal, organizerId: organizer.id, eventId: event.id, orderId: order.id, idempotencyKey: `admission-prepare-${runId}-${n}` });
      attempt = await db.primaryPaymentAttempt.create({ data: { organizerId: organizer.id, eventId: event.id, buyerUserId: buyer.id, reservationId: reservation.id, orderId: order.id, status: "PROCESSING", expectedAmountMinor: order.grossTotalMinor, currency: order.currency, createIdempotencyKey: `admission-attempt-${runId}-${n}`, providerIntentId: `pi_admission_${runId}_${n}`, providerCreatedAt: now } });
      attempt = await db.primaryPaymentAttempt.update({ where: { id: attempt.id }, data: { status: "SUCCEEDED", terminalAt: now } }); await db.primaryOrder.update({ where: { id: order.id }, data: { status: "PAID", paidAt: now } });
    }
    return { buyer, organizer, event, ticketType, reservation, order, attempt };
  }

  beforeAll(async () => { process.env.PRIMARY_TICKETING_ENVIRONMENT_ID = "isolated-test"; internal = createPrimaryAdmissionInternalCapabilityForTests(); await db.$executeRawUnsafe('TRUNCATE TABLE "PrimaryAdmissionCredential", "PrimaryAdmissionTicket", "PrimaryPaymentException", "PrimaryPaymentProviderEvent", "PrimaryPaymentAttempt", "PrimaryOrderPriceComponent", "PrimaryOrderLine", "PrimaryOrder", "PrimaryAuditEvent", "PrimaryOutboxMessage" CASCADE'); });
  afterAll(async () => { delete process.env.PRIMARY_TICKETING_ENVIRONMENT_ID; await db.$disconnect(); await pool.end(); });

  it("fails closed on missing or non-test Ed25519 configuration", () => {
    expect(() => requirePrimaryAdmissionTestConfig(capability, {} as NodeJS.ProcessEnv)).toThrow(expect.objectContaining({ code: "ADMISSION_TEST_KEY_PREFLIGHT_REQUIRED" }));
    expect(() => requirePrimaryAdmissionTestConfig(capability, { NODE_ENV: "test", PRIMARY_ADMISSION_SIGNING_KEY_ID: "live_key", PRIMARY_ADMISSION_PRIVATE_KEY: privatePem, PRIMARY_ADMISSION_PUBLIC_KEY: publicPem } as NodeJS.ProcessEnv)).toThrow(expect.objectContaining({ code: "ADMISSION_TEST_KEY_PREFLIGHT_REQUIRED" }));
  });

  it("issues exact quantity once under replay and concurrency", async () => {
    const scope = await seed(3); const service = new PrimaryAdmissionService(db, capability, config, () => new Date(now)); const input = { internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "issue-exact" };
    const results = await Promise.all([service.issue(input), service.issue(input)]); expect(results[0]).toHaveLength(3); expect(results[1]).toHaveLength(3);
    expect(await db.primaryAdmissionTicket.count({ where: { orderId: scope.order.id } })).toBe(3); expect(await db.primaryAdmissionCredential.count({ where: { ticket: { orderId: scope.order.id } } })).toBe(3);
    expect((await service.issue(input)).map((item) => item.token)).toEqual(results[0].map((item) => item.token));
  });

  it("enforces cross-order and scope constraints directly in PostgreSQL", async () => {
    const a = await seed(1); const b = await seed(1); const service = new PrimaryAdmissionService(db, capability, config, () => new Date(now)); const issued = await service.issue({ internalCapability: internal, organizerId: a.organizer.id, eventId: a.event.id, orderId: a.order.id, idempotencyKey: "scope-a" });
    const source = issued[0].ticket;
    await expect(db.primaryAdmissionTicket.create({ data: { ...source, id: `bad-scope-${runId}`, organizerId: b.organizer.id, unitNumber: 2, credential: undefined } })).rejects.toBeTruthy();
    const bLine = await db.primaryOrderLine.findUniqueOrThrow({ where: { orderId: b.order.id } });
    await expect(db.primaryAdmissionTicket.create({ data: { organizerId: a.organizer.id, eventId: a.event.id, buyerUserId: a.buyer.id, reservationId: a.reservation.id, orderId: a.order.id, orderLineId: bLine.id, ticketTypeId: b.ticketType.id, unitNumber: 2, issuanceIdempotencyKey: "bad-line", issuedAt: now } })).rejects.toBeTruthy();
  });

  it("denies unpaid, mismatched-scope, and payment-exception orders", async () => {
    const unpaid = await seed(1, false); const service = new PrimaryAdmissionService(db, capability, config, () => new Date(now));
    await expect(service.issue({ internalCapability: internal, organizerId: unpaid.organizer.id, eventId: unpaid.event.id, orderId: unpaid.order.id, idempotencyKey: "unpaid" })).rejects.toMatchObject({ code: "ADMISSION_ORDER_NOT_RECONCILED_PAID" });
    const paid = await seed(1); await db.primaryPaymentException.create({ data: { attemptId: paid.attempt!.id, kind: "PROVIDER_MISMATCH", providerEventId: `evt_exception_${runId}` } });
    await expect(service.issue({ internalCapability: internal, organizerId: paid.organizer.id, eventId: paid.event.id, orderId: paid.order.id, idempotencyKey: "exception" })).rejects.toMatchObject({ code: "ADMISSION_ORDER_NOT_RECONCILED_PAID" });
    await expect(service.issue({ internalCapability: internal, organizerId: unpaid.organizer.id, eventId: unpaid.event.id, orderId: paid.order.id, idempotencyKey: "wrong-scope" })).rejects.toMatchObject({ code: "ADMISSION_ORDER_NOT_FOUND" });
  });

  it("verifies signature/event/key/version and denies tampering or voided tickets", async () => {
    const scope = await seed(1); const service = new PrimaryAdmissionService(db, capability, config, () => new Date(now)); const [issued] = await service.issue({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "verify" });
    await expect(service.verify(issued.token, scope.event.id)).resolves.toMatchObject({ admissionTicketId: issued.ticket.id, status: "ISSUED" });
    await expect(service.verify(`${issued.token.slice(0, -1)}x`, scope.event.id)).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" }); await expect(service.verify(issued.token, "wrong-event")).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
    const other = generateKeyPairSync("ed25519"); const otherConfig = requirePrimaryAdmissionTestConfig(capability, { NODE_ENV: "test", PRIMARY_ADMISSION_SIGNING_KEY_ID: "test_other", PRIMARY_ADMISSION_PRIVATE_KEY: other.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), PRIMARY_ADMISSION_PUBLIC_KEY: other.publicKey.export({ type: "spki", format: "pem" }).toString() } as NodeJS.ProcessEnv);
    await expect(new PrimaryAdmissionService(db, capability, otherConfig).verify(issued.token, scope.event.id)).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
    const [body, signature] = issued.token.split("."); const payload = JSON.parse(Buffer.from(body, "base64url").toString()); payload.v = 2; const wrongVersion = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`; await expect(service.verify(wrongVersion, scope.event.id)).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
    await service.void({ internalCapability: internal, admissionTicketId: issued.ticket.id, reason: "Synthetic void", idempotencyKey: "void" }); await expect(service.verify(issued.token, scope.event.id)).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
  });

  it("enforces entitlement and credential immutability", async () => {
    const scope = await seed(1); const service = new PrimaryAdmissionService(db, capability, config, () => new Date(now)); const [issued] = await service.issue({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "immutable" });
    await expect(db.$executeRawUnsafe(`UPDATE "PrimaryAdmissionTicket" SET "eventId" = 'wrong' WHERE id = '${issued.ticket.id}'`)).rejects.toBeTruthy(); await expect(db.$executeRawUnsafe(`DELETE FROM "PrimaryAdmissionTicket" WHERE id = '${issued.ticket.id}'`)).rejects.toBeTruthy();
    await expect(db.$executeRawUnsafe(`UPDATE "PrimaryAdmissionCredential" SET signature = 'wrong' WHERE id = '${issued.ticket.credential!.id}'`)).rejects.toBeTruthy(); await expect(db.$executeRawUnsafe(`DELETE FROM "PrimaryAdmissionCredential" WHERE id = '${issued.ticket.credential!.id}'`)).rejects.toBeTruthy();
  });

  it("rolls back all entitlement, credential, and audit evidence on outbox failure", async () => {
    const scope = await seed(2); const service = new PrimaryAdmissionService(db, capability, config, () => new Date(now)); await db.primaryOutboxMessage.create({ data: { organizerId: scope.organizer.id, topic: "synthetic", aggregateType: "Synthetic", aggregateId: scope.order.id, payloadJson: {}, idempotencyKey: "rollback-issue:2:admission_issued" } });
    const auditBefore = await db.primaryAuditEvent.count(); const outboxBefore = await db.primaryOutboxMessage.count(); await expect(service.issue({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "rollback-issue" })).rejects.toBeTruthy();
    expect(await db.primaryAdmissionTicket.count({ where: { orderId: scope.order.id } })).toBe(0); expect(await db.primaryAdmissionCredential.count({ where: { ticket: { orderId: scope.order.id } } })).toBe(0); expect(await db.primaryAuditEvent.count()).toBe(auditBefore); expect(await db.primaryOutboxMessage.count()).toBe(outboxBefore);
  });
});
