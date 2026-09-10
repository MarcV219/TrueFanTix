import type { Prisma, UserRole } from "@prisma/client";
import { recordPrimaryAuditAndOutbox } from "./audit-outbox";
import { PrimaryAccessError } from "./authorization";
import type { PrimaryPreflightCapability } from "./config";
import { PrimaryDomainError } from "./organizer-service";

type Tx = Prisma.TransactionClient;
type ServiceDb = {
  $transaction<T>(fn: (tx: Tx) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T>;
};
type Actor = { id: string; role: UserRole };

export type PrimaryReservationInternalCapability = { readonly kind: "PrimaryReservationInternalCapability" };
const internalCapabilities = new WeakSet<object>();

export function createPrimaryReservationInternalCapabilityForTests(): PrimaryReservationInternalCapability {
  if (process.env.NODE_ENV !== "test" || process.env.PRIMARY_TICKETING_ENVIRONMENT_ID !== "isolated-test") {
    throw new PrimaryDomainError("RESERVATION_INTERNAL_BOUNDARY_FORBIDDEN");
  }
  const capability = Object.freeze({ kind: "PrimaryReservationInternalCapability" as const });
  internalCapabilities.add(capability);
  return capability;
}

function assertInternalCapability(capability: PrimaryReservationInternalCapability) {
  if (!internalCapabilities.has(capability)) throw new PrimaryDomainError("RESERVATION_INTERNAL_BOUNDARY_FORBIDDEN");
}

function requiredKey(value: string) {
  const key = value.trim();
  if (!key) throw new PrimaryDomainError("IDEMPOTENCY_KEY_REQUIRED");
  return key;
}

function positiveQuantity(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new PrimaryDomainError("INVALID_RESERVATION_QUANTITY");
  return value;
}

async function requireBuyer(tx: Tx, actor: Actor) {
  const user = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, emailVerifiedAt: true, isBanned: true } });
  if (!user || user.isBanned) throw new PrimaryAccessError("NOT_FOUND", 404);
  if (!user.emailVerifiedAt) throw new PrimaryDomainError("VERIFIED_EMAIL_REQUIRED");
  if (user.role !== actor.role || actor.role === "ADMIN") throw new PrimaryAccessError("FORBIDDEN", 403);
}

async function lockScope(tx: Tx, organizerId: string, eventId: string) {
  await tx.$queryRaw`SELECT id FROM "PrimaryOrganizer" WHERE id = ${organizerId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "PrimaryEvent" WHERE id = ${eventId} AND "organizerId" = ${organizerId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "PrimaryTicketType" WHERE "organizerId" = ${organizerId} AND "eventId" = ${eventId} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "PrimaryInventoryReservation" WHERE "organizerId" = ${organizerId} AND "eventId" = ${eventId} ORDER BY id FOR UPDATE`;
}

async function requireReservableScope(tx: Tx, organizerId: string, eventId: string, ticketTypeId: string) {
  const [organizer, event, ticketType] = await Promise.all([
    tx.primaryOrganizer.findUnique({ where: { id: organizerId }, select: { status: true } }),
    tx.primaryEvent.findFirst({ where: { id: eventId, organizerId }, select: { status: true, totalCapacity: true } }),
    tx.primaryTicketType.findFirst({ where: { id: ticketTypeId, organizerId, eventId } }),
  ]);
  if (!organizer || !event || !ticketType) throw new PrimaryAccessError("NOT_FOUND", 404);
  if (organizer.status === "SUSPENDED") throw new PrimaryDomainError("ORGANIZER_SUSPENDED");
  if (organizer.status !== "APPROVED") throw new PrimaryDomainError("ORGANIZER_NOT_APPROVED");
  if (event.status !== "APPROVED") throw new PrimaryDomainError("EVENT_NOT_APPROVED");
  if (ticketType.status !== "ACTIVE") throw new PrimaryDomainError("TICKET_TYPE_INACTIVE");
  return { event, ticketType };
}

