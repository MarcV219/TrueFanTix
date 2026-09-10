/** @jest-environment node */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { requirePrimaryPreflight } from "@/lib/primary/config";
import { createPrimaryOrderInternalCapabilityForTests, PrimaryOrderService, type PrimaryOrderInternalCapability } from "@/lib/primary/order-service";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;
if (!databaseUrl) {
  describe.skip("primary order PostgreSQL integration", () => { it("requires an isolated database", () => undefined); });
} else {
describe("primary order PostgreSQL integration", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const capability = requirePrimaryPreflight({ NODE_ENV: "test", PRIMARY_TICKETING_ENABLED: "true", PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-test", PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-test", PRIMARY_TICKETING_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl } as NodeJS.ProcessEnv);
  let now = new Date("2035-01-01T12:00:00Z");
  const service = new PrimaryOrderService(db, capability, () => new Date(now));
  let internal: PrimaryOrderInternalCapability;
  let sequence = 0;
  const seed = async (reservationStatus: "HELD" | "RELEASED" = "HELD", expiresAt = new Date(now.getTime() + 60_000)) => {
    const id = ++sequence;
    const buyer = await db.user.create({ data: { email: `order-${id}@example.test`, passwordHash: "synthetic", emailVerifiedAt: new Date(), firstName: "Order", lastName: `${id}`, phone: `+1999${String(id).padStart(7, "0")}`, phoneVerifiedAt: new Date(), streetAddress1: "1 Test", city: "Toronto", region: "ON", postalCode: "A1A1A1", country: "CA" } });
    const organizer = await db.primaryOrganizer.create({ data: { legalName: `Order ${id}`, displayName: `Order ${id}`, addressLine1: "1 Test", city: "Toronto", region: "ON", postalCode: "A1A1A1", country: "CA", supportEmail: `order-org-${id}@example.test`, status: "APPROVED", createdByUserId: buyer.id } });
    const event = await db.primaryEvent.create({ data: { organizerId: organizer.id, title: "Order Event", description: "Synthetic", category: "CONCERT", venueName: "Hall", venueAddressLine1: "1 Test", venueCity: "Toronto", venueRegion: "ON", venuePostalCode: "A1A1A1", venueCountry: "CA", startsAtLocal: new Date("2036-01-01T19:00:00Z"), endsAtLocal: new Date("2036-01-01T22:00:00Z"), timezone: "America/Toronto", contactEmail: "events@example.test", draftPolicyText: "Synthetic", totalCapacity: 10, status: "APPROVED" } });
    const ticketType = await db.primaryTicketType.create({ data: { organizerId: organizer.id, eventId: event.id, name: "GA Snapshot", allocatedQuantity: 10, status: "ACTIVE", currency: "CAD", basePriceMinor: 2500 } });
    const reservation = await db.primaryInventoryReservation.create({ data: { organizerId: organizer.id, eventId: event.id, ticketTypeId: ticketType.id, buyerUserId: buyer.id, quantity: 3, status: reservationStatus, expiresAt, releasedAt: reservationStatus === "RELEASED" ? now : undefined, createIdempotencyKey: `order-reservation-${id}` } });
    return { buyer, organizer, event, ticketType, reservation };
  };
  const create = (scope: Awaited<ReturnType<typeof seed>>, key: string, components = [{ code: "SERVICE_FEE", label: "Synthetic configurable fee", kind: "MANDATORY_FEE" as const, amountMinor: 5 }]) => service.create({ internalCapability: internal, actor: { id: scope.buyer.id, role: scope.buyer.role }, organizerId: scope.organizer.id, eventId: scope.event.id, reservationId: scope.reservation.id, idempotencyKey: key, additionalComponents: components });

  beforeAll(async () => {
    process.env.PRIMARY_TICKETING_ENVIRONMENT_ID = "isolated-test";
    internal = createPrimaryOrderInternalCapabilityForTests();
    await db.primaryOrderPriceComponent.deleteMany(); await db.primaryOrderLine.deleteMany(); await db.primaryOrder.deleteMany();
    await db.primaryInventoryReservation.deleteMany(); await db.primaryAuditEvent.deleteMany(); await db.primaryOutboxMessage.deleteMany();
    await db.primaryTicketType.deleteMany(); await db.primaryEvent.deleteMany(); await db.primaryOrganizer.deleteMany();
    await db.user.deleteMany({ where: { email: { startsWith: "order-", endsWith: "@example.test" } } });
  });
  beforeEach(() => { now = new Date("2035-01-01T12:00:00Z"); });
  afterAll(async () => { delete process.env.PRIMARY_TICKETING_ENVIRONMENT_ID; await db.$disconnect(); await pool.end(); });

  it("creates exact immutable face-value and deterministic component snapshots", async () => {
    const scope = await seed();
    const order = await create(scope, "snapshot-create");
    expect(order).toMatchObject({ status: "PENDING_PAYMENT", currency: "CAD", faceValueSubtotalMinor: 7500, grossTotalMinor: 7505 });
    expect(order.lines[0]).toMatchObject({ quantity: 3, ticketTypeNameSnapshot: "GA Snapshot", unitFaceValueMinor: 2500, faceValueSubtotalMinor: 7500 });
    expect(order.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "FACE_VALUE", amountMinor: 7500, allocationBaseMinor: 2500, allocationRemainderUnits: 0 }),
      expect.objectContaining({ code: "SERVICE_FEE", amountMinor: 5, allocationBaseMinor: 1, allocationRemainderUnits: 2 }),
    ]));
    await db.primaryTicketType.update({ where: { id: scope.ticketType.id }, data: { name: "Changed", basePriceMinor: 9999 } });
    expect(await db.primaryOrderLine.findUniqueOrThrow({ where: { orderId: order.id } })).toMatchObject({ ticketTypeNameSnapshot: "GA Snapshot", unitFaceValueMinor: 2500 });
  });

  it("allows only one order per reservation under concurrency", async () => {
    const scope = await seed();
    const results = await Promise.allSettled([create(scope, "one-order-a"), create(scope, "one-order-b")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.primaryOrder.count({ where: { reservationId: scope.reservation.id } })).toBe(1);
  });

  it("replays exact creation and rejects changed idempotent binding", async () => {
    const firstScope = await seed(); const secondScope = await seed();
    const first = await create(firstScope, "order-replay");
    await expect(create(firstScope, "order-replay")).resolves.toEqual(first);
    await expect(create(firstScope, "order-replay", [{ code: "OTHER_FEE", label: "Different", kind: "MANDATORY_FEE", amountMinor: 5 }])).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(create(secondScope, "order-replay")).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("rejects expired and released reservations and invalid component amounts", async () => {
    const [expired, released, valid] = await Promise.all([seed("HELD", new Date(now.getTime() - 1)), seed("RELEASED"), seed()]);
    await expect(create(expired, "expired-order")).rejects.toMatchObject({ code: "RESERVATION_NOT_ORDERABLE" });
    await expect(create(released, "released-order")).rejects.toMatchObject({ code: "RESERVATION_NOT_ORDERABLE" });
    await expect(create(valid, "invalid-amount", [{ code: "FEE", label: "Fee", kind: "MANDATORY_FEE", amountMinor: 0 }])).rejects.toMatchObject({ code: "INVALID_PRICE_COMPONENT_AMOUNT" });
    await db.primaryTicketType.update({ where: { id: valid.ticketType.id }, data: { currency: "ZZZ" } });
    await expect(create(valid, "invalid-currency", [])).rejects.toMatchObject({ code: "INVALID_CURRENCY" });
  });

  it("atomically commits the reservation before entering payment processing", async () => {
    const scope = await seed(); const order = await create(scope, "prepare-create", []);
    const prepared = await service.prepareForPayment({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: order.id, idempotencyKey: "prepare-once" });
    expect(prepared).toMatchObject({ status: "PAYMENT_PROCESSING", paymentProcessingAt: now });
    expect(await db.primaryInventoryReservation.findUniqueOrThrow({ where: { id: scope.reservation.id } })).toMatchObject({ status: "PAYMENT_COMMITTED", paymentCommittedAt: now });
    await expect(service.prepareForPayment({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: order.id, idempotencyKey: "prepare-once" })).resolves.toEqual(prepared);
  });

  it("rolls back order, line, component, and audit when outbox persistence fails", async () => {
    const scope = await seed();
    await db.primaryOutboxMessage.create({ data: { organizerId: scope.organizer.id, topic: "conflict", aggregateType: "Synthetic", aggregateId: scope.event.id, payloadJson: {}, idempotencyKey: "order-rollback:order_created" } });
    await expect(create(scope, "order-rollback")).rejects.toBeTruthy();
    expect(await db.primaryOrder.count({ where: { reservationId: scope.reservation.id } })).toBe(0);
    expect(await db.primaryOrderLine.count({ where: { ticketTypeId: scope.ticketType.id } })).toBe(0);
    expect(await db.primaryAuditEvent.count({ where: { eventId: scope.event.id } })).toBe(0);
  });

  it("rolls back reservation commitment when order-transition outbox persistence fails", async () => {
    const scope = await seed(); const order = await create(scope, "prepare-rollback-create", []);
    await db.primaryOutboxMessage.create({ data: { organizerId: scope.organizer.id, topic: "conflict", aggregateType: "Synthetic", aggregateId: order.id, payloadJson: {}, idempotencyKey: "prepare-rollback:order_payment_processing" } });
    const auditBefore = await db.primaryAuditEvent.count({ where: { eventId: scope.event.id } });
    await expect(service.prepareForPayment({ internalCapability: internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: order.id, idempotencyKey: "prepare-rollback" })).rejects.toBeTruthy();
    expect(await db.primaryOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "PENDING_PAYMENT", paymentProcessingAt: null });
    expect(await db.primaryInventoryReservation.findUniqueOrThrow({ where: { id: scope.reservation.id } })).toMatchObject({ status: "HELD", paymentCommittedAt: null });
    expect(await db.primaryAuditEvent.count({ where: { eventId: scope.event.id } })).toBe(auditBefore);
  });
});
}
