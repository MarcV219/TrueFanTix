/** @jest-environment node */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { requirePrimaryPreflight } from "@/lib/primary/config";
import { PrimaryDomainError, PrimaryOrganizerService } from "@/lib/primary/organizer-service";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) {
  describe.skip("primary organizer service PostgreSQL integration", () => {
    it("requires an explicitly isolated integration database", () => undefined);
  });
} else {
describe("primary organizer service PostgreSQL integration", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const env = {
    NODE_ENV: "test",
    PRIMARY_TICKETING_ENABLED: "true",
    PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-test",
    PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-test",
    PRIMARY_TICKETING_DATABASE_URL: databaseUrl,
    DATABASE_URL: databaseUrl,
  } as NodeJS.ProcessEnv;
  const service = new PrimaryOrganizerService(
    db,
    requirePrimaryPreflight(env),
    "synthetic-integration-pepper-at-least-32-characters",
  );

  const userData = (suffix: string, role: "USER" | "ADMIN" = "USER") => ({
    email: `${suffix}@example.test`, passwordHash: "synthetic", emailVerifiedAt: new Date(),
    firstName: "Synthetic", lastName: suffix, phone: `+1555${suffix.padStart(7, "0")}`,
    phoneVerifiedAt: new Date(), streetAddress1: "1 Test Street", city: "Toronto", region: "ON",
    postalCode: "A1A1A1", country: "CA", role,
  });
  const actor = (user: { id: string; role: "USER" | "ADMIN" }) => ({ id: user.id, role: user.role });
  const createOrganizer = async (user: { id: string; role: "USER" | "ADMIN" }, key: string) => service.createDraft({
    actor: actor(user), requestId: `${key}-create`, legalName: key, displayName: key,
    addressLine1: "1 Test Street", city: "Toronto", region: "ON", postalCode: "A1A1A1", country: "CA",
    supportEmail: `${key}@example.test`,
  });
  const eventData = (organizerId: string) => ({
    organizerId, title: "Synthetic Event", description: "Synthetic only", category: "OTHER",
    venueName: "Synthetic Venue", venueAddressLine1: "1 Test Street", venueCity: "Toronto",
    venueRegion: "ON", venuePostalCode: "A1A1A1", venueCountry: "CA",
    startsAtLocal: new Date("2030-01-01T19:00:00Z"), endsAtLocal: new Date("2030-01-01T21:00:00Z"),
    timezone: "America/Toronto", contactEmail: "event@example.test", draftPolicyText: "Synthetic draft policy", totalCapacity: 100,
  });

  beforeAll(async () => {
    await db.primaryEventStaffAssignment.deleteMany();
    await db.primaryAuditEvent.deleteMany();
    await db.primaryOutboxMessage.deleteMany();
    await db.primaryOrganizerInvitation.deleteMany();
    await db.primaryOrganizerMembership.deleteMany();
    await db.primaryEvent.deleteMany();
    await db.primaryOrganizer.deleteMany();
    await db.user.deleteMany({ where: { email: { endsWith: "@example.test" } } });
  });

  afterAll(async () => {
    await db.$disconnect();
    await pool.end();
  });

  it("executes the authorized organizer lifecycle with protected audit/outbox records", async () => {
    const [owner, staff, other, admin] = await Promise.all([
      db.user.create({ data: userData("1000001") }),
      db.user.create({ data: userData("1000002") }),
      db.user.create({ data: userData("1000003") }),
      db.user.create({ data: userData("1000004", "ADMIN") }),
    ]);
    const ownerActor = { id: owner.id, role: owner.role };
    const organizer = await service.createDraft({
      actor: ownerActor, requestId: "create-1", legalName: "Synthetic Organizer Inc.", displayName: "Synthetic Organizer",
      addressLine1: "1 Test Street", city: "Toronto", region: "ON", postalCode: "A1A1A1", country: "CA",
      supportEmail: "SUPPORT@EXAMPLE.TEST",
    });
    await expect(db.primaryOrganizerMembership.findFirst({ where: { organizerId: organizer.id, userId: owner.id } }))
      .resolves.toMatchObject({ role: "OWNER", status: "ACTIVE" });

    await service.submit({ actor: ownerActor, organizerId: organizer.id, requestId: "submit-1" });
    await service.review({ actor: { id: admin.id, role: admin.role }, organizerId: organizer.id, requestId: "approve-1", toStatus: "APPROVED", reason: "Synthetic approval" });
    await service.review({ actor: { id: admin.id, role: admin.role }, organizerId: organizer.id, requestId: "suspend-1", toStatus: "SUSPENDED", reason: "Synthetic suspension" });
    await expect(service.invite({ actor: ownerActor, organizerId: organizer.id, requestId: "blocked-invite", email: staff.email, role: "EVENT_MANAGER", expiresAt: new Date(Date.now() + 3_600_000) }))
      .rejects.toMatchObject({ code: "ORGANIZER_SUSPENDED" });
    await service.review({ actor: { id: admin.id, role: admin.role }, organizerId: organizer.id, requestId: "restore-1", toStatus: "APPROVED", reason: "Synthetic restoration" });

    const { invitation, token } = await service.invite({ actor: ownerActor, organizerId: organizer.id, requestId: "invite-1", email: staff.email.toUpperCase(), role: "EVENT_MANAGER", expiresAt: new Date(Date.now() + 3_600_000) });
    expect(invitation.tokenHash).not.toContain(token);
    await expect(service.acceptInvitation({ actor: { id: other.id, role: other.role }, requestId: "accept-wrong", token }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    const membership = await service.acceptInvitation({ actor: { id: staff.id, role: staff.role }, requestId: "accept-1", token });
    expect(membership).toMatchObject({ role: "EVENT_MANAGER", status: "ACTIVE" });
    await expect(service.changeMembership({ actor: ownerActor, organizerId: organizer.id, membershipId: membership.id, requestId: "blank-role", role: "SCANNER", reason: "  " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await service.changeMembership({ actor: ownerActor, organizerId: organizer.id, membershipId: membership.id, requestId: "role-1", role: "SCANNER", reason: "Synthetic role change" });

    const pending = await service.invite({ actor: ownerActor, organizerId: organizer.id, requestId: "invite-2", email: other.email, role: "READ_ONLY", expiresAt: new Date(Date.now() + 3_600_000) });
    await service.revokeInvitation({ actor: ownerActor, organizerId: organizer.id, invitationId: pending.invitation.id, requestId: "revoke-invite-1", reason: "Synthetic revocation" });
    await expect(service.acceptInvitation({ actor: { id: other.id, role: other.role }, requestId: "accept-revoked", token: pending.token }))
      .rejects.toMatchObject({ code: "INVITATION_INVALID" });

    const event = await db.primaryEvent.create({ data: eventData(organizer.id) });
    const assignment = await service.assignEvent({ actor: ownerActor, organizerId: organizer.id, eventId: event.id, membershipId: membership.id, requestId: "assign-1" });
    await expect(service.revokeEventAssignment({ actor: ownerActor, organizerId: organizer.id, eventId: event.id, assignmentId: assignment.id, requestId: "blank-unassign", reason: "\t" })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await service.revokeEventAssignment({ actor: ownerActor, organizerId: organizer.id, eventId: event.id, assignmentId: assignment.id, requestId: "unassign-1", reason: "Synthetic rotation" });
    await service.changeMembership({ actor: ownerActor, organizerId: organizer.id, membershipId: membership.id, requestId: "revoke-member-1", revoke: true, reason: "Synthetic departure" });

    const ownerMembership = await db.primaryOrganizerMembership.findFirstOrThrow({ where: { organizerId: organizer.id, userId: owner.id } });
    await expect(service.changeMembership({ actor: ownerActor, organizerId: organizer.id, membershipId: ownerMembership.id, requestId: "revoke-owner-1", revoke: true, reason: "Test" }))
      .rejects.toEqual(expect.objectContaining<Partial<PrimaryDomainError>>({ code: "FINAL_ACTIVE_OWNER_REQUIRED" }));

    expect(await db.primaryAuditEvent.count({ where: { organizerId: organizer.id } })).toBe(13);
    expect(await db.primaryOutboxMessage.count({ where: { organizerId: organizer.id } })).toBe(13);
  });

  it("rejects cross-tenant membership assignment and unverified organizer creation", async () => {
    const unverified = await db.user.create({ data: { ...userData("2000001"), emailVerifiedAt: null } });
    await expect(service.createDraft({ actor: { id: unverified.id, role: unverified.role }, requestId: "unverified", legalName: "No", displayName: "No", addressLine1: "1", city: "T", region: "ON", postalCode: "A1A1A1", country: "CA", supportEmail: "no@example.test" }))
      .rejects.toMatchObject({ code: "VERIFIED_EMAIL_REQUIRED" });

    const [ownerA, ownerB] = await Promise.all([
      db.user.create({ data: userData("2000002") }), db.user.create({ data: userData("2000003") }),
    ]);
    const make = (actor: typeof ownerA, requestId: string) => service.createDraft({ actor: { id: actor.id, role: actor.role }, requestId, legalName: requestId, displayName: requestId, addressLine1: "1", city: "T", region: "ON", postalCode: "A1A1A1", country: "CA", supportEmail: `${requestId}@example.test` });
    const a = await make(ownerA, "tenant-a");
    const b = await make(ownerB, "tenant-b");
    const eventA = await db.primaryEvent.create({ data: eventData(a.id) });
    const memberB = await db.primaryOrganizerMembership.findFirstOrThrow({ where: { organizerId: b.id, userId: ownerB.id } });
    await expect(service.assignEvent({ actor: { id: ownerA.id, role: ownerA.role }, organizerId: a.id, eventId: eventA.id, membershipId: memberB.id, requestId: "cross-tenant" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("serializes conflicting organizer review transitions", async () => {
    const [owner, adminA, adminB] = await Promise.all([
      db.user.create({ data: userData("3000001") }),
      db.user.create({ data: userData("3000002", "ADMIN") }),
      db.user.create({ data: userData("3000003", "ADMIN") }),
    ]);
    const organizer = await createOrganizer(owner, "concurrent-review");
    await service.submit({ actor: actor(owner), organizerId: organizer.id, requestId: "concurrent-submit" });
    const beforeAudit = await db.primaryAuditEvent.count({ where: { organizerId: organizer.id } });
    const results = await Promise.allSettled([
      service.review({ actor: actor(adminA), organizerId: organizer.id, requestId: "concurrent-approve", toStatus: "APPROVED", reason: "Approve" }),
      service.review({ actor: actor(adminB), organizerId: organizer.id, requestId: "concurrent-reject", toStatus: "REJECTED", reason: "Reject" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(["APPROVED", "REJECTED"]).toContain((await db.primaryOrganizer.findUniqueOrThrow({ where: { id: organizer.id } })).status);
    expect(await db.primaryAuditEvent.count({ where: { organizerId: organizer.id } })).toBe(beforeAudit + 1);
    expect(await db.primaryOutboxMessage.count({ where: { organizerId: organizer.id } })).toBe(beforeAudit + 1);
  });

  it("rejects platform ADMIN bypass for every OWNER-only mutation family", async () => {
    const [owner, staff, pendingUser, admin] = await Promise.all([
      db.user.create({ data: userData("4000001") }), db.user.create({ data: userData("4000002") }),
      db.user.create({ data: userData("4000003") }), db.user.create({ data: userData("4000004", "ADMIN") }),
    ]);
    const organizer = await createOrganizer(owner, "admin-bypass");
    const accepted = await service.invite({ actor: actor(owner), organizerId: organizer.id, requestId: "admin-staff", email: staff.email, role: "SCANNER", expiresAt: new Date(Date.now() + 3_600_000) });
    const membership = await service.acceptInvitation({ actor: actor(staff), requestId: "admin-staff-accept", token: accepted.token });
    const pending = await service.invite({ actor: actor(owner), organizerId: organizer.id, requestId: "admin-pending", email: pendingUser.email, role: "READ_ONLY", expiresAt: new Date(Date.now() + 3_600_000) });
    const event = await db.primaryEvent.create({ data: eventData(organizer.id) });
    const assignment = await service.assignEvent({ actor: actor(owner), organizerId: organizer.id, eventId: event.id, membershipId: membership.id, requestId: "admin-assignment" });
    const before = await db.primaryAuditEvent.count({ where: { organizerId: organizer.id } });
    const adminActor = actor(admin);
    const attempts = [
      service.invite({ actor: adminActor, organizerId: organizer.id, requestId: "admin-denied-invite", email: "denied@example.test", role: "READ_ONLY", expiresAt: new Date(Date.now() + 3_600_000) }),
      service.revokeInvitation({ actor: adminActor, organizerId: organizer.id, invitationId: pending.invitation.id, requestId: "admin-denied-invite-revoke", reason: "Denied" }),
      service.changeMembership({ actor: adminActor, organizerId: organizer.id, membershipId: membership.id, requestId: "admin-denied-member", role: "READ_ONLY", reason: "Denied" }),
      service.assignEvent({ actor: adminActor, organizerId: organizer.id, eventId: event.id, membershipId: membership.id, requestId: "admin-denied-assign" }),
      service.revokeEventAssignment({ actor: adminActor, organizerId: organizer.id, eventId: event.id, assignmentId: assignment.id, requestId: "admin-denied-unassign", reason: "Denied" }),
    ];
    const results = await Promise.allSettled(attempts);
    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await db.primaryAuditEvent.count({ where: { organizerId: organizer.id } })).toBe(before);
    expect(await db.primaryOutboxMessage.count({ where: { organizerId: organizer.id } })).toBe(before);
  });

  it("blocks suspended acceptance and staff changes and requires reasons without residue", async () => {
    const [owner, staff, admin] = await Promise.all([
      db.user.create({ data: userData("5000001") }), db.user.create({ data: userData("5000002") }), db.user.create({ data: userData("5000003", "ADMIN") }),
    ]);
    const organizer = await createOrganizer(owner, "suspension-rules");
    await service.submit({ actor: actor(owner), organizerId: organizer.id, requestId: "suspension-submit" });
    await service.review({ actor: actor(admin), organizerId: organizer.id, requestId: "suspension-approve", toStatus: "APPROVED", reason: "Approved" });
    const pending = await service.invite({ actor: actor(owner), organizerId: organizer.id, requestId: "suspension-invite", email: staff.email, role: "SCANNER", expiresAt: new Date(Date.now() + 3_600_000) });
    await service.review({ actor: actor(admin), organizerId: organizer.id, requestId: "suspension-suspend", toStatus: "SUSPENDED", reason: "Suspended" });
    const before = await db.primaryAuditEvent.count({ where: { organizerId: organizer.id } });
    await expect(service.acceptInvitation({ actor: actor(staff), requestId: "suspension-accept", token: pending.token })).rejects.toMatchObject({ code: "ORGANIZER_SUSPENDED" });
    await expect(service.revokeInvitation({ actor: actor(owner), organizerId: organizer.id, invitationId: pending.invitation.id, requestId: "suspension-revoke", reason: "Blocked" })).rejects.toMatchObject({ code: "ORGANIZER_SUSPENDED" });
    expect(await db.primaryOrganizerMembership.count({ where: { organizerId: organizer.id, userId: staff.id } })).toBe(0);
    expect(await db.primaryAuditEvent.count({ where: { organizerId: organizer.id } })).toBe(before);
    expect(await db.primaryOutboxMessage.count({ where: { organizerId: organizer.id } })).toBe(before);

    await service.review({ actor: actor(admin), organizerId: organizer.id, requestId: "suspension-restore", toStatus: "APPROVED", reason: "Restored" });
    const restoredBefore = await db.primaryAuditEvent.count({ where: { organizerId: organizer.id } });
    await expect(service.review({ actor: actor(admin), organizerId: organizer.id, requestId: "blank-review", toStatus: "SUSPENDED", reason: "   " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(service.revokeInvitation({ actor: actor(owner), organizerId: organizer.id, invitationId: pending.invitation.id, requestId: "blank-revoke", reason: " " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    expect(await db.primaryAuditEvent.count({ where: { organizerId: organizer.id } })).toBe(restoredBefore);
    expect(await db.primaryOutboxMessage.count({ where: { organizerId: organizer.id } })).toBe(restoredBefore);
  });

  it("rejects banned and stale-role actors plus invitation duplicate, expiry, and replay", async () => {
    const [owner, staff, banned] = await Promise.all([
      db.user.create({ data: userData("6000001") }), db.user.create({ data: userData("6000002") }),
      db.user.create({ data: { ...userData("6000003"), isBanned: true } }),
    ]);
    await expect(createOrganizer(banned, "banned-create")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.createDraft({ actor: { id: owner.id, role: "ADMIN" }, requestId: "stale-role", legalName: "No", displayName: "No", addressLine1: "1", city: "T", region: "ON", postalCode: "A1A1A1", country: "CA", supportEmail: "stale@example.test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const organizer = await createOrganizer(owner, "invitation-guards");
    const first = await service.invite({ actor: actor(owner), organizerId: organizer.id, requestId: "guard-invite", email: staff.email, role: "READ_ONLY", expiresAt: new Date(Date.now() + 3_600_000) });
    await expect(service.invite({ actor: actor(owner), organizerId: organizer.id, requestId: "guard-duplicate", email: staff.email.toUpperCase(), role: "SCANNER", expiresAt: new Date(Date.now() + 3_600_000) })).rejects.toMatchObject({ code: "ACTIVE_INVITATION_EXISTS" });
    await db.primaryOrganizerInvitation.update({ where: { id: first.invitation.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await expect(service.acceptInvitation({ actor: actor(staff), requestId: "guard-expired", token: first.token })).rejects.toMatchObject({ code: "INVITATION_INVALID" });
    const second = await service.invite({ actor: actor(owner), organizerId: organizer.id, requestId: "guard-invite-2", email: staff.email, role: "READ_ONLY", expiresAt: new Date(Date.now() + 3_600_000) });
    await service.acceptInvitation({ actor: actor(staff), requestId: "guard-accept", token: second.token });
    await expect(service.acceptInvitation({ actor: actor(staff), requestId: "guard-replay", token: second.token })).rejects.toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("rolls back mutations when audit/outbox persistence fails", async () => {
    const [owner, staff] = await Promise.all([db.user.create({ data: userData("7000001") }), db.user.create({ data: userData("7000002") })]);
    const organizer = await createOrganizer(owner, "rollback");
    const invitation = await service.invite({ actor: actor(owner), organizerId: organizer.id, requestId: "rollback-invite", email: staff.email, role: "SCANNER", expiresAt: new Date(Date.now() + 3_600_000) });
    const membership = await service.acceptInvitation({ actor: actor(staff), requestId: "rollback-accept", token: invitation.token });
    await service.changeMembership({ actor: actor(owner), organizerId: organizer.id, membershipId: membership.id, requestId: "rollback-change", role: "READ_ONLY", reason: "First" });
    const before = await db.primaryAuditEvent.count({ where: { organizerId: organizer.id } });
    await expect(service.changeMembership({ actor: actor(owner), organizerId: organizer.id, membershipId: membership.id, requestId: "rollback-change", role: "FINANCE", reason: "Must roll back" })).rejects.toBeTruthy();
    expect(await db.primaryOrganizerMembership.findUniqueOrThrow({ where: { id: membership.id } })).toMatchObject({ role: "READ_ONLY" });
    expect(await db.primaryAuditEvent.count({ where: { organizerId: organizer.id } })).toBe(before);
    expect(await db.primaryOutboxMessage.count({ where: { organizerId: organizer.id } })).toBe(before);
  });

  it("serializes concurrent attempts to remove both active owners", async () => {
    const [ownerA, ownerB] = await Promise.all([db.user.create({ data: userData("8000001") }), db.user.create({ data: userData("8000002") })]);
    const organizer = await createOrganizer(ownerA, "owner-concurrency");
    const invitation = await service.invite({ actor: actor(ownerA), organizerId: organizer.id, requestId: "owner-concurrency-invite", email: ownerB.email, role: "OWNER", expiresAt: new Date(Date.now() + 3_600_000) });
    const membershipB = await service.acceptInvitation({ actor: actor(ownerB), requestId: "owner-concurrency-accept", token: invitation.token });
    const membershipA = await db.primaryOrganizerMembership.findFirstOrThrow({ where: { organizerId: organizer.id, userId: ownerA.id } });
    const results = await Promise.allSettled([
      service.changeMembership({ actor: actor(ownerA), organizerId: organizer.id, membershipId: membershipB.id, requestId: "owner-concurrency-a", revoke: true, reason: "Concurrent A" }),
      service.changeMembership({ actor: actor(ownerB), organizerId: organizer.id, membershipId: membershipA.id, requestId: "owner-concurrency-b", revoke: true, reason: "Concurrent B" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await db.primaryOrganizerMembership.count({ where: { organizerId: organizer.id, role: "OWNER", status: "ACTIVE" } })).toBe(1);
  });
});
}