export class PrimaryReservationService {
  constructor(
    private readonly db: ServiceDb,
    private readonly capability: PrimaryPreflightCapability,
    private readonly clock: () => Date = () => new Date(),
    private readonly holdTtlMs = 10 * 60 * 1000,
    private readonly reconciliationDelayMs = 30 * 60 * 1000,
  ) {}

  createHold(input: { actor: Actor; organizerId: string; eventId: string; ticketTypeId: string; quantity: number; idempotencyKey: string }) {
    return this.db.$transaction(async (tx) => {
      const quantity = positiveQuantity(input.quantity);
      const idempotencyKey = requiredKey(input.idempotencyKey);
      const now = this.clock();
      await requireBuyer(tx, input.actor);
      await lockScope(tx, input.organizerId, input.eventId);
      const existing = await tx.primaryInventoryReservation.findUnique({ where: { createIdempotencyKey: idempotencyKey } });
      if (existing) {
        if (existing.buyerUserId !== input.actor.id || existing.organizerId !== input.organizerId || existing.eventId !== input.eventId || existing.ticketTypeId !== input.ticketTypeId || existing.quantity !== quantity) {
          throw new PrimaryDomainError("IDEMPOTENCY_CONFLICT");
        }
        return existing;
      }
      const { event, ticketType } = await requireReservableScope(tx, input.organizerId, input.eventId, input.ticketTypeId);
      if ((ticketType.minimumPerOrder !== null && quantity < ticketType.minimumPerOrder) || (ticketType.maximumPerOrder !== null && quantity > ticketType.maximumPerOrder)) {
        throw new PrimaryDomainError("RESERVATION_ORDER_LIMIT");
      }
      const committed = await tx.primaryInventoryReservation.findMany({
        where: { organizerId: input.organizerId, eventId: input.eventId, OR: [{ status: "PAYMENT_COMMITTED" }, { status: "HELD", expiresAt: { gt: now } }] },
        select: { ticketTypeId: true, quantity: true },
      });
      const eventCommitted = committed.reduce((sum, reservation) => sum + reservation.quantity, 0);
      const typeCommitted = committed.filter((reservation) => reservation.ticketTypeId === input.ticketTypeId).reduce((sum, reservation) => sum + reservation.quantity, 0);
      if (typeCommitted + quantity > ticketType.allocatedQuantity || eventCommitted + quantity > event.totalCapacity) {
        throw new PrimaryDomainError("INSUFFICIENT_RESERVABLE_CAPACITY");
      }
      const reservation = await tx.primaryInventoryReservation.create({ data: {
        organizerId: input.organizerId, eventId: input.eventId, ticketTypeId: input.ticketTypeId,
        buyerUserId: input.actor.id, quantity, expiresAt: new Date(now.getTime() + this.holdTtlMs), createIdempotencyKey: idempotencyKey,
      } });
      await this.audit(tx, reservation, "RESERVATION_HELD", idempotencyKey, input.actor.id, "USER");
      return reservation;
    }, { isolationLevel: "Serializable" });
  }

  commitForPayment(input: { internalCapability: PrimaryReservationInternalCapability; organizerId: string; eventId: string; reservationId: string; idempotencyKey: string }) {
    assertInternalCapability(input.internalCapability);
    return this.db.$transaction(async (tx) => {
      const key = requiredKey(input.idempotencyKey);
      const now = this.clock();
      await lockScope(tx, input.organizerId, input.eventId);
      const reservation = await tx.primaryInventoryReservation.findFirst({ where: { id: input.reservationId, organizerId: input.organizerId, eventId: input.eventId } });
      if (!reservation) throw new PrimaryAccessError("NOT_FOUND", 404);
      if (reservation.commitIdempotencyKey === key) return reservation;
      await requireReservableScope(tx, input.organizerId, input.eventId, reservation.ticketTypeId);
      if (reservation.status !== "HELD" || reservation.expiresAt <= now) throw new PrimaryDomainError("RESERVATION_NOT_COMMITTABLE");
      const updated = await tx.primaryInventoryReservation.update({ where: { id: reservation.id }, data: {
        status: "PAYMENT_COMMITTED", paymentCommittedAt: now,
        reconciliationAfter: new Date(now.getTime() + this.reconciliationDelayMs), commitIdempotencyKey: key,
      } });
      await this.audit(tx, updated, "RESERVATION_PAYMENT_COMMITTED", key, undefined, "SYSTEM");
      return updated;
    }, { isolationLevel: "Serializable" });
  }

