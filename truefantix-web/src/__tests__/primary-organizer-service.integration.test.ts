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
    await service.changeMembership({ actor: ownerActor, organizerId: organizer.id, membershipId: membership.id, requestId: "role-1", role: "SCANNER", reason: "Synthetic role change" });

    const pending = await service.invite({ actor: ownerActor, organizerId: organizer.id, requestId: "invite-2", email: other.email, role: "READ_ONLY", expiresAt: new Date(Date.now() + 3_600_000) });
    await service.revokeInvitation({ actor: ownerActor, organizerId: organizer.id, invitationId: pending.invitation.id, requestId: "revoke-invite-1", reason: "Synthetic revocation" });
    await expect(service.acceptInvitation({ actor: { id: other.id, role: other.role }, requestId: "accept-revoked", token: pending.token }))
      .rejects.toMatchObject({ code: "INVITATION_INVALID" });

    const event = await db.primaryEvent.create({ data: { organizerId: organizer.id } });
    const assignment = await service.assignEvent({ actor: ownerActor, organizerId: organizer.id, eventId: event.id, membershipId: membership.id, requestId: "assign-1" });
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
    const [a, b] = await Promise.all([make(ownerA, "tenant-a"), make(ownerB, "tenant-b")]);
    const eventA = await db.primaryEvent.create({ data: { organizerId: a.id } });
    const memberB = await db.primaryOrganizerMembership.findFirstOrThrow({ where: { organizerId: b.id, userId: ownerB.id } });
    await expect(service.assignEvent({ actor: { id: ownerA.id, role: ownerA.role }, organizerId: a.id, eventId: eventA.id, membershipId: memberB.id, requestId: "cross-tenant" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
}
