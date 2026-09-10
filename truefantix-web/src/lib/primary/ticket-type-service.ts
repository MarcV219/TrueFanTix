import type { Prisma, PrimaryTicketTypeStatus, UserRole } from "@prisma/client";
import { recordPrimaryAuditAndOutbox } from "./audit-outbox";
import { authorizePrimaryEvent, PrimaryAccessError } from "./authorization";
import type { PrimaryPreflightCapability } from "./config";
import { PrimaryDomainError } from "./organizer-service";

type Tx = Prisma.TransactionClient;
type ServiceDb = {
  $transaction<T>(fn: (tx: Tx) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T>;
};
type Actor = { id: string; role: UserRole };

export type PrimaryTicketTypeFields = {
  name: string;
  description?: string;
  allocatedQuantity: number;
  status: PrimaryTicketTypeStatus;
  minimumPerOrder?: number;
  maximumPerOrder?: number;
  currency: string;
  basePriceMinor: number;
};

const supportedCurrencies = new Set(
  (Intl as typeof Intl & { supportedValuesOf?: (key: "currency") => string[] }).supportedValuesOf?.("currency") ?? ["CAD", "USD"],
);

function positiveInteger(value: number, code: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new PrimaryDomainError(code);
  return value;
}

function optionalPositiveInteger(value: number | undefined, code: string) {
  if (value === undefined) return null;
  return positiveInteger(value, code);
}

function validateFields(fields: PrimaryTicketTypeFields) {
  const name = fields.name.trim();
  if (!name) throw new PrimaryDomainError("TICKET_TYPE_NAME_REQUIRED");
  const allocatedQuantity = positiveInteger(fields.allocatedQuantity, "INVALID_ALLOCATED_QUANTITY");
  const basePriceMinor = positiveInteger(fields.basePriceMinor, "INVALID_BASE_PRICE");
  const minimumPerOrder = optionalPositiveInteger(fields.minimumPerOrder, "INVALID_MINIMUM_PER_ORDER");
  const maximumPerOrder = optionalPositiveInteger(fields.maximumPerOrder, "INVALID_MAXIMUM_PER_ORDER");
  if (minimumPerOrder !== null && maximumPerOrder !== null && minimumPerOrder > maximumPerOrder) {
    throw new PrimaryDomainError("INVALID_ORDER_LIMITS");
  }
  const currency = fields.currency.trim().toUpperCase();
  if (!supportedCurrencies.has(currency)) throw new PrimaryDomainError("INVALID_CURRENCY");
  return {
    name,
    description: fields.description?.trim() || null,
    allocatedQuantity,
    status: fields.status,
    minimumPerOrder,
    maximumPerOrder,
    currency,
    basePriceMinor,
  };
}

async function requireCurrentActor(tx: Tx, actor: Actor) {
  const user = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, emailVerifiedAt: true, isBanned: true } });
  if (!user || user.isBanned) throw new PrimaryAccessError("NOT_FOUND", 404);
  if (!user.emailVerifiedAt) throw new PrimaryDomainError("VERIFIED_EMAIL_REQUIRED");
  if (user.role !== actor.role) throw new PrimaryAccessError("FORBIDDEN", 403);
}

async function lockScope(tx: Tx, organizerId: string, eventId: string) {
  await tx.$queryRaw`SELECT id FROM "PrimaryOrganizer" WHERE id = ${organizerId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "PrimaryEvent" WHERE id = ${eventId} AND "organizerId" = ${organizerId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "PrimaryTicketType" WHERE "organizerId" = ${organizerId} AND "eventId" = ${eventId} ORDER BY id FOR UPDATE`;
}

async function requireDraftScope(tx: Tx, capability: PrimaryPreflightCapability, actor: Actor, organizerId: string, eventId: string) {
  await authorizePrimaryEvent({ store: tx, actor, organizerId, eventId, allowedRoles: ["OWNER", "EVENT_MANAGER"], capability, allowPlatformAdmin: false });
  const [organizer, event] = await Promise.all([
    tx.primaryOrganizer.findUnique({ where: { id: organizerId }, select: { status: true } }),
    tx.primaryEvent.findFirst({ where: { id: eventId, organizerId }, select: { id: true, status: true, totalCapacity: true } }),
  ]);
  if (!organizer || !event) throw new PrimaryAccessError("NOT_FOUND", 404);
  if (organizer.status === "SUSPENDED") throw new PrimaryDomainError("ORGANIZER_SUSPENDED");
  if (organizer.status !== "APPROVED") throw new PrimaryDomainError("ORGANIZER_NOT_APPROVED");
  if (event.status !== "DRAFT") throw new PrimaryDomainError("INVALID_EVENT_STATE");
  return event;
}

