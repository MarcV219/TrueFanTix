/** @jest-environment node */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { requirePrimaryPreflight } from "@/lib/primary/config";
import {
  createPrimaryReservationInternalCapabilityForTests,
  PrimaryReservationService,
  type PrimaryReservationInternalCapability,
} from "@/lib/primary/reservation-service";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) {
  describe.skip("primary reservation PostgreSQL integration", () => {
    it("requires an explicitly isolated integration database", () => undefined);
  });
} else {
describe("primary reservation PostgreSQL integration", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const capability = requirePrimaryPreflight({
    NODE_ENV: "test", PRIMARY_TICKETING_ENABLED: "true",
    PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-test", PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-test",
    PRIMARY_TICKETING_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl,
  } as NodeJS.ProcessEnv);
  let now = new Date("2033-01-01T12:00:00.000Z");
  const service = new PrimaryReservationService(db, capability, () => new Date(now), 60_000, 300_000);
  let internal: PrimaryReservationInternalCapability;
  let sequence = 0;
  const userData = (role: "USER" | "ADMIN" = "USER") => {
    sequence += 1;
    return { email: `reservation-${sequence}@example.test`, passwordHash: "synthetic", emailVerifiedAt: new Date(),
      firstName: "Synthetic", lastName: `${sequence}`, phone: `+1888${String(sequence).padStart(7, "0")}`,
      phoneVerifiedAt: new Date(), streetAddress1: "1 Test", city: "Toronto", region: "ON",
      postalCode: "A1A1A1", country: "CA", role };
  };
  const actor = (user: { id: string; role: "USER" | "ADMIN" }) => ({ id: user.id, role: user.role });
  const seed = async (options: { eventCapacity?: number; allocation?: number; typeStatus?: "ACTIVE" | "INACTIVE"; eventStatus?: "APPROVED" | "DRAFT"; organizerStatus?: "APPROVED" | "DRAFT" | "SUSPENDED"; minimum?: number; maximum?: number } = {}) => {
    const owner = await db.user.create({ data: userData() });
    const buyer = await db.user.create({ data: userData() });
    const organizer = await db.primaryOrganizer.create({ data: {
      legalName: `Reservation ${sequence}`, displayName: `Reservation ${sequence}`, addressLine1: "1 Test", city: "Toronto", region: "ON",
      postalCode: "A1A1A1", country: "CA", supportEmail: `reservation-org-${sequence}@example.test`, status: options.organizerStatus ?? "APPROVED", createdByUserId: owner.id,
    } });
    const event = await db.primaryEvent.create({ data: {
      organizerId: organizer.id, title: "Approved GA", description: "Synthetic", category: "CONCERT", venueName: "Hall",
      venueAddressLine1: "1 Test", venueCity: "Toronto", venueRegion: "ON", venuePostalCode: "A1A1A1", venueCountry: "CA",
      startsAtLocal: new Date("2034-01-01T19:00:00Z"), endsAtLocal: new Date("2034-01-01T22:00:00Z"), timezone: "America/Toronto",
      contactEmail: "events@example.test", draftPolicyText: "Synthetic", totalCapacity: options.eventCapacity ?? 10, status: options.eventStatus ?? "APPROVED",
    } });
    const ticketType = await db.primaryTicketType.create({ data: {
      organizerId: organizer.id, eventId: event.id, name: "GA", allocatedQuantity: options.allocation ?? 10,
      status: options.typeStatus ?? "ACTIVE", minimumPerOrder: options.minimum, maximumPerOrder: options.maximum,
      currency: "CAD", basePriceMinor: 2500,
    } });
    return { owner, buyer, organizer, event, ticketType };
  };
  const hold = (scope: Awaited<ReturnType<typeof seed>>, quantity: number, key: string, buyer = scope.buyer) => service.createHold({
    actor: actor(buyer), organizerId: scope.organizer.id, eventId: scope.event.id, ticketTypeId: scope.ticketType.id, quantity, idempotencyKey: key,
  });

  beforeAll(async () => {
    process.env.PRIMARY_TICKETING_ENVIRONMENT_ID = "isolated-test";
    internal = createPrimaryReservationInternalCapabilityForTests();
    await db.primaryOrderPriceComponent.deleteMany();
    await db.primaryOrderLine.deleteMany();
    await db.primaryOrder.deleteMany();
    await db.primaryInventoryReservation.deleteMany();
    await db.primaryEventStaffAssignment.deleteMany();
    await db.primaryAuditEvent.deleteMany();
    await db.primaryOutboxMessage.deleteMany();
    await db.primaryTicketType.deleteMany();
    await db.primaryOrganizerMembership.deleteMany();
    await db.primaryEvent.deleteMany();
    await db.primaryOrganizer.deleteMany();
    await db.user.deleteMany({ where: { email: { startsWith: "reservation-", endsWith: "@example.test" } } });
  });
  beforeEach(() => { now = new Date("2033-01-01T12:00:00.000Z"); });
  afterAll(async () => { delete process.env.PRIMARY_TICKETING_ENVIRONMENT_ID; await db.$disconnect(); await pool.end(); });

  it("serializes concurrent last-unit holds", async () => {
    const scope = await seed({ eventCapacity: 1, allocation: 1 });
    const otherBuyer = await db.user.create({ data: userData() });
    const results = await Promise.allSettled([hold(scope, 1, "last-unit-a"), hold(scope, 1, "last-unit-b", otherBuyer)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.primaryInventoryReservation.count({ where: { eventId: scope.event.id } })).toBe(1);
    expect(await db.primaryAuditEvent.count({ where: { eventId: scope.event.id } })).toBe(1);
    expect(await db.primaryOutboxMessage.count({ where: { organizerId: scope.organizer.id } })).toBe(1);
  });

  it("enforces aggregate event capacity across ticket types", async () => {
    const scope = await seed({ eventCapacity: 2, allocation: 2 });
    const secondType = await db.primaryTicketType.create({ data: { organizerId: scope.organizer.id, eventId: scope.event.id, name: "GA 2", allocatedQuantity: 2, status: "ACTIVE", currency: "CAD", basePriceMinor: 3000 } });
    await hold(scope, 2, "aggregate-first");
    await expect(service.createHold({ actor: actor(scope.buyer), organizerId: scope.organizer.id, eventId: scope.event.id, ticketTypeId: secondType.id, quantity: 1, idempotencyKey: "aggregate-second" }))
      .rejects.toMatchObject({ code: "INSUFFICIENT_RESERVABLE_CAPACITY" });
  });

  it("reuses capacity after idempotent release and expiry", async () => {
    const scope = await seed({ eventCapacity: 2, allocation: 2 });
    const first = await hold(scope, 2, "reuse-first");
    const released = await service.release({ actor: actor(scope.buyer), organizerId: scope.organizer.id, eventId: scope.event.id, reservationId: first.id, idempotencyKey: "release-first" });
    await expect(service.release({ actor: actor(scope.buyer), organizerId: scope.organizer.id, eventId: scope.event.id, reservationId: first.id, idempotencyKey: "release-first" })).resolves.toEqual(released);
    await expect(service.release({ actor: actor(scope.buyer), organizerId: scope.organizer.id, eventId: scope.event.id, reservationId: first.id, idempotencyKey: "release-mismatch" })).rejects.toMatchObject({ code: "RESERVATION_NOT_RELEASABLE" });
    const second = await hold(scope, 2, "reuse-second");
    now = new Date(now.getTime() + 60_001);
    const expired = await service.expireHeld({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, reservationId: second.id, idempotencyKey: "expire-second" });
    await expect(service.expireHeld({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, reservationId: second.id, idempotencyKey: "expire-second" })).resolves.toEqual(expired);
    await expect(service.expireHeld({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, reservationId: second.id, idempotencyKey: "expire-mismatch" })).rejects.toMatchObject({ code: "RESERVATION_NOT_EXPIRABLE" });
    await expect(hold(scope, 2, "reuse-third")).resolves.toMatchObject({ status: "HELD" });
  });

  it("makes hold creation replay-safe and rejects changed idempotent input", async () => {
    const scope = await seed();
    const first = await hold(scope, 2, "hold-replay");
    await expect(hold(scope, 2, "hold-replay")).resolves.toEqual(first);
    await expect(hold(scope, 3, "hold-replay")).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await db.primaryInventoryReservation.count({ where: { eventId: scope.event.id } })).toBe(1);
    expect(await db.primaryAuditEvent.count({ where: { eventId: scope.event.id } })).toBe(1);
  });

  it("enforces positive quantity and ticket-type order limits", async () => {
    const scope = await seed({ minimum: 2, maximum: 4 });
    await expect(hold(scope, 0, "quantity-zero")).rejects.toMatchObject({ code: "INVALID_RESERVATION_QUANTITY" });
    await expect(hold(scope, 1, "quantity-low")).rejects.toMatchObject({ code: "RESERVATION_ORDER_LIMIT" });
    await expect(hold(scope, 5, "quantity-high")).rejects.toMatchObject({ code: "RESERVATION_ORDER_LIMIT" });
    expect(await db.primaryInventoryReservation.count({ where: { eventId: scope.event.id } })).toBe(0);
  });

  it("denies inactive, wrong-tenant, suspended, non-approved, unverified, and admin buyers", async () => {
    const [inactive, suspended, draftOrganizer, draftEvent, valid] = await Promise.all([
      seed({ typeStatus: "INACTIVE" }), seed({ organizerStatus: "SUSPENDED" }), seed({ organizerStatus: "DRAFT" }), seed({ eventStatus: "DRAFT" }), seed(),
    ]);
    const [unverified, banned, staleRole, admin] = await Promise.all([
      db.user.create({ data: { ...userData(), emailVerifiedAt: null } }), db.user.create({ data: { ...userData(), isBanned: true } }),
      db.user.create({ data: userData() }), db.user.create({ data: userData("ADMIN") }),
    ]);
    const attempts = [
      hold(inactive, 1, "deny-inactive"), hold(suspended, 1, "deny-suspended"), hold(draftOrganizer, 1, "deny-organizer"), hold(draftEvent, 1, "deny-event"),
      service.createHold({ actor: actor(valid.buyer), organizerId: inactive.organizer.id, eventId: valid.event.id, ticketTypeId: valid.ticketType.id, quantity: 1, idempotencyKey: "deny-tenant" }),
      hold(valid, 1, "deny-unverified", unverified), hold(valid, 1, "deny-banned", banned),
      service.createHold({ actor: { id: staleRole.id, role: "ADMIN" }, organizerId: valid.organizer.id, eventId: valid.event.id, ticketTypeId: valid.ticketType.id, quantity: 1, idempotencyKey: "deny-stale-role" }),
      hold(valid, 1, "deny-admin", admin),
    ];
    expect((await Promise.allSettled(attempts)).every((result) => result.status === "rejected")).toBe(true);
    expect(await db.primaryInventoryReservation.count({ where: { eventId: { in: [inactive.event.id, suspended.event.id, draftOrganizer.event.id, draftEvent.event.id, valid.event.id] } } })).toBe(0);
  });

  it("keeps PAYMENT_COMMITTED capacity non-expiring with reconciliation metadata", async () => {
    const scope = await seed({ eventCapacity: 1, allocation: 1 });
    const reservation = await hold(scope, 1, "commit-hold");
    const committed = await service.commitForPayment({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, reservationId: reservation.id, idempotencyKey: "commit-once" });
    expect(committed).toMatchObject({ status: "PAYMENT_COMMITTED", paymentCommittedAt: now });
    expect(committed.reconciliationAfter).toEqual(new Date(now.getTime() + 300_000));
    await expect(service.commitForPayment({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, reservationId: reservation.id, idempotencyKey: "commit-once" })).resolves.toEqual(committed);
    await expect(service.commitForPayment({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, reservationId: reservation.id, idempotencyKey: "commit-mismatch" })).rejects.toMatchObject({ code: "RESERVATION_NOT_COMMITTABLE" });
    now = new Date(now.getTime() + 600_000);
    await expect(service.expireHeld({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, reservationId: reservation.id, idempotencyKey: "must-not-expire" }))
      .rejects.toMatchObject({ code: "PAYMENT_COMMITTED_CANNOT_EXPIRE" });
    await expect(hold(scope, 1, "blocked-by-commit")).rejects.toMatchObject({ code: "INSUFFICIENT_RESERVABLE_CAPACITY" });
    expect(() => service.commitForPayment({ internalCapability: { kind: "PrimaryReservationInternalCapability" } as PrimaryReservationInternalCapability, organizerId: scope.organizer.id, eventId: scope.event.id, reservationId: reservation.id, idempotencyKey: "forged" }))
      .toThrow("RESERVATION_INTERNAL_BOUNDARY_FORBIDDEN");
  });

  it("rolls back reservation and audit when outbox persistence conflicts", async () => {
    const scope = await seed();
    await db.primaryOutboxMessage.create({ data: {
      organizerId: scope.organizer.id, topic: "synthetic.conflict", aggregateType: "Synthetic", aggregateId: scope.event.id,
      payloadJson: {}, idempotencyKey: "rollback-hold:reservation_held",
    } });
    await expect(hold(scope, 1, "rollback-hold")).rejects.toBeTruthy();
    expect(await db.primaryInventoryReservation.count({ where: { eventId: scope.event.id } })).toBe(0);
    expect(await db.primaryAuditEvent.count({ where: { eventId: scope.event.id } })).toBe(0);
    expect(await db.primaryOutboxMessage.count({ where: { organizerId: scope.organizer.id } })).toBe(1);
  });
});
}