  release(input: { actor: Actor; organizerId: string; eventId: string; reservationId: string; idempotencyKey: string }) {
    return this.db.$transaction(async (tx) => {
      const key = requiredKey(input.idempotencyKey);
      const now = this.clock();
      await requireBuyer(tx, input.actor);
      await lockScope(tx, input.organizerId, input.eventId);
      const reservation = await tx.primaryInventoryReservation.findFirst({ where: { id: input.reservationId, organizerId: input.organizerId, eventId: input.eventId, buyerUserId: input.actor.id } });
      if (!reservation) throw new PrimaryAccessError("NOT_FOUND", 404);
      if (reservation.releaseIdempotencyKey === key) return reservation;
      if (reservation.status !== "HELD") throw new PrimaryDomainError("RESERVATION_NOT_RELEASABLE");
      const updated = await tx.primaryInventoryReservation.update({ where: { id: reservation.id }, data: { status: "RELEASED", releasedAt: now, releaseIdempotencyKey: key } });
      await this.audit(tx, updated, "RESERVATION_RELEASED", key, input.actor.id, "USER");
      return updated;
    }, { isolationLevel: "Serializable" });
  }

  expireHeld(input: { internalCapability: PrimaryReservationInternalCapability; organizerId: string; eventId: string; reservationId: string; idempotencyKey: string }) {
    assertInternalCapability(input.internalCapability);
    return this.db.$transaction(async (tx) => {
      const key = requiredKey(input.idempotencyKey);
      const now = this.clock();
      await lockScope(tx, input.organizerId, input.eventId);
      const reservation = await tx.primaryInventoryReservation.findFirst({ where: { id: input.reservationId, organizerId: input.organizerId, eventId: input.eventId } });
      if (!reservation) throw new PrimaryAccessError("NOT_FOUND", 404);
      if (reservation.expireIdempotencyKey === key) return reservation;
      if (reservation.status === "PAYMENT_COMMITTED") throw new PrimaryDomainError("PAYMENT_COMMITTED_CANNOT_EXPIRE");
      if (reservation.status !== "HELD" || reservation.expiresAt > now) throw new PrimaryDomainError("RESERVATION_NOT_EXPIRABLE");
      const updated = await tx.primaryInventoryReservation.update({ where: { id: reservation.id }, data: { status: "EXPIRED", expiredAt: now, expireIdempotencyKey: key } });
      await this.audit(tx, updated, "RESERVATION_EXPIRED", key, undefined, "SYSTEM");
      return updated;
    }, { isolationLevel: "Serializable" });
  }

  private audit(tx: Tx, reservation: { id: string; organizerId: string; eventId: string; ticketTypeId: string; quantity: number; status: string; expiresAt: Date; reconciliationAfter: Date | null }, action: string, key: string, actorUserId: string | undefined, actorType: "USER" | "SYSTEM") {
    return recordPrimaryAuditAndOutbox(this.capability, tx, {
      organizerId: reservation.organizerId, eventId: reservation.eventId, actorUserId, actorType, action,
      targetType: "PrimaryInventoryReservation", targetId: reservation.id,
      after: reservation as unknown as Record<string, unknown>, requestId: key, topic: `primary.reservation.${action.toLowerCase()}`,
      payload: { organizerId: reservation.organizerId, eventId: reservation.eventId, ticketTypeId: reservation.ticketTypeId, reservationId: reservation.id, quantity: reservation.quantity, status: reservation.status },
      idempotencyKey: `${key}:${action.toLowerCase()}`,
    });
  }
}
