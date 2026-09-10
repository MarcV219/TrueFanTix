import type { Prisma, UserRole } from "@prisma/client";
import { recordPrimaryAuditAndOutbox } from "./audit-outbox";
import { PrimaryAccessError } from "./authorization";
import type { PrimaryPreflightCapability } from "./config";
import { PrimaryDomainError } from "./organizer-service";

type Tx = Prisma.TransactionClient;
type ServiceDb = { $transaction<T>(fn: (tx: Tx) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> };
type Actor = { id: string; role: UserRole };
export type PrimaryOrderInternalCapability = { readonly kind: "PrimaryOrderInternalCapability" };
const internalCapabilities = new WeakSet<object>();
const supportedCurrencies = new Set((Intl as typeof Intl & { supportedValuesOf?: (key: "currency") => string[] }).supportedValuesOf?.("currency") ?? ["CAD", "USD"]);
export const PRIMARY_ORDER_INTEGER_MAX = 2_147_483_647;

export type PrimaryOrderAdditionalComponent = {
  code: string;
  label: string;
  kind: "MANDATORY_FEE" | "TAX";
  amountMinor: number;
};

export function createPrimaryOrderInternalCapabilityForTests(): PrimaryOrderInternalCapability {
  if (process.env.NODE_ENV !== "test" || process.env.PRIMARY_TICKETING_ENVIRONMENT_ID !== "isolated-test") throw new PrimaryDomainError("ORDER_INTERNAL_BOUNDARY_FORBIDDEN");
  const capability = Object.freeze({ kind: "PrimaryOrderInternalCapability" as const });
  internalCapabilities.add(capability);
  return capability;
}

function assertInternal(capability: PrimaryOrderInternalCapability) {
  if (!internalCapabilities.has(capability)) throw new PrimaryDomainError("ORDER_INTERNAL_BOUNDARY_FORBIDDEN");
}

function key(value: string) {
  const result = value.trim();
  if (!result) throw new PrimaryDomainError("IDEMPOTENCY_KEY_REQUIRED");
  return result;
}

function safePositive(value: number, code: string) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > PRIMARY_ORDER_INTEGER_MAX) throw new PrimaryDomainError(code);
  return value;
}

function checkedAdd(left: number, right: number) {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result > PRIMARY_ORDER_INTEGER_MAX) throw new PrimaryDomainError("ORDER_AMOUNT_OVERFLOW");
  return result;
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
  await tx.$queryRaw`SELECT id FROM "PrimaryOrder" WHERE "organizerId" = ${organizerId} AND "eventId" = ${eventId} ORDER BY id FOR UPDATE`;
}

async function requireActiveScope(tx: Tx, organizerId: string, eventId: string, ticketTypeId: string) {
  const [organizer, event, ticketType] = await Promise.all([
    tx.primaryOrganizer.findUnique({ where: { id: organizerId }, select: { status: true } }),
    tx.primaryEvent.findFirst({ where: { id: eventId, organizerId }, select: { status: true } }),
    tx.primaryTicketType.findFirst({ where: { id: ticketTypeId, organizerId, eventId } }),
  ]);
  if (!organizer || !event || !ticketType) throw new PrimaryAccessError("NOT_FOUND", 404);
  if (organizer.status === "SUSPENDED") throw new PrimaryDomainError("ORGANIZER_SUSPENDED");
  if (organizer.status !== "APPROVED") throw new PrimaryDomainError("ORGANIZER_NOT_APPROVED");
  if (event.status !== "APPROVED") throw new PrimaryDomainError("EVENT_NOT_APPROVED");
  if (ticketType.status !== "ACTIVE") throw new PrimaryDomainError("TICKET_TYPE_INACTIVE");
  return ticketType;
}

function validateComponents(components: PrimaryOrderAdditionalComponent[], quantity: number) {
  const seen = new Set(["FACE_VALUE"]);
  return components.map((component, index) => {
    const code = component.code.trim().toUpperCase();
    const label = component.label.trim();
    if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(code) || seen.has(code)) throw new PrimaryDomainError("INVALID_PRICE_COMPONENT_CODE");
    if (!label) throw new PrimaryDomainError("PRICE_COMPONENT_LABEL_REQUIRED");
    if (component.kind !== "MANDATORY_FEE" && component.kind !== "TAX") throw new PrimaryDomainError("INVALID_PRICE_COMPONENT_KIND");
    seen.add(code);
    const amountMinor = safePositive(component.amountMinor, "INVALID_PRICE_COMPONENT_AMOUNT");
    return { ...component, code, label, amountMinor, position: index + 1, allocationBaseMinor: Math.floor(amountMinor / quantity), allocationRemainderUnits: amountMinor % quantity };
  });
}

