/** @jest-environment node */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { requirePrimaryPreflight } from "@/lib/primary/config";
import { PrimaryEventService, type PrimaryEventDraftFields } from "@/lib/primary/event-service";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) {
  describe.skip("primary event service PostgreSQL integration", () => {
    it("requires an explicitly isolated integration database", () => undefined);
  });
} else {
describe("primary event service PostgreSQL integration", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const service = new PrimaryEventService(db, requirePrimaryPreflight({
    NODE_ENV: "test", PRIMARY_TICKETING_ENABLED: "true",
    PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-test", PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-test",
    PRIMARY_TICKETING_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl,
  } as NodeJS.ProcessEnv));

  const userData = (suffix: string, role: "USER" | "ADMIN" = "USER") => ({
    email: `event-${suffix}@example.test`, passwordHash: "synthetic", emailVerifiedAt: new Date(),
    firstName: "Synthetic", lastName: suffix, phone: `+1666${suffix.padStart(7, "0")}`,
    phoneVerifiedAt: new Date(), streetAddress1: "1 Test Street", city: "Toronto", region: "ON",
    postalCode: "A1A1A1", country: "CA", role,
  });
  const actor = (user: { id: string; role: "USER" | "ADMIN" }) => ({ id: user.id, role: user.role });
  const fields = (title = "Synthetic Concert"): PrimaryEventDraftFields => ({
    title, description: "A synthetic event used only for integration testing.", category: "CONCERT",
    venueName: "Synthetic Hall", venueAddressLine1: "10 Test Avenue", venueCity: "Toronto",
    venueRegion: "ON", venuePostalCode: "M5V2T6", venueCountry: "CA",
    startsAtLocal: "2031-04-15T19:30", endsAtLocal: "2031-04-15T22:00",
    timezone: "America/Toronto", accessibilityInfo: "Synthetic accessible entrance",
    contactEmail: "EVENTS@EXAMPLE.TEST", contactPhone: "+14165550100",
    draftPolicyText: "Synthetic draft policy; not offered to the public.",
    totalCapacity: 100,
  });
  const seedOrganizer = async (owner: { id: string }, key: string, status: "APPROVED" | "DRAFT" | "SUSPENDED" = "APPROVED") => db.primaryOrganizer.create({
    data: {
      legalName: key, displayName: key, addressLine1: "1 Test Street", city: "Toronto", region: "ON",
      postalCode: "A1A1A1", country: "CA", supportEmail: `${key}@example.test`, status,
      createdByUserId: owner.id, memberships: { create: { userId: owner.id, role: "OWNER", status: "ACTIVE", invitedByUserId: owner.id, acceptedAt: new Date() } },
    },
  });
  const seedTicketType = (organizerId: string, eventId: string) => db.primaryTicketType.create({ data: {
    organizerId, eventId, name: "General Admission", allocatedQuantity: 100,
    status: "ACTIVE", currency: "CAD", basePriceMinor: 2500,
  } });

  beforeAll(async () => {
    await db.primaryOrderPriceComponent.deleteMany();
    await db.primaryOrderLine.deleteMany();
    await db.primaryOrder.deleteMany();
    await db.primaryInventoryReservation.deleteMany();
    await db.primaryEventStaffAssignment.deleteMany();
    await db.primaryAuditEvent.deleteMany();
    await db.primaryOutboxMessage.deleteMany();
    await db.primaryOrganizerInvitation.deleteMany();
    await db.primaryOrganizerMembership.deleteMany();
    await db.primaryEvent.deleteMany();
    await db.primaryOrganizer.deleteMany();
    await db.user.deleteMany({ where: { email: { startsWith: "event-", endsWith: "@example.test" } } });
  });

  afterAll(async () => {
    await db.$disconnect();
    await pool.end();
  });

  it("supports the authorized draft, assigned-manager edit, submission, and review lifecycle", async () => {
    const [owner, manager, admin] = await Promise.all([
      db.user.create({ data: userData("1000001") }), db.user.create({ data: userData("1000002") }),
      db.user.create({ data: userData("1000003", "ADMIN") }),
    ]);
    const organizer = await seedOrganizer(owner, "event-lifecycle");
    const event = await service.createDraft({ actor: actor(owner), organizerId: organizer.id, requestId: "event-create-1", fields: fields() });
    expect(event).toMatchObject({ status: "DRAFT", timezone: "America/Toronto", contactEmail: "events@example.test" });
    const membership = await db.primaryOrganizerMembership.create({ data: { organizerId: organizer.id, userId: manager.id, role: "EVENT_MANAGER", status: "ACTIVE", invitedByUserId: owner.id, acceptedAt: new Date() } });
    await db.primaryEventStaffAssignment.create({ data: { organizerId: organizer.id, eventId: event.id, membershipId: membership.id, assignedByUserId: owner.id } });
    await service.editDraft({ actor: actor(manager), organizerId: organizer.id, eventId: event.id, requestId: "event-edit-1", fields: fields("Edited Synthetic Concert") });
    await seedTicketType(organizer.id, event.id);
    await service.submit({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "event-submit-1" });
    await service.review({ actor: actor(admin), organizerId: organizer.id, eventId: event.id, requestId: "event-review-1", toStatus: "UNDER_REVIEW", reason: "Review started" });
    const approved = await service.review({ actor: actor(admin), organizerId: organizer.id, eventId: event.id, requestId: "event-approve-1", toStatus: "APPROVED", reason: "Synthetic approval" });
    expect(approved).toMatchObject({ status: "APPROVED", title: "Edited Synthetic Concert", approvedByUserId: admin.id });
    expect(await db.primaryAuditEvent.count({ where: { organizerId: organizer.id, eventId: event.id } })).toBe(5);
    expect(await db.primaryOutboxMessage.count({ where: { organizerId: organizer.id, aggregateId: event.id } })).toBe(5);
  });

  it("enforces assignment, role, tenant, and platform-admin boundaries", async () => {
    const [owner, unassignedManager, scanner, otherOwner, admin] = await Promise.all([
      db.user.create({ data: userData("2000001") }), db.user.create({ data: userData("2000002") }),
      db.user.create({ data: userData("2000003") }), db.user.create({ data: userData("2000004") }),
      db.user.create({ data: userData("2000005", "ADMIN") }),
    ]);
    const [organizer, otherOrganizer] = await Promise.all([seedOrganizer(owner, "event-auth-a"), seedOrganizer(otherOwner, "event-auth-b")]);
    const event = await service.createDraft({ actor: actor(owner), organizerId: organizer.id, requestId: "event-auth-create", fields: fields() });
    await db.primaryOrganizerMembership.createMany({ data: [
      { organizerId: organizer.id, userId: unassignedManager.id, role: "EVENT_MANAGER", status: "ACTIVE", invitedByUserId: owner.id, acceptedAt: new Date() },
      { organizerId: organizer.id, userId: scanner.id, role: "SCANNER", status: "ACTIVE", invitedByUserId: owner.id, acceptedAt: new Date() },
    ] });
    const attempts = [
      service.editDraft({ actor: actor(unassignedManager), organizerId: organizer.id, eventId: event.id, requestId: "unassigned-edit", fields: fields("No") }),
      service.editDraft({ actor: actor(scanner), organizerId: organizer.id, eventId: event.id, requestId: "scanner-edit", fields: fields("No") }),
      service.editDraft({ actor: actor(otherOwner), organizerId: otherOrganizer.id, eventId: event.id, requestId: "cross-edit", fields: fields("No") }),
      service.createDraft({ actor: actor(admin), organizerId: organizer.id, requestId: "admin-create", fields: fields("No") }),
      service.submit({ actor: actor(admin), organizerId: organizer.id, eventId: event.id, requestId: "admin-submit" }),
    ];
    const results = await Promise.allSettled(attempts);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(await db.primaryEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: "DRAFT", title: "Synthetic Concert" });
    expect(await db.primaryAuditEvent.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("blocks unapproved and suspended organizers", async () => {
    const [owner, admin] = await Promise.all([
      db.user.create({ data: userData("3000001") }), db.user.create({ data: userData("3000002", "ADMIN") }),
    ]);
    const [draftOrganizer, suspendedOrganizer] = await Promise.all([
      seedOrganizer(owner, "event-draft-organizer", "DRAFT"), seedOrganizer(owner, "event-suspended-organizer", "SUSPENDED"),
    ]);
    await expect(service.createDraft({ actor: actor(owner), organizerId: draftOrganizer.id, requestId: "draft-org-event", fields: fields() })).rejects.toMatchObject({ code: "ORGANIZER_NOT_APPROVED" });
    await expect(service.createDraft({ actor: actor(owner), organizerId: suspendedOrganizer.id, requestId: "suspended-org-event", fields: fields() })).rejects.toMatchObject({ code: "ORGANIZER_SUSPENDED" });
    expect(await db.primaryEvent.count({ where: { organizerId: { in: [draftOrganizer.id, suspendedOrganizer.id] } } })).toBe(0);

    const approvedOrganizer = await seedOrganizer(owner, "event-later-suspended");
    const draftEvent = await service.createDraft({ actor: actor(owner), organizerId: approvedOrganizer.id, requestId: "pre-suspend-draft", fields: fields("Draft") });
    const submittedEvent = await service.createDraft({ actor: actor(owner), organizerId: approvedOrganizer.id, requestId: "pre-suspend-submitted", fields: fields("Submitted") });
    await seedTicketType(approvedOrganizer.id, submittedEvent.id);
    await service.submit({ actor: actor(owner), organizerId: approvedOrganizer.id, eventId: submittedEvent.id, requestId: "pre-suspend-submit" });
    await db.primaryOrganizer.update({ where: { id: approvedOrganizer.id }, data: { status: "SUSPENDED" } });
    const before = await db.primaryAuditEvent.count({ where: { organizerId: approvedOrganizer.id } });
    await expect(service.editDraft({ actor: actor(owner), organizerId: approvedOrganizer.id, eventId: draftEvent.id, requestId: "suspended-edit", fields: fields("Blocked") })).rejects.toMatchObject({ code: "ORGANIZER_SUSPENDED" });
    await expect(service.submit({ actor: actor(owner), organizerId: approvedOrganizer.id, eventId: draftEvent.id, requestId: "suspended-submit" })).rejects.toMatchObject({ code: "ORGANIZER_SUSPENDED" });
    await expect(service.review({ actor: actor(admin), organizerId: approvedOrganizer.id, eventId: submittedEvent.id, requestId: "suspended-review", toStatus: "APPROVED", reason: "Blocked" })).rejects.toMatchObject({ code: "ORGANIZER_SUSPENDED" });
    expect(await db.primaryAuditEvent.count({ where: { organizerId: approvedOrganizer.id } })).toBe(before);
    expect(await db.primaryOutboxMessage.count({ where: { organizerId: approvedOrganizer.id } })).toBe(before);
  });

  it("rejects invalid timezone and local date ranges before mutation", async () => {
    const owner = await db.user.create({ data: userData("4000001") });
    const organizer = await seedOrganizer(owner, "event-validation");
    await expect(service.createDraft({ actor: actor(owner), organizerId: organizer.id, requestId: "bad-zone", fields: { ...fields(), timezone: "Mars/Olympus" } })).rejects.toMatchObject({ code: "INVALID_TIMEZONE" });
    await expect(service.createDraft({ actor: actor(owner), organizerId: organizer.id, requestId: "bad-range", fields: { ...fields(), endsAtLocal: "2031-04-15T18:00" } })).rejects.toMatchObject({ code: "INVALID_EVENT_DATE_RANGE" });
    await expect(service.createDraft({ actor: actor(owner), organizerId: organizer.id, requestId: "bad-date", fields: { ...fields(), startsAtLocal: "2031-02-30T19:00" } })).rejects.toMatchObject({ code: "INVALID_START_LOCAL" });
    expect(await db.primaryEvent.count({ where: { organizerId: organizer.id } })).toBe(0);
    expect(await db.primaryAuditEvent.count({ where: { organizerId: organizer.id } })).toBe(0);
    expect(await db.primaryOutboxMessage.count({ where: { organizerId: organizer.id } })).toBe(0);
  });

  it("serializes conflicting event review decisions", async () => {
    const [owner, adminA, adminB] = await Promise.all([
      db.user.create({ data: userData("5000001") }), db.user.create({ data: userData("5000002", "ADMIN") }), db.user.create({ data: userData("5000003", "ADMIN") }),
    ]);
    const organizer = await seedOrganizer(owner, "event-concurrency");
    const event = await service.createDraft({ actor: actor(owner), organizerId: organizer.id, requestId: "concurrent-event-create", fields: fields() });
    await seedTicketType(organizer.id, event.id);
    await service.submit({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "concurrent-event-submit" });
    const before = await db.primaryAuditEvent.count({ where: { eventId: event.id } });
    const results = await Promise.allSettled([
      service.review({ actor: actor(adminA), organizerId: organizer.id, eventId: event.id, requestId: "event-concurrent-approve", toStatus: "APPROVED", reason: "Approve" }),
      service.review({ actor: actor(adminB), organizerId: organizer.id, eventId: event.id, requestId: "event-concurrent-reject", toStatus: "REJECTED", reason: "Reject" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await db.primaryAuditEvent.count({ where: { eventId: event.id } })).toBe(before + 1);
    expect(await db.primaryOutboxMessage.count({ where: { aggregateId: event.id } })).toBe(before + 1);
  });

  it("rolls back event edits when protected audit/outbox persistence fails", async () => {
    const owner = await db.user.create({ data: userData("6000001") });
    const organizer = await seedOrganizer(owner, "event-rollback");
    const event = await service.createDraft({ actor: actor(owner), organizerId: organizer.id, requestId: "rollback-event-create", fields: fields() });
    await service.editDraft({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "rollback-event-edit", fields: fields("Committed title") });
    const before = await db.primaryAuditEvent.count({ where: { eventId: event.id } });
    await expect(service.editDraft({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "rollback-event-edit", fields: fields("Must roll back") })).rejects.toBeTruthy();
    expect(await db.primaryEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ title: "Committed title" });
    expect(await db.primaryAuditEvent.count({ where: { eventId: event.id } })).toBe(before);
    expect(await db.primaryOutboxMessage.count({ where: { aggregateId: event.id } })).toBe(before);
  });

  it("refuses migrated placeholder events at submission with no audit or outbox residue", async () => {
    const owner = await db.user.create({ data: userData("7000001") });
    const organizer = await seedOrganizer(owner, "event-placeholder");
    const placeholderTime = new Date("1970-01-01T00:00:00.000Z");
    const event = await db.primaryEvent.create({ data: {
      organizerId: organizer.id, title: "Untitled draft", description: "", category: "UNSET",
      venueName: "", venueAddressLine1: "", venueCity: "", venueRegion: "",
      venuePostalCode: "", venueCountry: "", startsAtLocal: placeholderTime,
      endsAtLocal: placeholderTime, timezone: "UTC", contactEmail: "",
      draftPolicyText: "",
      totalCapacity: 1,
    } });
    const [auditBefore, outboxBefore] = await Promise.all([
      db.primaryAuditEvent.count({ where: { eventId: event.id } }),
      db.primaryOutboxMessage.count({ where: { aggregateId: event.id } }),
    ]);

    await expect(service.submit({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "placeholder-submit" }))
      .rejects.toMatchObject({ code: "INVALID_EVENT_DATE_RANGE" });
    expect(await db.primaryEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ status: "DRAFT", submittedAt: null });
    expect(await db.primaryAuditEvent.count({ where: { eventId: event.id } })).toBe(auditBefore);
    expect(await db.primaryOutboxMessage.count({ where: { aggregateId: event.id } })).toBe(outboxBefore);
  });

  it("requires a rejected event to be edited back to draft before resubmission", async () => {
    const [owner, admin] = await Promise.all([
      db.user.create({ data: userData("8000001") }), db.user.create({ data: userData("8000002", "ADMIN") }),
    ]);
    const organizer = await seedOrganizer(owner, "event-resubmission");
    const event = await service.createDraft({ actor: actor(owner), organizerId: organizer.id, requestId: "resubmit-create", fields: fields() });
    await seedTicketType(organizer.id, event.id);
    await service.submit({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "resubmit-first" });
    await service.review({ actor: actor(admin), organizerId: organizer.id, eventId: event.id, requestId: "resubmit-reject", toStatus: "REJECTED", reason: "Revise venue details" });
    const before = await db.primaryAuditEvent.count({ where: { eventId: event.id } });

    await expect(service.submit({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "resubmit-direct" }))
      .rejects.toMatchObject({ code: "INVALID_EVENT_STATE" });
    expect(await db.primaryAuditEvent.count({ where: { eventId: event.id } })).toBe(before);
    await service.editDraft({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "resubmit-edit", fields: fields("Revised Synthetic Concert") });
    const submitted = await service.submit({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, requestId: "resubmit-after-edit" });
    expect(submitted).toMatchObject({ status: "SUBMITTED", title: "Revised Synthetic Concert", statusReason: null });
  });

  it("rejects unverified, banned, and stale-role actors without event, audit, or outbox writes", async () => {
    const [unverified, banned, staleRole] = await Promise.all([
      db.user.create({ data: { ...userData("9000001"), emailVerifiedAt: null } }),
      db.user.create({ data: { ...userData("9000002"), isBanned: true } }),
      db.user.create({ data: userData("9000003") }),
    ]);
    const organizers = await Promise.all([
      seedOrganizer(unverified, "event-unverified"), seedOrganizer(banned, "event-banned"), seedOrganizer(staleRole, "event-stale-role"),
    ]);
    const before = await Promise.all(organizers.map(async (organizer) => ({
      events: await db.primaryEvent.count({ where: { organizerId: organizer.id } }),
      audits: await db.primaryAuditEvent.count({ where: { organizerId: organizer.id } }),
      outbox: await db.primaryOutboxMessage.count({ where: { organizerId: organizer.id } }),
    })));

    const results = await Promise.allSettled([
      service.createDraft({ actor: actor(unverified), organizerId: organizers[0].id, requestId: "actor-unverified", fields: fields() }),
      service.createDraft({ actor: actor(banned), organizerId: organizers[1].id, requestId: "actor-banned", fields: fields() }),
      service.createDraft({ actor: { id: staleRole.id, role: "ADMIN" }, organizerId: organizers[2].id, requestId: "actor-stale-role", fields: fields() }),
    ]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    await Promise.all(organizers.map(async (organizer, index) => {
      expect(await db.primaryEvent.count({ where: { organizerId: organizer.id } })).toBe(before[index].events);
      expect(await db.primaryAuditEvent.count({ where: { organizerId: organizer.id } })).toBe(before[index].audits);
      expect(await db.primaryOutboxMessage.count({ where: { organizerId: organizer.id } })).toBe(before[index].outbox);
    }));
  });
});
}