async function activeAllocation(tx: Tx, organizerId: string, eventId: string, excludeId?: string) {
  const rows = await tx.primaryTicketType.findMany({
    where: { organizerId, eventId, status: "ACTIVE", ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { allocatedQuantity: true, currency: true },
  });
  return { quantity: rows.reduce((sum, row) => sum + row.allocatedQuantity, 0), currencies: new Set(rows.map((row) => row.currency)) };
}

export class PrimaryTicketTypeService {
  constructor(private readonly db: ServiceDb, private readonly capability: PrimaryPreflightCapability) {}

  updateCapacity(input: { actor: Actor; organizerId: string; eventId: string; requestId: string; totalCapacity: number }) {
    return this.db.$transaction(async (tx) => {
      const totalCapacity = positiveInteger(input.totalCapacity, "INVALID_TOTAL_CAPACITY");
      await requireCurrentActor(tx, input.actor);
      await lockScope(tx, input.organizerId, input.eventId);
      const event = await requireDraftScope(tx, this.capability, input.actor, input.organizerId, input.eventId);
      const allocation = await activeAllocation(tx, input.organizerId, input.eventId);
      if (allocation.quantity > totalCapacity) throw new PrimaryDomainError("CAPACITY_BELOW_ACTIVE_ALLOCATION");
      const updated = await tx.primaryEvent.update({ where: { id: event.id }, data: { totalCapacity } });
      await this.audit(tx, input, "EVENT_CAPACITY_UPDATED", event.id, event, updated, "primary.event.capacity.updated");
      return updated;
    }, { isolationLevel: "Serializable" });
  }

  create(input: { actor: Actor; organizerId: string; eventId: string; requestId: string; fields: PrimaryTicketTypeFields }) {
    return this.db.$transaction(async (tx) => {
      const fields = validateFields(input.fields);
      await requireCurrentActor(tx, input.actor);
      await lockScope(tx, input.organizerId, input.eventId);
      const event = await requireDraftScope(tx, this.capability, input.actor, input.organizerId, input.eventId);
      const allocation = await activeAllocation(tx, input.organizerId, input.eventId);
      if (fields.status === "ACTIVE" && allocation.quantity + fields.allocatedQuantity > event.totalCapacity) throw new PrimaryDomainError("CAPACITY_EXCEEDED");
      if (fields.status === "ACTIVE" && allocation.currencies.size > 0 && !allocation.currencies.has(fields.currency)) throw new PrimaryDomainError("EVENT_CURRENCY_MISMATCH");
      const ticketType = await tx.primaryTicketType.create({ data: { organizerId: input.organizerId, eventId: event.id, ...fields } });
      await this.audit(tx, input, "TICKET_TYPE_CREATED", ticketType.id, undefined, ticketType, "primary.ticket-type.created");
      return ticketType;
    }, { isolationLevel: "Serializable" });
  }

  update(input: { actor: Actor; organizerId: string; eventId: string; ticketTypeId: string; requestId: string; fields: PrimaryTicketTypeFields }) {
    return this.db.$transaction(async (tx) => {
      const fields = validateFields(input.fields);
      await requireCurrentActor(tx, input.actor);
      await lockScope(tx, input.organizerId, input.eventId);
      const event = await requireDraftScope(tx, this.capability, input.actor, input.organizerId, input.eventId);
      const ticketType = await tx.primaryTicketType.findFirst({ where: { id: input.ticketTypeId, organizerId: input.organizerId, eventId: input.eventId } });
      if (!ticketType) throw new PrimaryAccessError("NOT_FOUND", 404);
      const allocation = await activeAllocation(tx, input.organizerId, input.eventId, ticketType.id);
      if (fields.status === "ACTIVE" && allocation.quantity + fields.allocatedQuantity > event.totalCapacity) throw new PrimaryDomainError("CAPACITY_EXCEEDED");
      if (fields.status === "ACTIVE" && allocation.currencies.size > 0 && !allocation.currencies.has(fields.currency)) throw new PrimaryDomainError("EVENT_CURRENCY_MISMATCH");
      const updated = await tx.primaryTicketType.update({ where: { id: ticketType.id }, data: fields });
      await this.audit(tx, input, "TICKET_TYPE_UPDATED", ticketType.id, ticketType, updated, "primary.ticket-type.updated");
      return updated;
    }, { isolationLevel: "Serializable" });
  }

  private audit(tx: Tx, input: { actor: Actor; organizerId: string; eventId: string; requestId: string }, action: string, targetId: string, before: object | undefined, after: object, topic: string) {
    return recordPrimaryAuditAndOutbox(this.capability, tx, {
      organizerId: input.organizerId, eventId: input.eventId, actorUserId: input.actor.id, actorType: "USER", action,
      targetType: action.startsWith("EVENT_") ? "PrimaryEvent" : "PrimaryTicketType", targetId,
      before: before as Record<string, unknown> | undefined, after: after as Record<string, unknown>, requestId: input.requestId,
      topic, payload: { organizerId: input.organizerId, eventId: input.eventId, ticketTypeId: targetId },
      idempotencyKey: `${input.requestId}:${action.toLowerCase()}`,
    });
  }
}