export class PrimaryOrderService {
  constructor(private readonly db: ServiceDb, private readonly capability: PrimaryPreflightCapability, private readonly clock: () => Date = () => new Date()) {}

  create(input: { internalCapability: PrimaryOrderInternalCapability; actor: Actor; organizerId: string; eventId: string; reservationId: string; idempotencyKey: string; additionalComponents?: PrimaryOrderAdditionalComponent[] }) {
    assertInternal(input.internalCapability);
    return this.db.$transaction(async (tx) => {
      const idempotencyKey = key(input.idempotencyKey);
      const now = this.clock();
      await requireBuyer(tx, input.actor);
      await lockScope(tx, input.organizerId, input.eventId);
      const existing = await tx.primaryOrder.findUnique({ where: { createIdempotencyKey: idempotencyKey }, include: { lines: true, components: true } });
      if (existing) {
        if (existing.buyerUserId !== input.actor.id || existing.organizerId !== input.organizerId || existing.eventId !== input.eventId || existing.reservationId !== input.reservationId) throw new PrimaryDomainError("IDEMPOTENCY_CONFLICT");
        const desired = validateComponents(input.additionalComponents ?? [], existing.lines[0].quantity).map(({ code, label, kind, amountMinor }) => ({ code, label, kind, amountMinor }));
        const stored = existing.components.filter((component) => component.kind !== "FACE_VALUE").sort((a, b) => a.position - b.position).map(({ code, label, kind, amountMinor }) => ({ code, label, kind, amountMinor }));
        if (JSON.stringify(desired) !== JSON.stringify(stored)) throw new PrimaryDomainError("IDEMPOTENCY_CONFLICT");
        return existing;
      }
      const reservation = await tx.primaryInventoryReservation.findFirst({ where: { id: input.reservationId, organizerId: input.organizerId, eventId: input.eventId, buyerUserId: input.actor.id } });
      if (!reservation) throw new PrimaryAccessError("NOT_FOUND", 404);
      if (reservation.status !== "HELD" || reservation.expiresAt <= now) throw new PrimaryDomainError("RESERVATION_NOT_ORDERABLE");
      const ticketType = await requireActiveScope(tx, input.organizerId, input.eventId, reservation.ticketTypeId);
      if (!supportedCurrencies.has(ticketType.currency)) throw new PrimaryDomainError("INVALID_CURRENCY");
      const existingForReservation = await tx.primaryOrder.findUnique({ where: { reservationId: reservation.id } });
      if (existingForReservation) throw new PrimaryDomainError("RESERVATION_ALREADY_HAS_ORDER");
      const unitFaceValueMinor = safePositive(ticketType.basePriceMinor, "ORDER_AMOUNT_OVERFLOW");
      const quantity = safePositive(reservation.quantity, "ORDER_AMOUNT_OVERFLOW");
      const faceValueSubtotalMinor = unitFaceValueMinor * quantity;
      if (!Number.isSafeInteger(faceValueSubtotalMinor) || faceValueSubtotalMinor <= 0 || faceValueSubtotalMinor > PRIMARY_ORDER_INTEGER_MAX) throw new PrimaryDomainError("ORDER_AMOUNT_OVERFLOW");
      const additional = validateComponents(input.additionalComponents ?? [], reservation.quantity);
      const grossTotalMinor = additional.reduce((sum, component) => checkedAdd(sum, component.amountMinor), faceValueSubtotalMinor);
      const order = await tx.primaryOrder.create({ data: {
        organizerId: input.organizerId, eventId: input.eventId, buyerUserId: input.actor.id, reservationId: reservation.id,
        currency: ticketType.currency, faceValueSubtotalMinor, grossTotalMinor, createIdempotencyKey: idempotencyKey,
      } });
      const line = await tx.primaryOrderLine.create({ data: {
        orderId: order.id, reservationId: reservation.id, ticketTypeId: ticketType.id, quantity, ticketTypeNameSnapshot: ticketType.name,
        unitFaceValueMinor, faceValueSubtotalMinor, currency: ticketType.currency,
      } });
      await tx.primaryOrderPriceComponent.createMany({ data: [
        { orderId: order.id, orderLineId: line.id, code: "FACE_VALUE", label: "Face value", kind: "FACE_VALUE", amountMinor: faceValueSubtotalMinor, currency: ticketType.currency, allocationBaseMinor: ticketType.basePriceMinor, allocationRemainderUnits: 0, position: 0 },
        ...additional.map((component) => ({ orderId: order.id, orderLineId: line.id, ...component, currency: ticketType.currency })),
      ] });
      await this.audit(tx, order, "ORDER_CREATED", idempotencyKey, input.actor.id, "USER");
      return tx.primaryOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true, components: { orderBy: { position: "asc" } } } });
    }, { isolationLevel: "Serializable" });
  }

  async prepareForPayment(input: { internalCapability: PrimaryOrderInternalCapability; organizerId: string; eventId: string; orderId: string; idempotencyKey: string; reconciliationDelayMs?: number }) {
    assertInternal(input.internalCapability);
    try {
      return await this.db.$transaction(async (tx) => {
      const idempotencyKey = key(input.idempotencyKey);
      const now = this.clock();
      const delay = safePositive(input.reconciliationDelayMs ?? 30 * 60 * 1000, "INVALID_RECONCILIATION_DELAY");
      await lockScope(tx, input.organizerId, input.eventId);
      const existingCommand = await tx.primaryOrder.findUnique({ where: { prepareIdempotencyKey: idempotencyKey } });
      if (existingCommand) {
        if (existingCommand.id !== input.orderId || existingCommand.organizerId !== input.organizerId || existingCommand.eventId !== input.eventId || existingCommand.prepareReconciliationDelayMs !== delay) throw new PrimaryDomainError("IDEMPOTENCY_CONFLICT");
        return existingCommand;
      }
      const order = await tx.primaryOrder.findFirst({ where: { id: input.orderId, organizerId: input.organizerId, eventId: input.eventId } });
      if (!order) throw new PrimaryAccessError("NOT_FOUND", 404);
      if (order.status !== "PENDING_PAYMENT") throw new PrimaryDomainError("ORDER_NOT_PREPARABLE");
      const reservation = await tx.primaryInventoryReservation.findUnique({ where: { id: order.reservationId } });
      if (!reservation || reservation.status !== "HELD" || reservation.expiresAt <= now) throw new PrimaryDomainError("RESERVATION_NOT_COMMITTABLE");
      await requireActiveScope(tx, input.organizerId, input.eventId, reservation.ticketTypeId);
      const committed = await tx.primaryInventoryReservation.update({ where: { id: reservation.id }, data: {
        status: "PAYMENT_COMMITTED", paymentCommittedAt: now, reconciliationAfter: new Date(now.getTime() + delay), commitIdempotencyKey: `${idempotencyKey}:reservation`,
      } });
      await this.audit(tx, committed, "RESERVATION_PAYMENT_COMMITTED", `${idempotencyKey}:reservation`, undefined, "SYSTEM");
      const updated = await tx.primaryOrder.update({ where: { id: order.id }, data: { status: "PAYMENT_PROCESSING", paymentProcessingAt: now, prepareIdempotencyKey: idempotencyKey, prepareReconciliationDelayMs: delay } });
      await this.audit(tx, updated, "ORDER_PAYMENT_PROCESSING", idempotencyKey, undefined, "SYSTEM");
      return updated;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new PrimaryDomainError("IDEMPOTENCY_CONFLICT");
      throw error;
    }
  }

  private audit(tx: Tx, target: { id: string; organizerId: string; eventId: string; status: string }, action: string, requestId: string, actorUserId: string | undefined, actorType: "USER" | "SYSTEM") {
    return recordPrimaryAuditAndOutbox(this.capability, tx, {
      organizerId: target.organizerId, eventId: target.eventId, actorUserId, actorType, action,
      targetType: action.startsWith("ORDER_") ? "PrimaryOrder" : "PrimaryInventoryReservation", targetId: target.id,
      after: target as unknown as Record<string, unknown>, requestId, topic: `primary.order.${action.toLowerCase()}`,
      payload: { organizerId: target.organizerId, eventId: target.eventId, targetId: target.id, status: target.status },
      idempotencyKey: `${requestId}:${action.toLowerCase()}`,
    });
  }
}
