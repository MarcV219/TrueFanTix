/** @jest-environment node */
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { requirePrimaryPreflight } from "@/lib/primary/config";
import { createPrimaryOrderInternalCapabilityForTests, PrimaryOrderService } from "@/lib/primary/order-service";
import { createPrimaryAdmissionInternalCapabilityForTests, PrimaryAdmissionService, requirePrimaryAdmissionTestConfig } from "@/lib/primary/admission-service";
import { PrimaryAdmissionScanService } from "@/lib/primary/admission-scan-service";

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
  async function directTicket(scope: Awaited<ReturnType<typeof seed>>, unitNumber: number) {
    const line = await db.primaryOrderLine.findUniqueOrThrow({ where: { orderId: scope.order.id } });
    return { id: `direct-${runId}-${++sequence}`, organizerId: scope.organizer.id, eventId: scope.event.id, buyerUserId: scope.buyer.id, reservationId: scope.reservation.id, orderId: scope.order.id, orderLineId: line.id, ticketTypeId: scope.ticketType.id, unitNumber, issuanceIdempotencyKey: `direct-key-${runId}-${sequence}`, issuedAt: now };
  }
  function signedToken(payload: Record<string, unknown>) { const body = JSON.stringify(payload); return `${Buffer.from(body).toString("base64url")}.${sign(null, Buffer.from(body), pair.privateKey).toString("base64url")}`; }
  async function scanner(scope: Awaited<ReturnType<typeof seed>>, role: "OWNER" | "EVENT_MANAGER" | "BOX_OFFICE" | "SCANNER" = "SCANNER", assigned = true) {
    const n = ++sequence; const user = await db.user.create({ data: { email: `scanner-${runId}-${n}@example.test`, passwordHash: "synthetic", emailVerifiedAt: now, firstName: "Scanner", lastName: `${n}`, phone: `+2${String(Date.now() + n).slice(-10)}`, phoneVerifiedAt: now, streetAddress1: "1 Test", city: "Toronto", region: "ON", postalCode: "A1A1A1", country: "CA" } });
    const membership = await db.primaryOrganizerMembership.create({ data: { organizerId: scope.organizer.id, userId: user.id, role, status: "ACTIVE", acceptedAt: now, invitedByUserId: scope.buyer.id } });
    if (assigned) await db.primaryEventStaffAssignment.create({ data: { organizerId: scope.organizer.id, eventId: scope.event.id, membershipId: membership.id, assignedByUserId: scope.buyer.id } });
    return user;
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

  it("database guard rejects excess units and every ineligible financial state", async () => {
    const excess = await seed(2); await expect(db.primaryAdmissionTicket.create({ data: await directTicket(excess, 0) })).rejects.toBeTruthy(); await expect(db.primaryAdmissionTicket.create({ data: await directTicket(excess, 3) })).rejects.toBeTruthy();
    const unpaid = await seed(1, false); await expect(db.primaryAdmissionTicket.create({ data: await directTicket(unpaid, 1) })).rejects.toBeTruthy();
    const missing = await seed(1, false); const orderInternal = createPrimaryOrderInternalCapabilityForTests(); await orderService.prepareForPayment({ internalCapability: orderInternal, organizerId: missing.organizer.id, eventId: missing.event.id, orderId: missing.order.id, idempotencyKey: `missing-attempt-${runId}` }); await db.primaryOrder.update({ where: { id: missing.order.id }, data: { status: "PAID", paidAt: now } }); await expect(db.primaryAdmissionTicket.create({ data: await directTicket(missing, 1) })).rejects.toBeTruthy();
    const processing = await seed(1, false); await orderService.prepareForPayment({ internalCapability: orderInternal, organizerId: processing.organizer.id, eventId: processing.event.id, orderId: processing.order.id, idempotencyKey: `processing-attempt-${runId}` }); await db.primaryPaymentAttempt.create({ data: { organizerId: processing.organizer.id, eventId: processing.event.id, buyerUserId: processing.buyer.id, reservationId: processing.reservation.id, orderId: processing.order.id, status: "PROCESSING", expectedAmountMinor: processing.order.grossTotalMinor, currency: processing.order.currency, createIdempotencyKey: `processing-attempt-key-${runId}`, providerIntentId: `pi_processing_${runId}`, providerCreatedAt: now } }); await db.primaryOrder.update({ where: { id: processing.order.id }, data: { status: "PAID", paidAt: now } }); await expect(db.primaryAdmissionTicket.create({ data: await directTicket(processing, 1) })).rejects.toBeTruthy();
    const excepted = await seed(1); await db.primaryPaymentException.create({ data: { attemptId: excepted.attempt!.id, kind: "PROVIDER_MISMATCH", providerEventId: `evt_guard_exception_${runId}` } }); await expect(db.primaryAdmissionTicket.create({ data: await directTicket(excepted, 1) })).rejects.toBeTruthy();
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
    const [body] = issued.token.split("."); const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    for (const invalid of [{ ...payload, extra: "forbidden" }, { ...payload, v: 2 }, { ...payload, v: "1" }, { ...payload, cid: 42 }, { ...payload, eventId: 7 }, { ...payload, kid: 7 }, { ...payload, iat: 7 }, { ...payload, iat: "not-a-time" }, { ...payload, cid: "not-a-uuid" }]) await expect(service.verify(signedToken(invalid), scope.event.id)).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
    await service.void({ internalCapability: internal, admissionTicketId: issued.ticket.id, reason: "Synthetic void", idempotencyKey: "void" }); await expect(service.verify(issued.token, scope.event.id)).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
  });

  it("enforces entitlement and credential immutability", async () => {
    const scope = await seed(1); const service = new PrimaryAdmissionService(db, capability, config, () => new Date(now)); const [issued] = await service.issue({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "immutable" });
    await expect(db.$executeRawUnsafe(`UPDATE "PrimaryAdmissionTicket" SET "eventId" = 'wrong' WHERE id = '${issued.ticket.id}'`)).rejects.toBeTruthy(); await expect(db.$executeRawUnsafe(`DELETE FROM "PrimaryAdmissionTicket" WHERE id = '${issued.ticket.id}'`)).rejects.toBeTruthy();
    await expect(db.$executeRawUnsafe(`UPDATE "PrimaryAdmissionCredential" SET "payloadDigest" = repeat('0', 64) WHERE id = '${issued.ticket.credential!.id}'`)).rejects.toBeTruthy(); await expect(db.$executeRawUnsafe(`DELETE FROM "PrimaryAdmissionCredential" WHERE id = '${issued.ticket.credential!.id}'`)).rejects.toBeTruthy();
    const stored = await db.$queryRaw<Array<{ evidence: Record<string, unknown> }>>`SELECT to_jsonb(c) AS evidence FROM "PrimaryAdmissionCredential" c WHERE id = ${issued.ticket.credential!.id}`; expect(stored[0].evidence).not.toHaveProperty("signature"); expect(Object.keys(stored[0].evidence)).toEqual(expect.arrayContaining(["id", "eventId", "keyId", "issuedAt", "payloadDigest"]));
  });

  it("rolls back all entitlement, credential, and audit evidence on outbox failure", async () => {
    const scope = await seed(2); const service = new PrimaryAdmissionService(db, capability, config, () => new Date(now)); await db.primaryOutboxMessage.create({ data: { organizerId: scope.organizer.id, topic: "synthetic", aggregateType: "Synthetic", aggregateId: scope.order.id, payloadJson: {}, idempotencyKey: "rollback-issue:2:admission_issued" } });
    const auditBefore = await db.primaryAuditEvent.count(); const outboxBefore = await db.primaryOutboxMessage.count(); await expect(service.issue({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "rollback-issue" })).rejects.toBeTruthy();
    expect(await db.primaryAdmissionTicket.count({ where: { orderId: scope.order.id } })).toBe(0); expect(await db.primaryAdmissionCredential.count({ where: { ticket: { orderId: scope.order.id } } })).toBe(0); expect(await db.primaryAuditEvent.count()).toBe(auditBefore); expect(await db.primaryOutboxMessage.count()).toBe(outboxBefore);
  });

  it("atomically accepts one concurrent online scan and records later duplicates", async () => {
    const scope = await seed(1); const admission = new PrimaryAdmissionService(db, capability, config, () => new Date(now)); const [issued] = await admission.issue({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "scan-concurrent-issue" }); const operator = await scanner(scope);
    const scans = new PrimaryAdmissionScanService(db, capability, admission, () => new Date(now));
    const [a, b] = await Promise.all(["a", "b"].map((suffix) => scans.scan({ actor: { id: operator.id, role: operator.role }, organizerId: scope.organizer.id, eventId: scope.event.id, token: issued.token, requestId: `scan-concurrent-${suffix}`, deviceId: "gate-a" })));
    expect([a.result, b.result].sort()).toEqual(["ACCEPTED", "DUPLICATE"]); expect(await db.primaryAdmissionScan.count({ where: { admissionTicketId: issued.ticket.id } })).toBe(2); expect((await db.primaryAdmissionTicket.findUniqueOrThrow({ where: { id: issued.ticket.id } })).status).toBe("CHECKED_IN");
    await expect(db.primaryAdmissionScan.update({ where: { id: a.scanId! }, data: { deviceId: "changed" } })).rejects.toBeTruthy(); await expect(db.primaryAdmissionScan.delete({ where: { id: b.scanId! } })).rejects.toBeTruthy();
  });

  it("denies unassigned, stale-role, banned, cross-tenant, suspended, and platform-admin operators without evidence", async () => {
    const scope = await seed(1); const admission = new PrimaryAdmissionService(db, capability, config, () => new Date(now)); const [issued] = await admission.issue({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "scan-auth-issue" }); const scans = new PrimaryAdmissionScanService(db, capability, admission, () => new Date(now));
    const unassigned = await scanner(scope, "SCANNER", false); const before = await db.primaryAdmissionScan.count();
    await expect(scans.scan({ actor: { id: unassigned.id, role: unassigned.role }, organizerId: scope.organizer.id, eventId: scope.event.id, token: issued.token, requestId: "scan-unassigned" })).resolves.toMatchObject({ result: "UNAUTHORIZED_OPERATOR" });
    const assigned = await scanner(scope); await db.user.update({ where: { id: assigned.id }, data: { isBanned: true } }); await expect(scans.scan({ actor: { id: assigned.id, role: assigned.role }, organizerId: scope.organizer.id, eventId: scope.event.id, token: issued.token, requestId: "scan-banned" })).resolves.toMatchObject({ result: "UNAUTHORIZED_OPERATOR" });
    await db.user.update({ where: { id: assigned.id }, data: { isBanned: false, role: "ADMIN" } }); await expect(scans.scan({ actor: { id: assigned.id, role: "USER" }, organizerId: scope.organizer.id, eventId: scope.event.id, token: issued.token, requestId: "scan-stale" })).resolves.toMatchObject({ result: "UNAUTHORIZED_OPERATOR" }); await expect(scans.scan({ actor: { id: assigned.id, role: "ADMIN" }, organizerId: scope.organizer.id, eventId: scope.event.id, token: issued.token, requestId: "scan-admin" })).resolves.toMatchObject({ result: "UNAUTHORIZED_OPERATOR" });
    await db.primaryOrganizer.update({ where: { id: scope.organizer.id }, data: { status: "SUSPENDED", statusReason: "Synthetic" } }); await expect(scans.scan({ actor: { id: unassigned.id, role: unassigned.role }, organizerId: scope.organizer.id, eventId: scope.event.id, token: issued.token, requestId: "scan-suspended" })).resolves.toMatchObject({ result: "UNAUTHORIZED_OPERATOR" }); expect(await db.primaryAdmissionScan.count()).toBe(before);
  });

  it("returns bounded evidence codes for wrong-event, voided, unknown, tampered, and unsupported credentials", async () => {
    const scope = await seed(1); const other = await seed(1); const admission = new PrimaryAdmissionService(db, capability, config, () => new Date(now)); const [issued] = await admission.issue({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "scan-results-issue" }); const operator = await scanner(scope); const scans = new PrimaryAdmissionScanService(db, capability, admission, () => new Date(now)); const base = { actor: { id: operator.id, role: operator.role }, organizerId: scope.organizer.id, eventId: scope.event.id, requestId: "scan-code" };
    const wrongToken = (await admission.issue({ internalCapability: internal, organizerId: other.organizer.id, eventId: other.event.id, orderId: other.order.id, idempotencyKey: "other-issue" }))[0].token; await expect(scans.scan({ ...base, token: wrongToken, requestId: "scan-wrong-event" })).resolves.toMatchObject({ result: "WRONG_EVENT" });
    await admission.void({ internalCapability: internal, admissionTicketId: issued.ticket.id, reason: "Synthetic", idempotencyKey: "void-before-scan" }); await expect(scans.scan({ ...base, token: issued.token, requestId: "scan-voided" })).resolves.toMatchObject({ result: "VOIDED" });
    const unknown = signedToken({ v: 1, cid: "11111111-1111-4111-8111-111111111111", eventId: scope.event.id, iat: now.toISOString(), kid: "test_admission_1" }); await expect(scans.scan({ ...base, token: unknown, requestId: "scan-unknown" })).resolves.toMatchObject({ result: "UNKNOWN_CREDENTIAL" }); await expect(scans.scan({ ...base, token: `${issued.token}x`, requestId: "scan-tampered" })).resolves.toMatchObject({ result: "INVALID_CREDENTIAL" });
    const foreign = generateKeyPairSync("ed25519"); const foreignPayload = { v: 1, cid: "22222222-2222-4222-8222-222222222222", eventId: scope.event.id, iat: now.toISOString(), kid: "test_unknown" }; const body = JSON.stringify(foreignPayload); const foreignToken = `${Buffer.from(body).toString("base64url")}.${sign(null, Buffer.from(body), foreign.privateKey).toString("base64url")}`; await expect(scans.scan({ ...base, token: foreignToken, requestId: "scan-key" })).resolves.toMatchObject({ result: "UNSUPPORTED_KEY" });
  });

  it("verifies prior public keys without prior private signing material", async () => {
    const old = generateKeyPairSync("ed25519"); const scope = await seed(1); const currentAdmission = new PrimaryAdmissionService(db, capability, config, () => new Date(now)); const operator = await scanner(scope); const ticketData = await directTicket(scope, 1); const credentialId = "33333333-3333-4333-8333-333333333333"; const payload = { v: 1, cid: credentialId, eventId: scope.event.id, iat: now.toISOString(), kid: "test_prior" }; const body = JSON.stringify(payload); const token = `${Buffer.from(body).toString("base64url")}.${sign(null, Buffer.from(body), old.privateKey).toString("base64url")}`;
    await db.primaryAdmissionTicket.create({ data: { ...ticketData, credential: { create: { id: credentialId, payloadVersion: 1, keyId: "test_prior", payloadDigest: createHash("sha256").update(body).digest("hex"), issuedAt: now } } } });
    const keyring = requirePrimaryAdmissionTestConfig(capability, { NODE_ENV: "test", PRIMARY_ADMISSION_SIGNING_KEY_ID: "test_admission_1", PRIMARY_ADMISSION_PRIVATE_KEY: privatePem, PRIMARY_ADMISSION_PUBLIC_KEY: publicPem, PRIMARY_ADMISSION_PRIOR_PUBLIC_KEYS_JSON: JSON.stringify({ test_prior: old.publicKey.export({ type: "spki", format: "pem" }).toString() }) } as NodeJS.ProcessEnv); const scans = new PrimaryAdmissionScanService(db, capability, new PrimaryAdmissionService(db, capability, keyring), () => new Date(now));
    await expect(scans.scan({ actor: { id: operator.id, role: operator.role }, organizerId: scope.organizer.id, eventId: scope.event.id, token, requestId: "scan-prior-key" })).resolves.toMatchObject({ result: "ACCEPTED" });
    await expect(new PrimaryAdmissionScanService(db, capability, currentAdmission).scan({ actor: { id: operator.id, role: operator.role }, organizerId: scope.organizer.id, eventId: scope.event.id, token, requestId: "scan-prior-missing" })).resolves.toMatchObject({ result: "UNSUPPORTED_KEY" });
    const revoked = requirePrimaryAdmissionTestConfig(capability, { NODE_ENV: "test", PRIMARY_ADMISSION_SIGNING_KEY_ID: "test_admission_1", PRIMARY_ADMISSION_PRIVATE_KEY: privatePem, PRIMARY_ADMISSION_PUBLIC_KEY: publicPem, PRIMARY_ADMISSION_PRIOR_PUBLIC_KEYS_JSON: JSON.stringify({ test_prior: old.publicKey.export({ type: "spki", format: "pem" }).toString() }), PRIMARY_ADMISSION_REVOKED_KEY_IDS: "test_prior" } as NodeJS.ProcessEnv); await expect(new PrimaryAdmissionScanService(db, capability, new PrimaryAdmissionService(db, capability, revoked)).scan({ actor: { id: operator.id, role: operator.role }, organizerId: scope.organizer.id, eventId: scope.event.id, token, requestId: "scan-prior-revoked" })).resolves.toMatchObject({ result: "UNSUPPORTED_KEY" });
  });

  it("allows every assigned event-day role and requires assignment even for owners", async () => {
    for (const role of ["OWNER", "EVENT_MANAGER", "BOX_OFFICE", "SCANNER"] as const) {
      const scope = await seed(1); const admission = new PrimaryAdmissionService(db, capability, config, () => new Date(now)); const [issued] = await admission.issue({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: `role-${role}` }); const operator = await scanner(scope, role); const scans = new PrimaryAdmissionScanService(db, capability, admission); await expect(scans.scan({ actor: { id: operator.id, role: operator.role }, organizerId: scope.organizer.id, eventId: scope.event.id, token: issued.token, requestId: `role-scan-${role}` })).resolves.toMatchObject({ result: "ACCEPTED" });
    }
    const scope = await seed(1); const admission = new PrimaryAdmissionService(db, capability, config); const [issued] = await admission.issue({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "owner-no-assignment" }); const owner = await scanner(scope, "OWNER", false); await expect(new PrimaryAdmissionScanService(db, capability, admission).scan({ actor: { id: owner.id, role: owner.role }, organizerId: scope.organizer.id, eventId: scope.event.id, token: issued.token, requestId: "owner-no-assignment-scan" })).resolves.toMatchObject({ result: "UNAUTHORIZED_OPERATOR" });
  });

  it("rolls back check-in and scan evidence when successful-admission outbox persistence fails", async () => {
    const scope = await seed(1); const admission = new PrimaryAdmissionService(db, capability, config, () => new Date(now)); const [issued] = await admission.issue({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "scan-rollback-issue" }); const operator = await scanner(scope); const requestId = "scan-rollback"; await db.primaryOutboxMessage.create({ data: { organizerId: scope.organizer.id, topic: "synthetic", aggregateType: "Synthetic", aggregateId: scope.order.id, payloadJson: {}, idempotencyKey: `${requestId}:admission_checked_in` } }); const scansBefore = await db.primaryAdmissionScan.count(); const auditsBefore = await db.primaryAuditEvent.count();
    await expect(new PrimaryAdmissionScanService(db, capability, admission).scan({ actor: { id: operator.id, role: operator.role }, organizerId: scope.organizer.id, eventId: scope.event.id, token: issued.token, requestId })).rejects.toBeTruthy(); expect((await db.primaryAdmissionTicket.findUniqueOrThrow({ where: { id: issued.ticket.id } })).status).toBe("ISSUED"); expect(await db.primaryAdmissionScan.count()).toBe(scansBefore); expect(await db.primaryAuditEvent.count()).toBe(auditsBefore);
  });

  it("database constraints reject cross-ticket scan evidence and invalid telemetry", async () => {
    const scope = await seed(2); const admission = new PrimaryAdmissionService(db, capability, config, () => new Date(now)); const issued = await admission.issue({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "scan-scope-issue" }); const operator = await scanner(scope);
    await expect(db.primaryAdmissionScan.create({ data: { organizerId: scope.organizer.id, eventId: scope.event.id, admissionTicketId: issued[0].ticket.id, credentialId: issued[1].ticket.credential!.id, operatorUserId: operator.id, result: "DUPLICATE" } })).rejects.toBeTruthy();
    await expect(db.primaryAdmissionScan.create({ data: { organizerId: scope.organizer.id, eventId: scope.event.id, operatorUserId: operator.id, result: "INVALID_CREDENTIAL", deviceId: "raw device label with spaces" } })).rejects.toBeTruthy();
  });
});
