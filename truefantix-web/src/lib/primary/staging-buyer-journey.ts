import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, UserRole } from "@prisma/client";
import { STAGING_ADMIN_EMAIL, STAGING_ORGANIZER_EMAIL } from "./staging-console";

const ORGANIZER_ID = "primary-staging-buyer-organizer";
const EVENT_PREFIX = "staging-buyer-g";
const BUYER_EMAIL = "buyer@primary-staging.example.invalid";
const BUYER_PHONE = "+15550001005";
const BUYER_PASSWORD_HASH = "synthetic-staging-no-login";
const ORGANIZER_USER_PHONE = "+15550001001";
const ORGANIZER_USER_PASSWORD_HASH = "synthetic-staging-no-login";
const ORGANIZER_SUPPORT_EMAIL = "buyer-journey@primary-staging.example.invalid";
type Actor = { id: string; email: string; role: UserRole };
type Tx = Prisma.TransactionClient;

export class PrimaryStagingBuyerError extends Error {
  constructor(readonly code: string) { super(code); this.name = "PrimaryStagingBuyerError"; }
}

function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function ids(generation: number) {
  const base = `${EVENT_PREFIX}${generation}`;
  return { generation, base, eventId: `${base}-event`, ticketTypeId: `${base}-type`, reservationId: `${base}-reservation`, orderId: `${base}-order`, lineId: `${base}-line`, paymentId: `${base}-payment`, ticketId: `${base}-ticket`, credentialId: randomUUID() };
}
function requireAdmin(actor: Actor) {
  if (actor.email !== STAGING_ADMIN_EMAIL || actor.role !== "ADMIN") throw new PrimaryStagingBuyerError("STAGING_ADMIN_REQUIRED");
}

function organizerPersonaData(verifiedAt: Date) {
  return { passwordHash: ORGANIZER_USER_PASSWORD_HASH, emailVerifiedAt: verifiedAt, firstName: "Staging", lastName: "Organizer", displayName: "Staging Organizer", phone: ORGANIZER_USER_PHONE, phoneVerifiedAt: verifiedAt, streetAddress1: "1 Synthetic Way", streetAddress2: null, city: "Toronto", region: "ON", postalCode: "M5V 0A1", country: "CA", canBuy: false, canSell: false, canComment: false, isBanned: false, banReason: null, role: "USER" as const, sellerId: null, termsAcceptedAt: verifiedAt, termsVersion: "primary-staging-only", privacyAcceptedAt: verifiedAt, privacyVersion: "primary-staging-only" };
}

async function requireSyntheticFixture(tx: Tx, actor: Actor) {
  const [buyer, organizer, organizerUser] = await Promise.all([
    tx.user.findUnique({ where: { email: BUYER_EMAIL } }),
    tx.primaryOrganizer.findUnique({ where: { id: ORGANIZER_ID } }),
    tx.user.findUnique({ where: { email: STAGING_ORGANIZER_EMAIL } }),
  ]);
  if (
    !buyer || !organizer || !organizerUser
    || buyer.passwordHash !== BUYER_PASSWORD_HASH
    || buyer.firstName !== "Synthetic" || buyer.lastName !== "Buyer" || buyer.displayName !== null
    || buyer.phone !== BUYER_PHONE || buyer.phoneVerifiedAt === null || buyer.emailVerifiedAt === null
    || buyer.streetAddress1 !== "1 Synthetic Way" || buyer.streetAddress2 !== null
    || buyer.city !== "Toronto" || buyer.region !== "ON" || buyer.postalCode !== "M5V 0A1" || buyer.country !== "CA"
    || buyer.canBuy || buyer.canSell || buyer.canComment || buyer.isBanned || buyer.role !== "USER" || buyer.sellerId !== null
    || organizerUser.passwordHash !== ORGANIZER_USER_PASSWORD_HASH
    || organizerUser.firstName !== "Staging" || organizerUser.lastName !== "Organizer" || organizerUser.displayName !== "Staging Organizer"
    || organizerUser.phone !== ORGANIZER_USER_PHONE || organizerUser.phoneVerifiedAt === null || organizerUser.emailVerifiedAt === null
    || organizerUser.streetAddress1 !== "1 Synthetic Way" || organizerUser.streetAddress2 !== null
    || organizerUser.city !== "Toronto" || organizerUser.region !== "ON" || organizerUser.postalCode !== "M5V 0A1" || organizerUser.country !== "CA"
    || organizerUser.canBuy || organizerUser.canSell || organizerUser.canComment || organizerUser.isBanned || organizerUser.role !== "USER" || organizerUser.sellerId !== null
    || organizerUser.termsAcceptedAt === null || organizerUser.termsVersion !== "primary-staging-only"
    || organizerUser.privacyAcceptedAt === null || organizerUser.privacyVersion !== "primary-staging-only"
    || organizer.legalName !== "Synthetic Buyer Journey Inc." || organizer.displayName !== "Synthetic Buyer Journey"
    || organizer.addressLine1 !== "1 Synthetic Way" || organizer.addressLine2 !== null
    || organizer.city !== "Toronto" || organizer.region !== "ON" || organizer.postalCode !== "M5V 0A1" || organizer.country !== "CA"
    || organizer.supportEmail !== ORGANIZER_SUPPORT_EMAIL || organizer.supportPhone !== BUYER_PHONE || organizer.website !== null
    || organizer.status !== "APPROVED" || organizer.paymentProvider !== null || organizer.paymentAccountRefEncrypted !== null
    || organizer.paymentStatus !== "NOT_STARTED" || organizer.createdByUserId !== organizerUser.id || organizer.approvedByUserId !== actor.id
  ) throw new PrimaryStagingBuyerError("STAGING_BUYER_FIXTURE_INVALID");
  return buyer;
}

