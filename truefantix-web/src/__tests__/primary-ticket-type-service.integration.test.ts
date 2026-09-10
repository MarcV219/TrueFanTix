/** @jest-environment node */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { requirePrimaryPreflight } from "@/lib/primary/config";
import { PrimaryEventService, type PrimaryEventDraftFields } from "@/lib/primary/event-service";
import { PrimaryTicketTypeService, type PrimaryTicketTypeFields } from "@/lib/primary/ticket-type-service";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) {
  describe.skip("primary ticket type PostgreSQL integration", () => {
    it("requires an explicitly isolated integration database", () => undefined);
  });
} else {
describe("primary ticket type PostgreSQL integration", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const capability = requirePrimaryPreflight({
    NODE_ENV: "test", PRIMARY_TICKETING_ENABLED: "true",
    PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-test", PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-test",
    PRIMARY_TICKETING_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl,
  } as NodeJS.ProcessEnv);
  const service = new PrimaryTicketTypeService(db, capability);
  const eventService = new PrimaryEventService(db, capability);
  let sequence = 0;
  const userData = (role: "USER" | "ADMIN" = "USER") => {
    sequence += 1;
    return { email: `ticket-type-${sequence}@example.test`, passwordHash: "synthetic", emailVerifiedAt: new Date(),
      firstName: "Synthetic", lastName: `${sequence}`, phone: `+1777${String(sequence).padStart(7, "0")}`,
      phoneVerifiedAt: new Date(), streetAddress1: "1 Test Street", city: "Toronto", region: "ON",
      postalCode: "A1A1A1", country: "CA", role };
  };
  const actor = (user: { id: string; role: "USER" | "ADMIN" }) => ({ id: user.id, role: user.role });
  const eventFields = (totalCapacity = 100): PrimaryEventDraftFields => ({
    title: "GA Test Event", description: "Synthetic capacity test", category: "CONCERT",
    venueName: "Test Hall", venueAddressLine1: "1 Test Street", venueCity: "Toronto", venueRegion: "ON",
    venuePostalCode: "A1A1A1", venueCountry: "CA", startsAtLocal: "2032-05-01T19:00",
    endsAtLocal: "2032-05-01T22:00", timezone: "America/Toronto", contactEmail: "events@example.test",
    draftPolicyText: "Synthetic only", totalCapacity,
  });
  const typeFields = (allocatedQuantity = 50, status: "ACTIVE" | "INACTIVE" = "ACTIVE"): PrimaryTicketTypeFields => ({
    name: "General Admission", allocatedQuantity, status, minimumPerOrder: 1, maximumPerOrder: 8,
    currency: "CAD", basePriceMinor: 2500,
  });
  const seed = async (status: "APPROVED" | "SUSPENDED" = "APPROVED") => {
    const owner = await db.user.create({ data: userData() });
    const organizer = await db.primaryOrganizer.create({ data: {
      legalName: `GA ${sequence}`, displayName: `GA ${sequence}`, addressLine1: "1 Test", city: "Toronto", region: "ON",
      postalCode: "A1A1A1", country: "CA", supportEmail: `ga-${sequence}@example.test`, status, createdByUserId: owner.id,
      memberships: { create: { userId: owner.id, role: "OWNER", status: "ACTIVE", invitedByUserId: owner.id, acceptedAt: new Date() } },
    } });
    const event = await eventService.createDraft({ actor: actor(owner), organizerId: organizer.id, requestId: `event-${sequence}`, fields: eventFields() });
    return { owner, organizer, event };
  };

  beforeAll(async () => {
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
    await db.user.deleteMany({ where: { email: { startsWith: "ticket-type-", endsWith: "@example.test" } } });
  });
  afterAll(async () => { await db.$disconnect(); await pool.end(); });

  it("creates and updates draft capacity and ticket types with exact audit/outbox pairs", async () => {
    const { owner, organizer, event } = await seed();
    const before = await db.primaryAuditEvent.count({ where: { eventId: event.id } });
    const created = await service.create({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "ga-create", fields: typeFields(60) });
    expect(created).toMatchObject({ allocatedQuantity: 60, currency: "CAD", basePriceMinor: 2500 });
    await service.updateCapacity({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "ga-capacity", totalCapacity: 120 });
    await service.update({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, ticketTypeId: created.id, requestId: "ga-update", fields: { ...typeFields(80), name: "Advance GA" } });
    expect(await db.primaryAuditEvent.count({ where: { eventId: event.id } })).toBe(before + 3);
    expect(await db.primaryOutboxMessage.count({ where: { aggregateId: { in: [event.id, created.id] } } })).toBe(before + 3);
  });

  it("serializes concurrent allocation and permits only one over-capacity contender", async () => {
    const { owner, organizer, event } = await seed();
    const before = await db.primaryAuditEvent.count({ where: { eventId: event.id } });
    const results = await Promise.allSettled([
      service.create({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "ga-race-a", fields: { ...typeFields(60), name: "GA A" } }),
      service.create({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "ga-race-b", fields: { ...typeFields(60), name: "GA B" } }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.primaryTicketType.aggregate({ where: { eventId: event.id, status: "ACTIVE" }, _sum: { allocatedQuantity: true } })).toMatchObject({ _sum: { allocatedQuantity: 60 } });
    expect(await db.primaryAuditEvent.count({ where: { eventId: event.id } })).toBe(before + 1);
    expect(await db.primaryOutboxMessage.count({ where: { organizerId: organizer.id } })).toBe(before + 1);
  });

  it("blocks capacity reduction below active allocations and ignores inactive allocations", async () => {
    const { owner, organizer, event } = await seed();
    await service.create({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "active-80", fields: typeFields(80) });
    await service.create({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "inactive-90", fields: { ...typeFields(90, "INACTIVE"), name: "Inactive" } });
    const before = await db.primaryAuditEvent.count({ where: { eventId: event.id } });
    await expect(eventService.editDraft({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "edit-too-small", fields: eventFields(79) }))
      .rejects.toMatchObject({ code: "CAPACITY_BELOW_ACTIVE_ALLOCATION" });
    await expect(service.updateCapacity({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "too-small", totalCapacity: 79 }))
      .rejects.toMatchObject({ code: "CAPACITY_BELOW_ACTIVE_ALLOCATION" });
    const updated = await service.updateCapacity({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "capacity-80", totalCapacity: 80 });
    expect(updated.totalCapacity).toBe(80);
    expect(await db.primaryAuditEvent.count({ where: { eventId: event.id } })).toBe(before + 1);
  });

  it("enforces submission readiness for active allocations", async () => {
    const { owner, organizer, event } = await seed();
    await expect(eventService.submit({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "submit-empty" }))
      .rejects.toMatchObject({ code: "EVENT_CAPACITY_NOT_READY" });
    const inactive = await service.create({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "submit-inactive", fields: typeFields(50, "INACTIVE") });
    await expect(eventService.submit({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "submit-inactive-only" }))
      .rejects.toMatchObject({ code: "EVENT_CAPACITY_NOT_READY" });
    await service.update({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, ticketTypeId: inactive.id, requestId: "submit-activate", fields: typeFields(50) });
    await expect(eventService.submit({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "submit-ready" }))
      .resolves.toMatchObject({ status: "SUBMITTED" });
    await expect(service.updateCapacity({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "post-submit-capacity", totalCapacity: 120 }))
      .rejects.toMatchObject({ code: "INVALID_EVENT_STATE" });
  });

  it("enforces tenant, role, assignment, suspension, and no-admin-bypass boundaries", async () => {
    const { owner, organizer, event } = await seed();
    const [manager, scanner, outsider, admin] = await Promise.all([
      db.user.create({ data: userData() }), db.user.create({ data: userData() }), db.user.create({ data: userData() }), db.user.create({ data: userData("ADMIN") }),
    ]);
    const managerMembership = await db.primaryOrganizerMembership.create({ data: { organizerId: organizer.id, userId: manager.id, role: "EVENT_MANAGER", status: "ACTIVE", invitedByUserId: owner.id, acceptedAt: new Date() } });
    await db.primaryOrganizerMembership.create({ data: { organizerId: organizer.id, userId: scanner.id, role: "SCANNER", status: "ACTIVE", invitedByUserId: owner.id, acceptedAt: new Date() } });
    const other = await db.primaryOrganizer.create({ data: { legalName: "Other", displayName: "Other", addressLine1: "1 Test", city: "Toronto", region: "ON", postalCode: "A1A1A1", country: "CA", supportEmail: `other-${sequence}@example.test`, status: "APPROVED", createdByUserId: outsider.id, memberships: { create: { userId: outsider.id, role: "OWNER", status: "ACTIVE", invitedByUserId: outsider.id, acceptedAt: new Date() } } } });
    const attempts = [manager, scanner, outsider, admin].map((user, index) => service.create({ actor: actor(user), organizerId: index === 2 ? other.id : organizer.id, eventId: event.id, requestId: `denied-${index}`, fields: typeFields(10) }));
    expect((await Promise.allSettled(attempts)).every((result) => result.status === "rejected")).toBe(true);
    await db.primaryEventStaffAssignment.create({ data: { organizerId: organizer.id, eventId: event.id, membershipId: managerMembership.id, assignedByUserId: owner.id } });
    await expect(service.create({ actor: actor(manager), organizerId: organizer.id, eventId: event.id, requestId: "assigned-manager", fields: typeFields(10) })).resolves.toBeTruthy();
    await db.primaryOrganizer.update({ where: { id: organizer.id }, data: { status: "SUSPENDED" } });
    await expect(service.create({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "suspended-owner", fields: typeFields(10) })).rejects.toMatchObject({ code: "ORGANIZER_SUSPENDED" });
  });

  it("rejects invalid money, currency, allocation, and order limits before mutation", async () => {
    const { owner, organizer, event } = await seed();
    const invalid = [
      { ...typeFields(), allocatedQuantity: 0 }, { ...typeFields(), basePriceMinor: 0 },
      { ...typeFields(), currency: "ZZZ" }, { ...typeFields(), minimumPerOrder: 9, maximumPerOrder: 8 },
      { ...typeFields(), minimumPerOrder: 0 },
    ];
    const results = await Promise.allSettled(invalid.map((fields, index) => service.create({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: `invalid-${index}`, fields })));
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(await db.primaryTicketType.count({ where: { eventId: event.id } })).toBe(0);
    expect(await db.primaryAuditEvent.count({ where: { eventId: event.id } })).toBe(1);
    expect(await db.primaryOutboxMessage.count({ where: { organizerId: organizer.id } })).toBe(1);
  });

  it("rolls back ticket-type changes and audit when outbox idempotency conflicts", async () => {
    const { owner, organizer, event } = await seed();
    const ticketType = await service.create({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "rollback-create", fields: typeFields(20) });
    await service.update({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, ticketTypeId: ticketType.id, requestId: "rollback-update", fields: { ...typeFields(30), name: "Committed" } });
    const before = await db.primaryAuditEvent.count({ where: { eventId: event.id } });
    await expect(service.update({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, ticketTypeId: ticketType.id, requestId: "rollback-update", fields: { ...typeFields(40), name: "Must roll back" } })).rejects.toBeTruthy();
    expect(await db.primaryTicketType.findUniqueOrThrow({ where: { id: ticketType.id } })).toMatchObject({ name: "Committed", allocatedQuantity: 30 });
    expect(await db.primaryAuditEvent.count({ where: { eventId: event.id } })).toBe(before);
    expect(await db.primaryOutboxMessage.count({ where: { organizerId: organizer.id } })).toBe(before);
  });
});
}
