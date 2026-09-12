import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, UserRole } from "@prisma/client";
import { STAGING_ADMIN_EMAIL, STAGING_ORGANIZER_EMAIL } from "./staging-console";

const ORGANIZER_ID = "primary-staging-buyer-organizer";
const EVENT_PREFIX = "staging-buyer-g";
const BUYER_EMAIL = "buyer@primary-staging.example.invalid";
type Actor = { id: string; email: string; role: UserRole };
type Tx = Prisma.TransactionClient;

export class PrimaryStagingBuyerError extends Error {
  constructor(readonly code: string) { super(code); this.name = "PrimaryStagingBuyerError"; }
}

function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function ids(generation: number) {
  const base = `${EVENT_PREFIX}${generation}`;
  return { base, eventId: `${base}-event`, ticketTypeId: `${base}-type`, reservationId: `${base}-reservation`, orderId: `${base}-order`, lineId: `${base}-line`, paymentId: `${base}-payment`, ticketId: `${base}-ticket`, credentialId: randomUUID() };
}
function requireAdmin(actor: Actor) {
  if (actor.email !== STAGING_ADMIN_EMAIL || actor.role !== "ADMIN") throw new PrimaryStagingBuyerError("STAGING_ADMIN_REQUIRED");
}

async function generation(tx: Tx) {
  const rows = await tx.$queryRawUnsafe<Array<{ generation: number }>>(`SELECT COALESCE(MAX((regexp_match(id, '^staging-buyer-g([0-9]+)-event$'))[1]::int),0)::int AS generation FROM "PrimaryEvent" WHERE "organizerId"=$1`, ORGANIZER_ID);
  return Number(rows[0]?.generation ?? 0);
}

export async function reseedPrimaryStagingBuyerJourney(db: PrismaClient, actor: Actor) {
  return db.$transaction(async (tx) => {
    requireAdmin(actor);
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746836292)");
    const next = (await generation(tx)) + 1; const scope = ids(next); const now = new Date();
    const organizerUser = await tx.user.findUniqueOrThrow({ where: { email: STAGING_ORGANIZER_EMAIL } });
    await tx.user.upsert({ where: { email: BUYER_EMAIL }, create: { email: BUYER_EMAIL, passwordHash: "synthetic-staging-no-login", emailVerifiedAt: now, firstName: "Synthetic", lastName: "Buyer", phone: "+15550001005", phoneVerifiedAt: now, streetAddress1: "1 Synthetic Way", city: "Toronto", region: "ON", postalCode: "M5V 0A1", country: "CA", canBuy: false, canSell: false, canComment: false }, update: { emailVerifiedAt: now, isBanned: false } });
    await tx.primaryOrganizer.upsert({ where: { id: ORGANIZER_ID }, create: { id: ORGANIZER_ID, legalName: "Synthetic Buyer Journey Inc.", displayName: "Synthetic Buyer Journey", addressLine1: "1 Synthetic Way", city: "Toronto", region: "ON", postalCode: "M5V 0A1", country: "CA", supportEmail: "buyer-journey@primary-staging.example.invalid", supportPhone: "+15550001005", status: "APPROVED", submittedAt: now, approvedAt: now, approvedByUserId: actor.id, createdByUserId: organizerUser.id }, update: {} });
    await tx.primaryEvent.create({ data: { id: scope.eventId, organizerId: ORGANIZER_ID, title: `Synthetic Buyer Journey / Generation ${next}`, description: "Staging-only purchase and admission walkthrough.", category: "SYNTHETIC", venueName: "Synthetic Admission Hall", venueAddressLine1: "1 Synthetic Way", venueCity: "Toronto", venueRegion: "ON", venuePostalCode: "M5V 0A1", venueCountry: "CA", startsAtLocal: new Date("2038-07-01T19:00:00Z"), endsAtLocal: new Date("2038-07-01T22:00:00Z"), timezone: "America/Toronto", contactEmail: "buyer-journey@primary-staging.example.invalid", contactPhone: "+15550001005", draftPolicyText: "Synthetic staging-only policy.", totalCapacity: 10, status: "APPROVED", submittedAt: now, approvedAt: now, approvedByUserId: actor.id } });
    await tx.primaryTicketType.create({ data: { id: scope.ticketTypeId, organizerId: ORGANIZER_ID, eventId: scope.eventId, name: "General admission", description: "Synthetic inventory only.", allocatedQuantity: 10, minimumPerOrder: 1, maximumPerOrder: 2, currency: "CAD", basePriceMinor: 3500 } });
    return { generation: next };
  });
}