async function requireScenarioRoot(tx: Tx, scope: ReturnType<typeof ids>, actor: Actor) {
  const [event, ticketType] = await Promise.all([
    tx.primaryEvent.findUnique({ where: { id: scope.eventId } }),
    tx.primaryTicketType.findUnique({ where: { id: scope.ticketTypeId } }),
  ]);
  if (
    !event || !ticketType
    || event.organizerId !== ORGANIZER_ID || event.title !== `Synthetic Buyer Journey / Generation ${scope.generation}`
    || event.description !== "Staging-only purchase and admission walkthrough." || event.category !== "SYNTHETIC"
    || event.venueName !== "Synthetic Admission Hall" || event.venueAddressLine1 !== "1 Synthetic Way" || event.venueAddressLine2 !== null
    || event.venueCity !== "Toronto" || event.venueRegion !== "ON" || event.venuePostalCode !== "M5V 0A1" || event.venueCountry !== "CA"
    || event.startsAtLocal.toISOString() !== "2038-07-01T19:00:00.000Z" || event.endsAtLocal.toISOString() !== "2038-07-01T22:00:00.000Z"
    || event.timezone !== "America/Toronto" || event.contactEmail !== ORGANIZER_SUPPORT_EMAIL || event.contactPhone !== BUYER_PHONE
    || event.draftPolicyText !== "Synthetic staging-only policy." || event.totalCapacity !== 10 || event.status !== "APPROVED" || event.approvedByUserId !== actor.id
    || ticketType.organizerId !== ORGANIZER_ID || ticketType.eventId !== scope.eventId
    || ticketType.name !== "General admission" || ticketType.description !== "Synthetic inventory only."
    || ticketType.allocatedQuantity !== 10 || ticketType.status !== "ACTIVE" || ticketType.minimumPerOrder !== 1 || ticketType.maximumPerOrder !== 2
    || ticketType.currency !== "CAD" || ticketType.basePriceMinor !== 3500
  ) throw new PrimaryStagingBuyerError("STAGING_BUYER_SCENARIO_INVALID");
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
    const organizerUser = await tx.user.upsert({ where: { email: STAGING_ORGANIZER_EMAIL }, create: { email: STAGING_ORGANIZER_EMAIL, ...organizerPersonaData(now) }, update: organizerPersonaData(now) });
    const buyerData = { passwordHash: BUYER_PASSWORD_HASH, emailVerifiedAt: now, firstName: "Synthetic", lastName: "Buyer", displayName: null, phone: BUYER_PHONE, phoneVerifiedAt: now, streetAddress1: "1 Synthetic Way", streetAddress2: null, city: "Toronto", region: "ON", postalCode: "M5V 0A1", country: "CA", canBuy: false, canSell: false, canComment: false, isBanned: false, banReason: null, role: "USER" as const, sellerId: null };
    await tx.user.upsert({ where: { email: BUYER_EMAIL }, create: { email: BUYER_EMAIL, ...buyerData }, update: buyerData });
    const organizerData = { legalName: "Synthetic Buyer Journey Inc.", displayName: "Synthetic Buyer Journey", businessNumberEncrypted: null, addressLine1: "1 Synthetic Way", addressLine2: null, city: "Toronto", region: "ON", postalCode: "M5V 0A1", country: "CA", supportEmail: ORGANIZER_SUPPORT_EMAIL, supportPhone: BUYER_PHONE, website: null, status: "APPROVED" as const, statusReason: null, paymentProvider: null, paymentAccountRefEncrypted: null, paymentStatus: "NOT_STARTED" as const, submittedAt: now, approvedAt: now, approvedByUserId: actor.id, createdByUserId: organizerUser.id };
    await tx.primaryOrganizer.upsert({ where: { id: ORGANIZER_ID }, create: { id: ORGANIZER_ID, ...organizerData }, update: organizerData });
    await tx.primaryEvent.create({ data: { id: scope.eventId, organizerId: ORGANIZER_ID, title: `Synthetic Buyer Journey / Generation ${next}`, description: "Staging-only purchase and admission walkthrough.", category: "SYNTHETIC", venueName: "Synthetic Admission Hall", venueAddressLine1: "1 Synthetic Way", venueCity: "Toronto", venueRegion: "ON", venuePostalCode: "M5V 0A1", venueCountry: "CA", startsAtLocal: new Date("2038-07-01T19:00:00Z"), endsAtLocal: new Date("2038-07-01T22:00:00Z"), timezone: "America/Toronto", contactEmail: "buyer-journey@primary-staging.example.invalid", contactPhone: "+15550001005", draftPolicyText: "Synthetic staging-only policy.", totalCapacity: 10, status: "APPROVED", submittedAt: now, approvedAt: now, approvedByUserId: actor.id } });
    await tx.primaryTicketType.create({ data: { id: scope.ticketTypeId, organizerId: ORGANIZER_ID, eventId: scope.eventId, name: "General admission", description: "Synthetic inventory only.", allocatedQuantity: 10, minimumPerOrder: 1, maximumPerOrder: 2, currency: "CAD", basePriceMinor: 3500 } });
    return { generation: next };
  });
}

export async function advancePrimaryStagingBuyerJourney(db: PrismaClient, actor: Actor) {
  return db.$transaction(async (tx) => {
    requireAdmin(actor); await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746836292)");
    const currentGeneration = await generation(tx); if (!currentGeneration) throw new PrimaryStagingBuyerError("STAGING_BUYER_SCENARIO_REQUIRED");
    const scope = ids(currentGeneration); const now = new Date(); const buyer = await requireSyntheticFixture(tx, actor); await requireScenarioRoot(tx, scope, actor);
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
