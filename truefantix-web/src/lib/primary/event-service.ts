import type { PrimaryEventStatus, Prisma, UserRole } from "@prisma/client";
import { recordPrimaryAuditAndOutbox } from "./audit-outbox";
import { authorizePrimaryEvent, authorizePrimaryOrganizer, PrimaryAccessError } from "./authorization";
import type { PrimaryPreflightCapability } from "./config";
import { PrimaryDomainError } from "./organizer-service";

type Tx = Prisma.TransactionClient;
type ServiceDb = {
  $transaction<T>(fn: (tx: Tx) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T>;
};
type Actor = { id: string; role: UserRole };

export type PrimaryEventDraftFields = {
  title: string;
  description: string;
  category: string;
  venueName: string;
  venueAddressLine1: string;
  venueAddressLine2?: string;
  venueCity: string;
  venueRegion: string;
  venuePostalCode: string;
  venueCountry: string;
  startsAtLocal: string;
  endsAtLocal: string;
  timezone: string;
  accessibilityInfo?: string;
  contactEmail: string;
  contactPhone?: string;
  draftPolicyText: string;
};

const REVIEW_TRANSITIONS: Record<PrimaryEventStatus, readonly PrimaryEventStatus[]> = {
  DRAFT: [], SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"], APPROVED: [], REJECTED: [],
};
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

function required(value: string, code: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new PrimaryDomainError(code);
  return trimmed;
}

function localTimestamp(value: string, code: string) {
  const trimmed = required(value, code);
  if (!LOCAL_DATE_TIME.test(trimmed)) throw new PrimaryDomainError(code);
  const parsed = new Date(`${trimmed.length === 16 ? `${trimmed}:00` : trimmed}Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== `${trimmed.length === 16 ? `${trimmed}:00` : trimmed}`) {
    throw new PrimaryDomainError(code);
  }
  return parsed;
}

function validTimezone(timezone: string) {
  const trimmed = required(timezone, "INVALID_TIMEZONE");
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: trimmed }).format();
    return trimmed;
  } catch {
    throw new PrimaryDomainError("INVALID_TIMEZONE");
  }
}

function validateFields(fields: PrimaryEventDraftFields) {
  const startsAtLocal = localTimestamp(fields.startsAtLocal, "INVALID_START_LOCAL");
  const endsAtLocal = localTimestamp(fields.endsAtLocal, "INVALID_END_LOCAL");
  if (endsAtLocal <= startsAtLocal) throw new PrimaryDomainError("INVALID_EVENT_DATE_RANGE");
  const contactEmail = required(fields.contactEmail, "CONTACT_EMAIL_REQUIRED").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new PrimaryDomainError("INVALID_CONTACT_EMAIL");
  return {
    title: required(fields.title, "TITLE_REQUIRED"),
    description: required(fields.description, "DESCRIPTION_REQUIRED"),
    category: required(fields.category, "CATEGORY_REQUIRED"),
    venueName: required(fields.venueName, "VENUE_NAME_REQUIRED"),
    venueAddressLine1: required(fields.venueAddressLine1, "VENUE_ADDRESS_REQUIRED"),
    venueAddressLine2: fields.venueAddressLine2?.trim() || null,
    venueCity: required(fields.venueCity, "VENUE_CITY_REQUIRED"),
    venueRegion: required(fields.venueRegion, "VENUE_REGION_REQUIRED"),
    venuePostalCode: required(fields.venuePostalCode, "VENUE_POSTAL_CODE_REQUIRED"),
    venueCountry: required(fields.venueCountry, "VENUE_COUNTRY_REQUIRED").toUpperCase(),
    startsAtLocal, endsAtLocal, timezone: validTimezone(fields.timezone),
    accessibilityInfo: fields.accessibilityInfo?.trim() || null,
    contactEmail, contactPhone: fields.contactPhone?.trim() || null,
    draftPolicyText: required(fields.draftPolicyText, "DRAFT_POLICY_REQUIRED"),
  };
}

async function requireCurrentActor(tx: Tx, actor: Actor) {
  const user = await tx.user.findUnique({ where: { id: actor.id }, select: { id: true, role: true, emailVerifiedAt: true, isBanned: true } });
  if (!user || user.isBanned) throw new PrimaryAccessError("NOT_FOUND", 404);
  if (!user.emailVerifiedAt) throw new PrimaryDomainError("VERIFIED_EMAIL_REQUIRED");
  if (user.role !== actor.role) throw new PrimaryAccessError("FORBIDDEN", 403);
}

async function lockOrganizer(tx: Tx, organizerId: string) {
  await tx.$queryRaw`SELECT id FROM "PrimaryOrganizer" WHERE id = ${organizerId} FOR UPDATE`;
}

async function lockEvent(tx: Tx, organizerId: string, eventId: string) {
  await tx.$queryRaw`SELECT id FROM "PrimaryEvent" WHERE id = ${eventId} AND "organizerId" = ${organizerId} FOR UPDATE`;
}

async function requireApprovedOrganizer(tx: Tx, organizerId: string) {
  const organizer = await tx.primaryOrganizer.findUnique({ where: { id: organizerId }, select: { status: true } });
  if (!organizer) throw new PrimaryAccessError("NOT_FOUND", 404);
  if (organizer.status === "SUSPENDED") throw new PrimaryDomainError("ORGANIZER_SUSPENDED");
  if (organizer.status !== "APPROVED") throw new PrimaryDomainError("ORGANIZER_NOT_APPROVED");
}

export class PrimaryEventService {
  constructor(private readonly db: ServiceDb, private readonly capability: PrimaryPreflightCapability) {}

  createDraft(input: { actor: Actor; organizerId: string; requestId: string; fields: PrimaryEventDraftFields }) {
    return this.db.$transaction(async (tx) => {
      const fields = validateFields(input.fields);
      await requireCurrentActor(tx, input.actor);
      await lockOrganizer(tx, input.organizerId);
      await authorizePrimaryOrganizer({ store: tx, actor: input.actor, organizerId: input.organizerId, allowedRoles: ["OWNER"], capability: this.capability, allowPlatformAdmin: false });
      await requireApprovedOrganizer(tx, input.organizerId);
      const event = await tx.primaryEvent.create({ data: { organizerId: input.organizerId, ...fields } });
      await this.audit(tx, input, "EVENT_DRAFT_CREATED", event.id, undefined, event, "primary.event.created");
      return event;
    }, { isolationLevel: "Serializable" });
  }

  editDraft(input: { actor: Actor; organizerId: string; eventId: string; requestId: string; fields: PrimaryEventDraftFields }) {
    return this.db.$transaction(async (tx) => {
      const fields = validateFields(input.fields);
      await requireCurrentActor(tx, input.actor);
      await lockOrganizer(tx, input.organizerId);
      await lockEvent(tx, input.organizerId, input.eventId);
      await authorizePrimaryEvent({ store: tx, actor: input.actor, organizerId: input.organizerId, eventId: input.eventId, allowedRoles: ["OWNER", "EVENT_MANAGER"], capability: this.capability, allowPlatformAdmin: false });
      await requireApprovedOrganizer(tx, input.organizerId);
      const event = await tx.primaryEvent.findFirst({ where: { id: input.eventId, organizerId: input.organizerId, status: { in: ["DRAFT", "REJECTED"] } } });
      if (!event) throw new PrimaryDomainError("INVALID_EVENT_STATE");
      const updated = await tx.primaryEvent.update({ where: { id: event.id }, data: { ...fields, status: "DRAFT", statusReason: null } });
      await this.audit(tx, input, "EVENT_DRAFT_UPDATED", event.id, event, updated, "primary.event.updated");
      return updated;
    }, { isolationLevel: "Serializable" });
  }

  submit(input: { actor: Actor; organizerId: string; eventId: string; requestId: string }) {
    return this.db.$transaction(async (tx) => {
      await requireCurrentActor(tx, input.actor);
      await lockOrganizer(tx, input.organizerId);
      await lockEvent(tx, input.organizerId, input.eventId);
      await authorizePrimaryEvent({ store: tx, actor: input.actor, organizerId: input.organizerId, eventId: input.eventId, allowedRoles: ["OWNER"], capability: this.capability, allowPlatformAdmin: false });
      await requireApprovedOrganizer(tx, input.organizerId);
      const event = await tx.primaryEvent.findFirst({ where: { id: input.eventId, organizerId: input.organizerId, status: { in: ["DRAFT", "REJECTED"] } } });
      if (!event) throw new PrimaryDomainError("INVALID_EVENT_STATE");
      const updated = await tx.primaryEvent.update({ where: { id: event.id }, data: { status: "SUBMITTED", statusReason: null, submittedAt: new Date() } });
      await this.audit(tx, input, "EVENT_SUBMITTED", event.id, event, updated, "primary.event.submitted");
      return updated;
    }, { isolationLevel: "Serializable" });
  }

  review(input: { actor: Actor; organizerId: string; eventId: string; requestId: string; toStatus: "UNDER_REVIEW" | "APPROVED" | "REJECTED"; reason: string }) {
    return this.db.$transaction(async (tx) => {
      const reason = required(input.reason, "REASON_REQUIRED");
      await requireCurrentActor(tx, input.actor);
      if (input.actor.role !== "ADMIN") throw new PrimaryAccessError("FORBIDDEN", 403);
      await lockOrganizer(tx, input.organizerId);
      await lockEvent(tx, input.organizerId, input.eventId);
      await requireApprovedOrganizer(tx, input.organizerId);
      const event = await tx.primaryEvent.findFirst({ where: { id: input.eventId, organizerId: input.organizerId } });
      if (!event) throw new PrimaryAccessError("NOT_FOUND", 404);
      if (!REVIEW_TRANSITIONS[event.status].includes(input.toStatus)) throw new PrimaryDomainError("INVALID_EVENT_STATE");
      const approved = input.toStatus === "APPROVED";
      const updated = await tx.primaryEvent.update({ where: { id: event.id }, data: {
        status: input.toStatus, statusReason: reason, approvedAt: approved ? new Date() : event.approvedAt,
        approvedByUserId: approved ? input.actor.id : event.approvedByUserId,
      } });
      await this.audit(tx, input, `EVENT_${input.toStatus}`, event.id, event, updated, `primary.event.${input.toStatus.toLowerCase()}`, reason);
      return updated;
    }, { isolationLevel: "Serializable" });
  }

  private audit(tx: Tx, input: { actor: Actor; organizerId: string; eventId?: string; requestId: string }, action: string, eventId: string, before: Record<string, unknown> | object | undefined, after: Record<string, unknown> | object, topic: string, reason?: string) {
    return recordPrimaryAuditAndOutbox(this.capability, tx, {
      organizerId: input.organizerId, eventId, actorUserId: input.actor.id, actorType: "USER", action,
      targetType: "PrimaryEvent", targetId: eventId, before: before as Record<string, unknown> | undefined,
      after: after as Record<string, unknown>, reason, requestId: input.requestId, topic,
      payload: { organizerId: input.organizerId, eventId }, idempotencyKey: `${input.requestId}:${action.toLowerCase()}`,
    });
  }
}