export async function advancePrimaryStagingBuyerJourney(db: PrismaClient, actor: Actor) {
  return db.$transaction(async (tx) => {
    requireAdmin(actor); const currentGeneration = await generation(tx); if (!currentGeneration) throw new PrimaryStagingBuyerError("STAGING_BUYER_SCENARIO_REQUIRED");
    const scope = ids(currentGeneration); const now = new Date(); const buyer = await tx.user.findUniqueOrThrow({ where: { email: BUYER_EMAIL } });
    const reservation = await tx.primaryInventoryReservation.findUnique({ where: { id: scope.reservationId } });
    if (!reservation) {
      await tx.primaryInventoryReservation.create({ data: { id: scope.reservationId, organizerId: ORGANIZER_ID, eventId: scope.eventId, ticketTypeId: scope.ticketTypeId, buyerUserId: buyer.id, quantity: 1, expiresAt: new Date(now.getTime() + 600_000), createIdempotencyKey: `${scope.base}:hold` } });
      return { step: "HELD" };
    }
    const order = await tx.primaryOrder.findUnique({ where: { id: scope.orderId } });
    if (!order) {
      await tx.primaryOrder.create({ data: { id: scope.orderId, organizerId: ORGANIZER_ID, eventId: scope.eventId, buyerUserId: buyer.id, reservationId: scope.reservationId, currency: "CAD", faceValueSubtotalMinor: 3500, grossTotalMinor: 3800, createIdempotencyKey: `${scope.base}:order` } });
      await tx.primaryOrderLine.create({ data: { id: scope.lineId, orderId: scope.orderId, ticketTypeId: scope.ticketTypeId, reservationId: scope.reservationId, quantity: 1, ticketTypeNameSnapshot: "General admission", unitFaceValueMinor: 3500, faceValueSubtotalMinor: 3500, currency: "CAD" } });
      await tx.primaryOrderPriceComponent.createMany({ data: [{ id: `${scope.base}-face`, orderId: scope.orderId, orderLineId: scope.lineId, code: "FACE_VALUE", label: "Face value", kind: "FACE_VALUE", amountMinor: 3500, currency: "CAD", allocationBaseMinor: 3500, allocationRemainderUnits: 0, position: 0 }, { id: `${scope.base}-fee`, orderId: scope.orderId, orderLineId: scope.lineId, code: "ORGANIZER_FEE", label: "Synthetic organizer fee", kind: "MANDATORY_FEE", amountMinor: 300, currency: "CAD", allocationBaseMinor: 300, allocationRemainderUnits: 0, position: 1 }] });
      return { step: "ORDER_CREATED" };
    }
    const payment = await tx.primaryPaymentAttempt.findUnique({ where: { orderId: scope.orderId } });
    if (!payment) {
      await tx.primaryInventoryReservation.update({ where: { id: scope.reservationId }, data: { status: "PAYMENT_COMMITTED", paymentCommittedAt: now, reconciliationAfter: new Date(now.getTime() + 120_000), commitIdempotencyKey: `${scope.base}:commit` } });
      await tx.primaryOrder.update({ where: { id: scope.orderId }, data: { status: "PAYMENT_PROCESSING", prepareIdempotencyKey: `${scope.base}:prepare`, prepareReconciliationDelayMs: 120000, paymentProcessingAt: now } });
      await tx.primaryPaymentAttempt.create({ data: { id: scope.paymentId, organizerId: ORGANIZER_ID, eventId: scope.eventId, buyerUserId: buyer.id, reservationId: scope.reservationId, orderId: scope.orderId, expectedAmountMinor: 3800, currency: "CAD", createIdempotencyKey: `${scope.base}:payment` } });
      return { step: "PAYMENT_PROCESSING" };
    }
    if (payment.status === "PENDING_PROVIDER") {
      await tx.primaryPaymentAttempt.update({ where: { id: payment.id }, data: { status: "PROCESSING", providerIntentId: `synthetic_${scope.base}`, providerCreatedAt: now } });
      return { step: "PROCESSING" };
    }
    if (payment.status === "PROCESSING") {
      await tx.primaryPaymentAttempt.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", terminalAt: now } });
      await tx.primaryOrder.update({ where: { id: scope.orderId }, data: { status: "PAID", paidAt: now } });
      return { step: "PAID" };
    }
    const ticket = await tx.primaryAdmissionTicket.findUnique({ where: { id: scope.ticketId }, include: { credential: true } });
    if (!ticket) {
      await tx.primaryAdmissionTicket.create({ data: { id: scope.ticketId, organizerId: ORGANIZER_ID, eventId: scope.eventId, buyerUserId: buyer.id, reservationId: scope.reservationId, orderId: scope.orderId, orderLineId: scope.lineId, ticketTypeId: scope.ticketTypeId, unitNumber: 1, issuanceIdempotencyKey: `${scope.base}:issue`, issuedAt: now, credential: { create: { id: scope.credentialId, payloadVersion: 1, keyId: "synthetic-staging-only", payloadDigest: digest([scope.base, "credential"]), issuedAt: now } } } });
      return { step: "ISSUED" };
    }
    if (ticket.status === "ISSUED") {
      await tx.primaryAdmissionTicket.update({ where: { id: ticket.id }, data: { status: "CHECKED_IN" } });
      await tx.primaryAdmissionScan.create({ data: { requestId: `${scope.base}:scan`, commandDigest: digest([scope.base, "scan"]), organizerId: ORGANIZER_ID, eventId: scope.eventId, admissionTicketId: ticket.id, credentialId: ticket.credential!.id, operatorUserId: actor.id, result: "ACCEPTED", deviceId: "synthetic-console", scannedAt: now } });
      return { step: "CHECKED_IN" };
    }
    throw new PrimaryStagingBuyerError("STAGING_BUYER_JOURNEY_COMPLETE");
  }, { isolationLevel: "Serializable" });
}

