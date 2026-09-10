import { createHash, randomBytes } from "node:crypto";
import type {
  PrimaryMembershipRole,
  PrimaryOrganizerStatus,
  Prisma,
  UserRole,
} from "@prisma/client";
import { recordPrimaryAuditAndOutbox } from "./audit-outbox";
import { authorizePrimaryEvent, authorizePrimaryOrganizer, PrimaryAccessError } from "./authorization";
import type { PrimaryPreflightCapability } from "./config";

type Tx = Prisma.TransactionClient;
type ServiceDb = {
  $transaction<T>(fn: (tx: Tx) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T>;
};

export type PrimaryServiceActor = { id: string; role: UserRole };

export class PrimaryDomainError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PrimaryDomainError";
  }
}

const STAFF_ROLES: readonly PrimaryMembershipRole[] = ["OWNER", "FINANCE", "EVENT_MANAGER", "BOX_OFFICE", "SCANNER", "READ_ONLY"];
const REVIEW_TRANSITIONS: Record<PrimaryOrganizerStatus, readonly PrimaryOrganizerStatus[]> = {
  DRAFT: [],
  SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["SUSPENDED"],
  REJECTED: ["DRAFT"],
  SUSPENDED: ["APPROVED"],
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function invitationHash(token: string, pepper: string) {
  return createHash("sha256").update(`${pepper}:${token}`).digest("hex");
}

async function requireVerifiedActor(tx: Tx, actor: PrimaryServiceActor) {
  const user = await tx.user.findUnique({
    where: { id: actor.id },
    select: { id: true, email: true, emailVerifiedAt: true, isBanned: true, role: true },
  });
  if (!user || user.isBanned) throw new PrimaryAccessError("NOT_FOUND", 404);
  if (!user.emailVerifiedAt) throw new PrimaryDomainError("VERIFIED_EMAIL_REQUIRED");
  if (user.role !== actor.role) throw new PrimaryAccessError("FORBIDDEN", 403);
  return { ...user, emailNormalized: normalizeEmail(user.email) };
}

async function lockOrganizer(tx: Tx, organizerId: string) {
  await tx.$queryRaw`SELECT id FROM "PrimaryOrganizer" WHERE id = ${organizerId} FOR UPDATE`;
}

function requireReason(reason: string) {
  const trimmed = reason.trim();
  if (!trimmed) throw new PrimaryDomainError("REASON_REQUIRED");
  return trimmed;
}

async function requireOperationalOrganizer(tx: Tx, organizerId: string) {
  const organizer = await tx.primaryOrganizer.findUnique({ where: { id: organizerId }, select: { status: true } });
  if (!organizer) throw new PrimaryAccessError("NOT_FOUND", 404);
  if (organizer.status === "SUSPENDED") throw new PrimaryDomainError("ORGANIZER_SUSPENDED");
  return organizer;
}

export class PrimaryOrganizerService {
  constructor(
    private readonly db: ServiceDb,
    private readonly capability: PrimaryPreflightCapability,
    private readonly invitationPepper: string,
  ) {
    if (invitationPepper.length < 32) throw new Error("Primary invitation pepper must be at least 32 characters.");
  }

  createDraft(input: {
    actor: PrimaryServiceActor;
    requestId: string;
    legalName: string;
    displayName: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
    supportEmail: string;
    supportPhone?: string;
    website?: string;
  }) {
    return this.db.$transaction(async (tx) => {
      await requireVerifiedActor(tx, input.actor);
      const organizer = await tx.primaryOrganizer.create({
        data: {
          legalName: input.legalName.trim(), displayName: input.displayName.trim(),
          addressLine1: input.addressLine1.trim(), addressLine2: input.addressLine2?.trim(),
          city: input.city.trim(), region: input.region.trim(), postalCode: input.postalCode.trim(),
          country: input.country.trim().toUpperCase(), supportEmail: normalizeEmail(input.supportEmail),
          supportPhone: input.supportPhone?.trim(), website: input.website?.trim(), createdByUserId: input.actor.id,
          memberships: { create: { userId: input.actor.id, invitedByUserId: input.actor.id, role: "OWNER", status: "ACTIVE", acceptedAt: new Date() } },
        },
      });
      await recordPrimaryAuditAndOutbox(this.capability, tx, {
        organizerId: organizer.id, actorUserId: input.actor.id, actorType: "USER", action: "ORGANIZER_DRAFT_CREATED",
        targetType: "PrimaryOrganizer", targetId: organizer.id, after: { status: organizer.status, displayName: organizer.displayName, supportEmail: organizer.supportEmail },
        requestId: input.requestId, topic: "primary.organizer.created", payload: { organizerId: organizer.id }, idempotencyKey: `${input.requestId}:organizer-created`,
      });
      return organizer;
    }, { isolationLevel: "Serializable" });
  }

  submit(input: { actor: PrimaryServiceActor; organizerId: string; requestId: string }) {
    return this.db.$transaction(async (tx) => {
      await requireVerifiedActor(tx, input.actor);
      await lockOrganizer(tx, input.organizerId);
      await authorizePrimaryOrganizer({ store: tx, actor: input.actor, organizerId: input.organizerId, allowedRoles: ["OWNER"], capability: this.capability, allowPlatformAdmin: false });
      const organizer = await tx.primaryOrganizer.findFirst({ where: { id: input.organizerId, status: "DRAFT" } });
      if (!organizer) throw new PrimaryDomainError("INVALID_ORGANIZER_STATE");
      const updated = await tx.primaryOrganizer.update({ where: { id: organizer.id }, data: { status: "SUBMITTED", statusReason: null, submittedAt: new Date() } });
      await this.audit(tx, input, "ORGANIZER_SUBMITTED", organizer.id, { status: organizer.status }, { status: updated.status }, "primary.organizer.submitted");
      return updated;
    }, { isolationLevel: "Serializable" });
  }

  review(input: { actor: PrimaryServiceActor; organizerId: string; requestId: string; toStatus: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "SUSPENDED" | "DRAFT"; reason: string }) {
    return this.db.$transaction(async (tx) => {
      const reason = requireReason(input.reason);
      await requireVerifiedActor(tx, input.actor);
      if (input.actor.role !== "ADMIN") throw new PrimaryAccessError("FORBIDDEN", 403);
      await lockOrganizer(tx, input.organizerId);
      const organizer = await tx.primaryOrganizer.findUnique({ where: { id: input.organizerId } });
      if (!organizer) throw new PrimaryAccessError("NOT_FOUND", 404);
      if (!REVIEW_TRANSITIONS[organizer.status].includes(input.toStatus)) throw new PrimaryDomainError("INVALID_ORGANIZER_STATE");
      const approved = input.toStatus === "APPROVED";
      const updated = await tx.primaryOrganizer.update({ where: { id: organizer.id }, data: {
        status: input.toStatus, statusReason: reason,
        approvedAt: approved ? new Date() : organizer.approvedAt,
        approvedByUserId: approved ? input.actor.id : organizer.approvedByUserId,
      } });
      await this.audit(tx, input, `ORGANIZER_${input.toStatus}`, organizer.id, { status: organizer.status }, { status: updated.status }, `primary.organizer.${input.toStatus.toLowerCase()}`, reason);
      return updated;
    }, { isolationLevel: "Serializable" });
  }

  invite(input: { actor: PrimaryServiceActor; organizerId: string; requestId: string; email: string; role: PrimaryMembershipRole; expiresAt: Date }) {
    return this.db.$transaction(async (tx) => {
      await requireVerifiedActor(tx, input.actor);
      await lockOrganizer(tx, input.organizerId);
      await authorizePrimaryOrganizer({ store: tx, actor: input.actor, organizerId: input.organizerId, allowedRoles: ["OWNER"], capability: this.capability, allowPlatformAdmin: false });
      await requireOperationalOrganizer(tx, input.organizerId);
      if (!STAFF_ROLES.includes(input.role)) throw new PrimaryDomainError("INVALID_ROLE");
      if (input.expiresAt.getTime() <= Date.now()) throw new PrimaryDomainError("INVALID_INVITATION_EXPIRY");
      const emailNormalized = normalizeEmail(input.email);
      const active = await tx.primaryOrganizerInvitation.findFirst({ where: { organizerId: input.organizerId, emailNormalized, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (active) throw new PrimaryDomainError("ACTIVE_INVITATION_EXISTS");
      const token = randomBytes(32).toString("base64url");
      const invitation = await tx.primaryOrganizerInvitation.create({ data: {
        organizerId: input.organizerId, emailNormalized, role: input.role, tokenHash: invitationHash(token, this.invitationPepper),
        expiresAt: input.expiresAt, invitedByUserId: input.actor.id,
      } });
      await this.audit(tx, input, "STAFF_INVITED", invitation.id, undefined, { role: invitation.role, organizerId: input.organizerId }, "primary.invitation.created");
      return { invitation, token };
    }, { isolationLevel: "Serializable" });
  }

  acceptInvitation(input: { actor: PrimaryServiceActor; requestId: string; token: string }) {
    return this.db.$transaction(async (tx) => {
      const user = await requireVerifiedActor(tx, input.actor);
      const invitation = await tx.primaryOrganizerInvitation.findUnique({ where: { tokenHash: invitationHash(input.token, this.invitationPepper) } });
      if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) throw new PrimaryDomainError("INVITATION_INVALID");
      if (invitation.emailNormalized !== user.emailNormalized) throw new PrimaryAccessError("NOT_FOUND", 404);
      await lockOrganizer(tx, invitation.organizerId);
      await requireOperationalOrganizer(tx, invitation.organizerId);
      const membership = await tx.primaryOrganizerMembership.upsert({
        where: { organizerId_userId: { organizerId: invitation.organizerId, userId: user.id } },
        create: { organizerId: invitation.organizerId, userId: user.id, role: invitation.role, status: "ACTIVE", invitedByUserId: invitation.invitedByUserId, acceptedAt: new Date() },
        update: { role: invitation.role, status: "ACTIVE", invitedByUserId: invitation.invitedByUserId, acceptedAt: new Date(), revokedAt: null },
      });
      await tx.primaryOrganizerInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
      await this.audit(tx, { ...input, organizerId: invitation.organizerId }, "STAFF_INVITATION_ACCEPTED", membership.id, undefined, { role: membership.role, status: membership.status }, "primary.invitation.accepted");
      return membership;
    }, { isolationLevel: "Serializable" });
  }

  revokeInvitation(input: { actor: PrimaryServiceActor; organizerId: string; invitationId: string; requestId: string; reason: string }) {
    return this.db.$transaction(async (tx) => {
      const reason = requireReason(input.reason);
      await requireVerifiedActor(tx, input.actor);
      await lockOrganizer(tx, input.organizerId);
      await authorizePrimaryOrganizer({ store: tx, actor: input.actor, organizerId: input.organizerId, allowedRoles: ["OWNER"], capability: this.capability, allowPlatformAdmin: false });
      await requireOperationalOrganizer(tx, input.organizerId);
      const invitation = await tx.primaryOrganizerInvitation.findFirst({ where: { id: input.invitationId, organizerId: input.organizerId, acceptedAt: null, revokedAt: null } });
      if (!invitation) throw new PrimaryAccessError("NOT_FOUND", 404);
      const updated = await tx.primaryOrganizerInvitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
      await this.audit(tx, input, "STAFF_INVITATION_REVOKED", invitation.id, undefined, { role: invitation.role }, "primary.invitation.revoked", reason);
      return updated;
    });
  }

  changeMembership(input: { actor: PrimaryServiceActor; organizerId: string; membershipId: string; requestId: string; role?: PrimaryMembershipRole; revoke?: boolean; reason: string }) {
    return this.db.$transaction(async (tx) => {
      const reason = requireReason(input.reason);
      await requireVerifiedActor(tx, input.actor);
      await lockOrganizer(tx, input.organizerId);
      await authorizePrimaryOrganizer({ store: tx, actor: input.actor, organizerId: input.organizerId, allowedRoles: ["OWNER"], capability: this.capability, allowPlatformAdmin: false });
      await requireOperationalOrganizer(tx, input.organizerId);
      const membership = await tx.primaryOrganizerMembership.findFirst({ where: { id: input.membershipId, organizerId: input.organizerId, status: "ACTIVE" } });
      if (!membership) throw new PrimaryAccessError("NOT_FOUND", 404);
      if (membership.role === "OWNER" && (input.revoke || (input.role && input.role !== "OWNER"))) {
        const owners = await tx.primaryOrganizerMembership.count({ where: { organizerId: input.organizerId, role: "OWNER", status: "ACTIVE" } });
        if (owners <= 1) throw new PrimaryDomainError("FINAL_ACTIVE_OWNER_REQUIRED");
      }
      if (!input.revoke && (!input.role || !STAFF_ROLES.includes(input.role))) throw new PrimaryDomainError("INVALID_ROLE");
      const updated = await tx.primaryOrganizerMembership.update({ where: { id: membership.id }, data: input.revoke
        ? { status: "REVOKED", revokedAt: new Date() }
        : { role: input.role, status: "ACTIVE", revokedAt: null } });
      await this.audit(tx, input, input.revoke ? "MEMBERSHIP_REVOKED" : "MEMBERSHIP_ROLE_CHANGED", membership.id, { role: membership.role, status: membership.status }, { role: updated.role, status: updated.status }, input.revoke ? "primary.membership.revoked" : "primary.membership.role-changed", reason);
      return updated;
    }, { isolationLevel: "Serializable" });
  }

  assignEvent(input: { actor: PrimaryServiceActor; organizerId: string; eventId: string; membershipId: string; requestId: string }) {
    return this.db.$transaction(async (tx) => {
      await requireVerifiedActor(tx, input.actor);
      await lockOrganizer(tx, input.organizerId);
      await authorizePrimaryEvent({ store: tx, actor: input.actor, organizerId: input.organizerId, eventId: input.eventId, allowedRoles: ["OWNER"], capability: this.capability, allowPlatformAdmin: false });
      await requireOperationalOrganizer(tx, input.organizerId);
      const membership = await tx.primaryOrganizerMembership.findFirst({ where: { id: input.membershipId, organizerId: input.organizerId, status: "ACTIVE" } });
      if (!membership) throw new PrimaryAccessError("NOT_FOUND", 404);
      const assignment = await tx.primaryEventStaffAssignment.upsert({
        where: { eventId_membershipId: { eventId: input.eventId, membershipId: input.membershipId } },
        create: { eventId: input.eventId, organizerId: input.organizerId, membershipId: input.membershipId, assignedByUserId: input.actor.id },
        update: { status: "ACTIVE", assignedByUserId: input.actor.id, assignedAt: new Date(), revokedAt: null, revokedByUserId: null, revocationReason: null },
      });
      await this.audit(tx, input, "EVENT_STAFF_ASSIGNED", assignment.id, undefined, { eventId: input.eventId, membershipId: input.membershipId, status: assignment.status }, "primary.event-staff.assigned");
      return assignment;
    });
  }

  revokeEventAssignment(input: { actor: PrimaryServiceActor; organizerId: string; eventId: string; assignmentId: string; requestId: string; reason: string }) {
    return this.db.$transaction(async (tx) => {
      const reason = requireReason(input.reason);
      await requireVerifiedActor(tx, input.actor);
      await lockOrganizer(tx, input.organizerId);
      await authorizePrimaryEvent({ store: tx, actor: input.actor, organizerId: input.organizerId, eventId: input.eventId, allowedRoles: ["OWNER"], capability: this.capability, allowPlatformAdmin: false });
      await requireOperationalOrganizer(tx, input.organizerId);
      const assignment = await tx.primaryEventStaffAssignment.findFirst({ where: { id: input.assignmentId, organizerId: input.organizerId, eventId: input.eventId, status: "ACTIVE" } });
      if (!assignment) throw new PrimaryAccessError("NOT_FOUND", 404);
      const updated = await tx.primaryEventStaffAssignment.update({ where: { id: assignment.id }, data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: input.actor.id, revocationReason: reason } });
      await this.audit(tx, input, "EVENT_STAFF_REVOKED", assignment.id, { status: assignment.status }, { status: updated.status }, "primary.event-staff.revoked", reason);
      return updated;
    });
  }

  private audit(tx: Tx, input: { actor: PrimaryServiceActor; organizerId: string; requestId: string }, action: string, targetId: string, before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined, topic: string, reason?: string) {
    return recordPrimaryAuditAndOutbox(this.capability, tx, {
      organizerId: input.organizerId, actorUserId: input.actor.id, actorType: "USER", action,
      targetType: action.startsWith("ORGANIZER_") ? "PrimaryOrganizer" : action.startsWith("EVENT_") ? "PrimaryEventStaffAssignment" : action.includes("INVITATION") || action === "STAFF_INVITED" ? "PrimaryOrganizerInvitation" : "PrimaryOrganizerMembership",
      targetId, before, after, reason, requestId: input.requestId, topic, payload: { organizerId: input.organizerId, targetId }, idempotencyKey: `${input.requestId}:${action.toLowerCase()}`,
    });
  }
}