export async function getPrimaryStagingBuyerJourney(db: PrismaClient) {
  if (typeof db.$queryRawUnsafe !== "function") return null;
  const currentGeneration = await generation(db as unknown as Tx); if (!currentGeneration) return null; const scope = ids(currentGeneration);
  const event = await db.primaryEvent.findUnique({ where: { id: scope.eventId }, include: { ticketTypes: true, reservations: { include: { order: { include: { paymentAttempt: true, admissionTickets: { include: { credential: true, scans: true } } } } } } } });
  if (!event) return null; const reservation = event.reservations[0] ?? null; const order = reservation?.order ?? null; const ticket = order?.admissionTickets[0] ?? null;
  return { generation: currentGeneration, event: { id: event.id, title: event.title, status: event.status }, ticketType: event.ticketTypes[0], reservation: reservation && { id: reservation.id, status: reservation.status, quantity: reservation.quantity }, order: order && { id: order.id, status: order.status, grossTotalMinor: order.grossTotalMinor, currency: order.currency }, payment: order?.paymentAttempt && { status: order.paymentAttempt.status, providerIntentId: order.paymentAttempt.providerIntentId }, admission: ticket && { id: ticket.id, status: ticket.status, credentialId: ticket.credential?.id ?? null, scans: ticket.scans.map((scan) => ({ result: scan.result, scannedAt: scan.scannedAt })) } };
}
