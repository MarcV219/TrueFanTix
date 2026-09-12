import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, UserRole } from "@prisma/client";
import { STAGING_ADMIN_EMAIL, STAGING_ORGANIZER_EMAIL } from "./staging-console";

const ORGANIZER_ID = "primary-staging-refund-organizer";
const POLICY_ID = "primary-refund-policy-v1";
const EVENT_PREFIX = "staging-refund-g";
const BUYER_EMAIL = "refund-buyer@primary-staging.example.invalid";
const BUYER_PHONE = "+15550001004";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
type Actor = { id: string; email: string; role: UserRole };
type ScenarioKind = "ordinary" | "checked" | "cancellation";

const ACTION_SCENARIOS: Partial<Record<string, ScenarioKind>> = {
  refundOrdinary: "ordinary",
  requestCheckedRefund: "checked",
  approveCheckedRefund: "checked",
  completeCheckedRefund: "checked",
  activateCancellation: "cancellation",
  prepareCancellation: "cancellation",
  approveCancellationWaiver: "cancellation",
  completeCancellation: "cancellation",
};

const REFUND_ACTION_INPUTS: Record<string, ReadonlySet<string>> = {
  reseedRefundScenarios: new Set(["action"]),
  refundOrdinary: new Set(["action"]),
  requestCheckedRefund: new Set(["action"]),
  approveCheckedRefund: new Set(["action", "reason", "evidence", "fraudReview", "costBearer"]),
  completeCheckedRefund: new Set(["action"]),
  activateCancellation: new Set(["action"]),
  prepareCancellation: new Set(["action"]),
  approveCancellationWaiver: new Set(["action", "reason", "evidence"]),
  completeCancellation: new Set(["action"]),
};

export class PrimaryStagingRefundError extends Error {
  constructor(readonly code: string, message = code, readonly generation?: number) {
    super(message);
    this.name = "PrimaryStagingRefundError";
  }
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function textDigest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredText(input: Record<string, unknown>, key: string, code: string, maximum = 500) {
  const value = typeof input[key] === "string" ? input[key].trim() : "";
  if (!value || value.length > maximum) throw new PrimaryStagingRefundError(code);
  return value;
}

export function assertPrimaryStagingRefundActionInput(action: string, input: Record<string, unknown>) {
  const allowed = REFUND_ACTION_INPUTS[action];
  if (!allowed) throw new PrimaryStagingRefundError("UNKNOWN_REFUND_ACTION");
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new PrimaryStagingRefundError("STAGING_REFUND_UNEXPECTED_INPUT");
  }
}

function ids(generation: number, kind: ScenarioKind) {
  const base = `${EVENT_PREFIX}${generation}-${kind}`;
  return {
    generation,
    kind,
    eventId: `${base}-event`,
    ticketTypeId: `${base}-ticket-type`,
    reservationId: `${base}-reservation`,
    orderId: `${base}-order`,
    lineId: `${base}-line`,
    paymentId: `${base}-payment`,
    base,
  };
}

function scenarioFinancials(kind: ScenarioKind) {
  const quantity = kind === "cancellation" ? 2 : 1;
  const unitFaceValueMinor = kind === "ordinary" ? 2500 : kind === "checked" ? 3000 : 2000;
  const feeMinor = kind === "ordinary" ? 100 : kind === "checked" ? 120 : 200;
  return {
    quantity,
    unitFaceValueMinor,
    feeMinor,
    faceValueSubtotalMinor: quantity * unitFaceValueMinor,
    grossTotalMinor: quantity * unitFaceValueMinor + feeMinor,
  };
}

function scenarioTitle(kind: ScenarioKind) {
  return kind === "ordinary"
    ? "Ordinary unscanned refund"
    : kind === "checked"
      ? "Checked-in supervised refund"
      : "Event cancellation and obligations";
}

async function requireOrganizer(tx: Tx, actor: Actor) {
  if (actor.email !== STAGING_ORGANIZER_EMAIL || actor.role !== "USER") {
    throw new PrimaryStagingRefundError("STAGING_ORGANIZER_REQUIRED");
  }
  const user = await tx.user.findFirst({
    where: {
      id: actor.id,
      email: STAGING_ORGANIZER_EMAIL,
      role: "USER",
      isBanned: false,
      emailVerifiedAt: { not: null },
      phoneVerifiedAt: { not: null },
    },
    select: { id: true },
  });
  if (!user) throw new PrimaryStagingRefundError("STAGING_ORGANIZER_REQUIRED");
  const membership = await tx.primaryOrganizerMembership.findFirst({
    where: { organizerId: ORGANIZER_ID, userId: actor.id, role: "OWNER", status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) throw new PrimaryStagingRefundError("STAGING_REFUND_SCOPE_REQUIRED");
}

async function requireAdmin(tx: Tx, actor: Actor) {
  if (actor.email !== STAGING_ADMIN_EMAIL || actor.role !== "ADMIN") {
    throw new PrimaryStagingRefundError("STAGING_ADMIN_REQUIRED");
  }
  const user = await tx.user.findFirst({
    where: {
      id: actor.id,
      email: STAGING_ADMIN_EMAIL,
      role: "ADMIN",
      isBanned: false,
      emailVerifiedAt: { not: null },
      phoneVerifiedAt: { not: null },
    },
    select: { id: true },
  });
  if (!user) throw new PrimaryStagingRefundError("STAGING_ADMIN_REQUIRED");
}

async function requireSyntheticTenantAccessProvenance(tx: Tx) {
  const [memberships, invitationCount, assignmentCount] = await Promise.all([
    tx.primaryOrganizerMembership.findMany({
      where: { organizerId: ORGANIZER_ID },
      select: {
        userId: true,
        role: true,
        status: true,
        acceptedAt: true,
        revokedAt: true,
        invitedByUserId: true,
        user: { select: { email: true } },
        invitedBy: { select: { email: true } },
      },
    }),
    tx.primaryOrganizerInvitation.count({ where: { organizerId: ORGANIZER_ID } }),
    tx.primaryEventStaffAssignment.count({ where: { organizerId: ORGANIZER_ID } }),
  ]);
  const membership = memberships[0];
  if (
    memberships.length !== 1
    || !membership
    || membership.role !== "OWNER"
    || membership.status !== "ACTIVE"
    || membership.acceptedAt === null
    || membership.revokedAt !== null
    || membership.userId !== membership.invitedByUserId
    || membership.user.email !== STAGING_ORGANIZER_EMAIL
    || membership.invitedBy.email !== STAGING_ORGANIZER_EMAIL
    || invitationCount !== 0
    || assignmentCount !== 0
  ) {
    throw new PrimaryStagingRefundError("STAGING_REFUND_ACCESS_PROVENANCE_INVALID");
  }
}

async function requireSyntheticNoDeliveryIntent(tx: Tx) {
  const [refunds, cancellations, obligations] = await Promise.all([
    tx.primaryRefund.findMany({
      where: { organizerId: ORGANIZER_ID },
      select: { id: true },
    }),
    tx.primaryEventCancellation.findMany({
      where: { organizerId: ORGANIZER_ID },
      select: { id: true },
    }),
    tx.primaryRefundObligation.findMany({
      where: { organizerId: ORGANIZER_ID },
      select: { id: true },
    }),
  ]);
  const opaqueWorkflowAggregateIds = [
    ...refunds.map((refund) => refund.id),
    ...cancellations.map((cancellation) => cancellation.id),
    ...obligations.map((obligation) => obligation.id),
  ];
  const outboxCount = await tx.primaryOutboxMessage.count({
    where: {
      OR: [
        { organizerId: ORGANIZER_ID },
        { aggregateId: ORGANIZER_ID },
        { aggregateId: { startsWith: EVENT_PREFIX } },
        { aggregateId: { in: opaqueWorkflowAggregateIds } },
      ],
    },
  });
  if (outboxCount !== 0) {
    throw new PrimaryStagingRefundError("STAGING_REFUND_DELIVERY_INTENT_INVALID");
  }
}

async function audit(tx: Tx, actor: Actor, eventId: string, action: string, targetType: string, targetId: string, reason: string, after?: Record<string, unknown>) {
  await tx.primaryAuditEvent.create({
    data: {
      organizerId: ORGANIZER_ID,
      eventId,
      actorUserId: actor.id,
      actorType: "USER",
      action,
      targetType,
      targetId,
      afterJson: after as Prisma.InputJsonObject | undefined,
      reason,
      requestId: `staging-refund:${digest([action, targetId, Date.now()]).slice(0, 24)}`,
    },
  });
}

type AuditExpectation = {
  action: string;
  actorUserId: string;
  targetType: string;
  targetId: string;
  reason: string;
  after: Record<string, unknown>;
};

function exactJsonRecord(value: Prisma.JsonValue | null, expected: Record<string, unknown>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = Object.keys(expected).sort();
  return JSON.stringify(actualKeys) === JSON.stringify(expectedKeys)
    && expectedKeys.every((key) => record[key] === expected[key]);
}

async function requireWorkflowAuditEvidence(tx: Tx, eventId: string, expectations: AuditExpectation[]) {
  const actions = expectations.map((expectation) => expectation.action);
  const rows = await tx.primaryAuditEvent.findMany({
    where: { organizerId: ORGANIZER_ID, eventId, action: { in: actions } },
    select: {
      actorUserId: true,
      actorType: true,
      action: true,
      targetType: true,
      targetId: true,
      beforeJson: true,
      afterJson: true,
      reason: true,
      requestId: true,
      ipHash: true,
      createdAt: true,
    },
  });
  if (
    rows.length !== expectations.length
    || expectations.some((expected) => {
      const matches = rows.filter((row) => row.action === expected.action);
      const row = matches[0];
      return matches.length !== 1
        || row.actorUserId !== expected.actorUserId
        || row.actorType !== "USER"
        || row.targetType !== expected.targetType
        || row.targetId !== expected.targetId
        || row.beforeJson !== null
        || !exactJsonRecord(row.afterJson, expected.after)
        || row.reason !== expected.reason
        || !/^staging-refund:[0-9a-f]{24}$/.test(row.requestId ?? "")
        || row.ipHash !== null
        || !(row.createdAt instanceof Date);
    })
  ) {
    throw new PrimaryStagingRefundError("STAGING_REFUND_AUDIT_EVIDENCE_INVALID");
  }
}

async function seedOrder(tx: Tx, generation: number, kind: ScenarioKind, buyerId: string, adminId: string) {
  const scope = ids(generation, kind);
  const quantity = kind === "cancellation" ? 2 : 1;
  const unitPrice = kind === "ordinary" ? 2500 : kind === "checked" ? 3000 : 2000;
  const fee = kind === "ordinary" ? 100 : kind === "checked" ? 120 : 200;
  const gross = unitPrice * quantity + fee;
  const now = new Date();
  const title = scenarioTitle(kind);

  await tx.primaryEvent.create({ data: {
    id: scope.eventId, organizerId: ORGANIZER_ID, title: `Synthetic Refund Console / ${title}`,
    description: `Deterministic isolated staging scenario generation ${generation}.`, category: "SYNTHETIC",
    venueName: "Synthetic Refund Hall", venueAddressLine1: "1 Synthetic Way", venueCity: "Toronto", venueRegion: "ON",
    venuePostalCode: "M5V 0A1", venueCountry: "CA", startsAtLocal: new Date("2038-06-15T19:00:00Z"),
    endsAtLocal: new Date("2038-06-15T22:00:00Z"), timezone: "America/Toronto",
    contactEmail: "refunds@primary-staging.example.invalid", contactPhone: "+15550001003",
    draftPolicyText: "Synthetic staging-only refund policy evidence.", totalCapacity: quantity, status: "APPROVED",
    submittedAt: now, approvedAt: now, approvedByUserId: adminId,
  } });
  await tx.primaryTicketType.create({ data: {
    id: scope.ticketTypeId, organizerId: ORGANIZER_ID, eventId: scope.eventId, name: "Synthetic GA",
    description: "No live inventory or money.", allocatedQuantity: quantity, minimumPerOrder: 1, maximumPerOrder: quantity,
    currency: "CAD", basePriceMinor: unitPrice,
  } });
  await tx.primaryInventoryReservation.create({ data: {
    id: scope.reservationId, organizerId: ORGANIZER_ID, eventId: scope.eventId, ticketTypeId: scope.ticketTypeId,
    buyerUserId: buyerId, quantity, status: "PAYMENT_COMMITTED", expiresAt: new Date("2038-06-15T18:00:00Z"),
    paymentCommittedAt: now, reconciliationAfter: new Date(now.getTime() + 120_000), createIdempotencyKey: `${scope.base}:reservation`,
    commitIdempotencyKey: `${scope.base}:commit`,
  } });
  await tx.primaryOrder.create({ data: {
    id: scope.orderId, organizerId: ORGANIZER_ID, eventId: scope.eventId, buyerUserId: buyerId,
    reservationId: scope.reservationId, status: "PAID", currency: "CAD", faceValueSubtotalMinor: unitPrice * quantity,
    grossTotalMinor: gross, createIdempotencyKey: `${scope.base}:order`, prepareIdempotencyKey: `${scope.base}:prepare`,
    prepareReconciliationDelayMs: 120000, paymentProcessingAt: now, paidAt: now,
  } });
  await tx.primaryOrderLine.create({ data: {
    id: scope.lineId, orderId: scope.orderId, ticketTypeId: scope.ticketTypeId, reservationId: scope.reservationId,
    quantity, ticketTypeNameSnapshot: "Synthetic GA", unitFaceValueMinor: unitPrice,
    faceValueSubtotalMinor: unitPrice * quantity, currency: "CAD",
  } });
  await tx.primaryOrderPriceComponent.createMany({ data: [
    { id: `${scope.base}-face`, orderId: scope.orderId, orderLineId: scope.lineId, code: "FACE_VALUE", label: "Face value", kind: "FACE_VALUE", amountMinor: unitPrice * quantity, currency: "CAD", allocationBaseMinor: unitPrice, allocationRemainderUnits: 0, position: 0 },
    { id: `${scope.base}-fee`, orderId: scope.orderId, orderLineId: scope.lineId, code: "ORGANIZER_FEE", label: "Synthetic organizer fee", kind: "MANDATORY_FEE", amountMinor: fee, currency: "CAD", allocationBaseMinor: Math.floor(fee / quantity), allocationRemainderUnits: fee % quantity, position: 1 },
  ] });
  await tx.primaryPaymentAttempt.create({ data: {
    id: scope.paymentId, organizerId: ORGANIZER_ID, eventId: scope.eventId, buyerUserId: buyerId,
    reservationId: scope.reservationId, orderId: scope.orderId, status: "SUCCEEDED", expectedAmountMinor: gross,
    currency: "CAD", createIdempotencyKey: `${scope.base}:payment`, providerIntentId: `synthetic_${scope.base}`,
    providerCreatedAt: now, terminalAt: now,
  } });

  for (let unit = 1; unit <= quantity; unit += 1) {
    const ticketId = `${scope.base}-ticket-${unit}`;
    const credentialId = `${scope.base}-credential-${unit}`;
    await tx.primaryAdmissionTicket.create({ data: {
      id: ticketId, organizerId: ORGANIZER_ID, eventId: scope.eventId, buyerUserId: buyerId,
      reservationId: scope.reservationId, orderId: scope.orderId, orderLineId: scope.lineId,
      ticketTypeId: scope.ticketTypeId, unitNumber: unit, issuanceIdempotencyKey: `${scope.base}:issue:${unit}`, issuedAt: now,
    } });
    await tx.primaryAdmissionCredential.create({ data: {
      id: credentialId, admissionTicketId: ticketId, eventId: scope.eventId, payloadVersion: 1,
      keyId: "synthetic-staging-only", payloadDigest: digest([scope.base, unit]), issuedAt: now,
    } });
    if (kind === "checked" || (kind === "cancellation" && unit === 2)) {
      await tx.primaryAdmissionTicket.update({ where: { id: ticketId }, data: { status: "CHECKED_IN" } });
      await tx.primaryAdmissionScan.create({ data: {
        id: `${scope.base}-scan-${unit}`, requestId: `${scope.base}:scan:${unit}`, commandDigest: digest([scope.base, "scan", unit]),
        organizerId: ORGANIZER_ID, eventId: scope.eventId, admissionTicketId: ticketId, credentialId,
        operatorUserId: adminId, result: "ACCEPTED", deviceId: "synthetic-console", scannedAt: now,
      } });
    }
  }
  await tx.$queryRawUnsafe(`SELECT materialize_primary_purchase_allocations($1)`, scope.orderId);
  return scope;
}

export async function reseedPrimaryStagingRefundScenario(db: Db, actor: Actor) {
  return db.$transaction(async (tx) => {
    await requireAdmin(tx, actor);
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746836291)");
    const organizerUser = await tx.user.findFirst({
      where: {
        email: STAGING_ORGANIZER_EMAIL,
        role: "USER",
        isBanned: false,
        emailVerifiedAt: { not: null },
        phoneVerifiedAt: { not: null },
      },
    });
    if (!organizerUser) throw new PrimaryStagingRefundError("STAGING_ORGANIZER_REQUIRED");
    const buyer = await tx.user.upsert({
      where: { email: BUYER_EMAIL },
      create: { email: BUYER_EMAIL, passwordHash: "synthetic-staging-no-login", emailVerifiedAt: new Date(), firstName: "Synthetic", lastName: "Refund Buyer", phone: BUYER_PHONE, phoneVerifiedAt: new Date(), streetAddress1: "1 Synthetic Way", city: "Toronto", region: "ON", postalCode: "M5V 0A1", country: "CA", canBuy: false, canSell: false, canComment: false },
      update: {
        passwordHash: "synthetic-staging-no-login",
        emailVerifiedAt: new Date(),
        firstName: "Synthetic",
        lastName: "Refund Buyer",
        phone: BUYER_PHONE,
        phoneVerifiedAt: new Date(),
        streetAddress1: "1 Synthetic Way",
        streetAddress2: null,
        city: "Toronto",
        region: "ON",
        postalCode: "M5V 0A1",
        country: "CA",
        role: "USER",
        isBanned: false,
        banReason: null,
        canBuy: false,
        canSell: false,
        canComment: false,
      },
    });
    await tx.primaryOrganizer.upsert({
      where: { id: ORGANIZER_ID },
      create: { id: ORGANIZER_ID, legalName: "Synthetic Refund Operations Inc.", displayName: "Synthetic Refund Operations", addressLine1: "1 Synthetic Way", city: "Toronto", region: "ON", postalCode: "M5V 0A1", country: "CA", supportEmail: "refunds@primary-staging.example.invalid", supportPhone: "+15550001003", status: "APPROVED", submittedAt: new Date(), approvedAt: new Date(), approvedByUserId: actor.id, createdByUserId: organizerUser.id },
      update: {
        legalName: "Synthetic Refund Operations Inc.",
        displayName: "Synthetic Refund Operations",
        businessNumberEncrypted: null,
        addressLine1: "1 Synthetic Way",
        addressLine2: null,
        city: "Toronto",
        region: "ON",
        postalCode: "M5V 0A1",
        country: "CA",
        supportEmail: "refunds@primary-staging.example.invalid",
        supportPhone: "+15550001003",
        website: null,
        status: "APPROVED",
        statusReason: null,
        paymentProvider: null,
        paymentAccountRefEncrypted: null,
        paymentStatus: "NOT_STARTED",
        submittedAt: new Date(),
        approvedAt: new Date(),
        approvedByUserId: actor.id,
        createdByUserId: organizerUser.id,
      },
    });
    await tx.primaryOrganizerMembership.upsert({
      where: { organizerId_userId: { organizerId: ORGANIZER_ID, userId: organizerUser.id } },
      create: { organizerId: ORGANIZER_ID, userId: organizerUser.id, role: "OWNER", status: "ACTIVE", acceptedAt: new Date(), invitedByUserId: organizerUser.id },
      update: { role: "OWNER", status: "ACTIVE", acceptedAt: new Date(), revokedAt: null, invitedByUserId: organizerUser.id },
    });
    await requireSyntheticTenantAccessProvenance(tx);
    await requireSyntheticNoDeliveryIntent(tx);
    const rows = await tx.$queryRawUnsafe<Array<{ generation: number }>>(`SELECT COALESCE(MAX((regexp_match(id, '^staging-refund-g([0-9]+)-ordinary-event$'))[1]::int),0)::int AS generation FROM "PrimaryEvent" WHERE "organizerId"=$1`, ORGANIZER_ID);
    const generation = Number(rows[0]?.generation ?? 0) + 1;
    const ordinary = await seedOrder(tx, generation, "ordinary", buyer.id, actor.id);
    await seedOrder(tx, generation, "checked", buyer.id, actor.id);
    await seedOrder(tx, generation, "cancellation", buyer.id, actor.id);
    await audit(tx, actor, ordinary.eventId, "STAGING_REFUND_SCENARIO_RESEEDED", "PrimaryEvent", ordinary.eventId, "Fresh deterministic synthetic scenarios created; prior immutable evidence retained.", { generation });
    return { generation };
  });
}

async function latestGeneration(tx: Tx) {
  const rows = await tx.$queryRawUnsafe<Array<{ generation: number }>>(`SELECT COALESCE(MAX((regexp_match(id, '^staging-refund-g([0-9]+)-ordinary-event$'))[1]::int),0)::int AS generation FROM "PrimaryEvent" WHERE "organizerId"=$1`, ORGANIZER_ID);
  const generation = Number(rows[0]?.generation ?? 0);
  if (!generation) throw new PrimaryStagingRefundError("STAGING_REFUND_SCENARIO_REQUIRED");
  return generation;
}

async function requireScenarioTicketStates(
  tx: Tx,
  scope: ReturnType<typeof ids>,
  expected: Array<{ unit: number; status: "ISSUED" | "CHECKED_IN" }>,
  code: string,
) {
  const admin = await tx.user.findUnique({
    where: { email: STAGING_ADMIN_EMAIL },
    select: { id: true },
  });
  const tickets = await tx.primaryAdmissionTicket.findMany({
    where: { organizerId: ORGANIZER_ID, eventId: scope.eventId, orderId: scope.orderId },
    select: {
      id: true,
      organizerId: true,
      eventId: true,
      reservationId: true,
      orderId: true,
      orderLineId: true,
      ticketTypeId: true,
      unitNumber: true,
      issuanceIdempotencyKey: true,
      status: true,
      issuedAt: true,
      voidedAt: true,
      voidReason: true,
      credential: {
        select: {
          id: true,
          admissionTicketId: true,
          eventId: true,
          payloadVersion: true,
          keyId: true,
          payloadDigest: true,
          issuedAt: true,
        },
      },
      scans: {
        where: { result: { in: ["ACCEPTED", "DUPLICATE"] } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          requestId: true,
          commandDigest: true,
          organizerId: true,
          eventId: true,
          admissionTicketId: true,
          credentialId: true,
          operatorUserId: true,
          result: true,
          deviceId: true,
          scannedAt: true,
        },
      },
    },
  });
  if (
    !admin ||
    tickets.length !== expected.length ||
    expected.some(({ unit, status }) => {
      const ticket = tickets.find((candidate) => candidate.unitNumber === unit);
      const ticketId = `${scope.base}-ticket-${unit}`;
      const credentialId = `${scope.base}-credential-${unit}`;
      const scan = ticket?.scans[0];
      const expectsAcceptedScan = status === "CHECKED_IN";
      return ticket?.id !== ticketId
        || ticket.organizerId !== ORGANIZER_ID
        || ticket.eventId !== scope.eventId
        || ticket.reservationId !== scope.reservationId
        || ticket.orderId !== scope.orderId
        || ticket.orderLineId !== scope.lineId
        || ticket.ticketTypeId !== scope.ticketTypeId
        || ticket.issuanceIdempotencyKey !== `${scope.base}:issue:${unit}`
        || ticket.status !== status
        || ticket.voidedAt !== null
        || ticket.voidReason !== null
        || ticket.credential?.id !== credentialId
        || ticket.credential.admissionTicketId !== ticketId
        || ticket.credential.eventId !== scope.eventId
        || ticket.credential.payloadVersion !== 1
        || ticket.credential.keyId !== "synthetic-staging-only"
        || ticket.credential.payloadDigest !== digest([scope.base, unit])
        || ticket.credential.issuedAt.getTime() !== ticket.issuedAt.getTime()
        || ticket.scans.length !== (expectsAcceptedScan ? 1 : 0)
        || (expectsAcceptedScan && (
          scan?.id !== `${scope.base}-scan-${unit}`
          || scan.requestId !== `${scope.base}:scan:${unit}`
          || scan.commandDigest !== digest([scope.base, "scan", unit])
          || scan.organizerId !== ORGANIZER_ID
          || scan.eventId !== scope.eventId
          || scan.admissionTicketId !== ticketId
          || scan.credentialId !== credentialId
          || scan.operatorUserId !== admin.id
          || scan.result !== "ACCEPTED"
          || scan.deviceId !== "synthetic-console"
          || scan.scannedAt.getTime() !== ticket.issuedAt.getTime()
        ));
    })
  ) {
    throw new PrimaryStagingRefundError(code);
  }
}

async function requireScenarioPurchaseState(tx: Tx, scope: ReturnType<typeof ids>) {
  await requireSyntheticTenantAccessProvenance(tx);
  await requireSyntheticNoDeliveryIntent(tx);
  const expected = scenarioFinancials(scope.kind);
  const [buyer, organizerUser, admin, membership, organizer, event, ticketType, reservation, order, line, payment, components, allocations] = await Promise.all([
    tx.user.findFirst({
      where: {
        email: BUYER_EMAIL,
        passwordHash: "synthetic-staging-no-login",
        firstName: "Synthetic",
        lastName: "Refund Buyer",
        phone: BUYER_PHONE,
        streetAddress1: "1 Synthetic Way",
        streetAddress2: null,
        city: "Toronto",
        region: "ON",
        postalCode: "M5V 0A1",
        country: "CA",
        role: "USER",
        isBanned: false,
        banReason: null,
        emailVerifiedAt: { not: null },
        phoneVerifiedAt: { not: null },
        canBuy: false,
        canSell: false,
        canComment: false,
      },
      select: { id: true },
    }),
    tx.user.findFirst({
      where: {
        email: STAGING_ORGANIZER_EMAIL,
        role: "USER",
        isBanned: false,
        emailVerifiedAt: { not: null },
        phoneVerifiedAt: { not: null },
      },
      select: { id: true },
    }),
    tx.user.findFirst({
      where: {
        email: STAGING_ADMIN_EMAIL,
        role: "ADMIN",
        isBanned: false,
        emailVerifiedAt: { not: null },
        phoneVerifiedAt: { not: null },
      },
      select: { id: true },
    }),
    tx.primaryOrganizerMembership.findFirst({
      where: {
        organizerId: ORGANIZER_ID,
        role: "OWNER",
        status: "ACTIVE",
        acceptedAt: { not: null },
        revokedAt: null,
        user: {
          is: {
            email: STAGING_ORGANIZER_EMAIL,
            role: "USER",
            isBanned: false,
            emailVerifiedAt: { not: null },
            phoneVerifiedAt: { not: null },
          },
        },
        invitedBy: { is: { email: STAGING_ORGANIZER_EMAIL } },
      },
      select: { userId: true, invitedByUserId: true },
    }),
    tx.primaryOrganizer.findFirst({
      where: {
        id: ORGANIZER_ID,
        legalName: "Synthetic Refund Operations Inc.",
        displayName: "Synthetic Refund Operations",
        businessNumberEncrypted: null,
        addressLine1: "1 Synthetic Way",
        addressLine2: null,
        city: "Toronto",
        region: "ON",
        postalCode: "M5V 0A1",
        country: "CA",
        supportEmail: "refunds@primary-staging.example.invalid",
        supportPhone: "+15550001003",
        website: null,
        status: "APPROVED",
        statusReason: null,
        paymentProvider: null,
        paymentAccountRefEncrypted: null,
        paymentStatus: "NOT_STARTED",
        submittedAt: { not: null },
        approvedAt: { not: null },
        createdBy: { is: { email: STAGING_ORGANIZER_EMAIL } },
        approvedBy: { is: { email: STAGING_ADMIN_EMAIL } },
      },
      select: { id: true, createdByUserId: true, approvedByUserId: true },
    }),
    tx.primaryEvent.findFirst({
      where: {
        id: scope.eventId,
        organizerId: ORGANIZER_ID,
        status: "APPROVED",
        title: `Synthetic Refund Console / ${scenarioTitle(scope.kind)}`,
        description: `Deterministic isolated staging scenario generation ${scope.generation}.`,
        category: "SYNTHETIC",
        venueName: "Synthetic Refund Hall",
        venueAddressLine1: "1 Synthetic Way",
        venueAddressLine2: null,
        venueCity: "Toronto",
        venueRegion: "ON",
        venuePostalCode: "M5V 0A1",
        venueCountry: "CA",
        startsAtLocal: new Date("2038-06-15T19:00:00Z"),
        endsAtLocal: new Date("2038-06-15T22:00:00Z"),
        timezone: "America/Toronto",
        accessibilityInfo: null,
        contactEmail: "refunds@primary-staging.example.invalid",
        contactPhone: "+15550001003",
        draftPolicyText: "Synthetic staging-only refund policy evidence.",
        totalCapacity: expected.quantity,
        statusReason: null,
        submittedAt: { not: null },
        approvedAt: { not: null },
        approvedBy: { is: { email: STAGING_ADMIN_EMAIL } },
      },
      select: { id: true, submittedAt: true, approvedAt: true, approvedByUserId: true },
    }),
    tx.primaryTicketType.findFirst({
      where: {
        id: scope.ticketTypeId,
        organizerId: ORGANIZER_ID,
        eventId: scope.eventId,
        status: "ACTIVE",
        name: "Synthetic GA",
        description: "No live inventory or money.",
        allocatedQuantity: expected.quantity,
        minimumPerOrder: 1,
        maximumPerOrder: expected.quantity,
        currency: "CAD",
        basePriceMinor: expected.unitFaceValueMinor,
      },
      select: { id: true },
    }),
    tx.primaryInventoryReservation.findFirst({
      where: {
        id: scope.reservationId,
        organizerId: ORGANIZER_ID,
        eventId: scope.eventId,
        ticketTypeId: scope.ticketTypeId,
        quantity: expected.quantity,
        status: "PAYMENT_COMMITTED",
        paymentCommittedAt: { not: null },
        createIdempotencyKey: `${scope.base}:reservation`,
        commitIdempotencyKey: `${scope.base}:commit`,
      },
      select: {
        id: true,
        buyerUserId: true,
        expiresAt: true,
        paymentCommittedAt: true,
        reconciliationAfter: true,
        releasedAt: true,
        expiredAt: true,
      },
    }),
    tx.primaryOrder.findFirst({
      where: {
        id: scope.orderId,
        organizerId: ORGANIZER_ID,
        eventId: scope.eventId,
        reservationId: scope.reservationId,
        status: "PAID",
        currency: "CAD",
        faceValueSubtotalMinor: expected.faceValueSubtotalMinor,
        grossTotalMinor: expected.grossTotalMinor,
        createIdempotencyKey: `${scope.base}:order`,
        prepareIdempotencyKey: `${scope.base}:prepare`,
        prepareReconciliationDelayMs: 120000,
        paidAt: { not: null },
      },
      select: {
        id: true,
        buyerUserId: true,
        paymentProcessingAt: true,
        paidAt: true,
        paymentFailedAt: true,
      },
    }),
    tx.primaryOrderLine.findFirst({
      where: {
        id: scope.lineId,
        orderId: scope.orderId,
        ticketTypeId: scope.ticketTypeId,
        reservationId: scope.reservationId,
        quantity: expected.quantity,
        ticketTypeNameSnapshot: "Synthetic GA",
        unitFaceValueMinor: expected.unitFaceValueMinor,
        faceValueSubtotalMinor: expected.faceValueSubtotalMinor,
        currency: "CAD",
      },
      select: { id: true },
    }),
    tx.primaryPaymentAttempt.findFirst({
      where: {
        id: scope.paymentId,
        organizerId: ORGANIZER_ID,
        eventId: scope.eventId,
        reservationId: scope.reservationId,
        orderId: scope.orderId,
        status: "SUCCEEDED",
        expectedAmountMinor: expected.grossTotalMinor,
        currency: "CAD",
        createIdempotencyKey: `${scope.base}:payment`,
        providerIntentId: `synthetic_${scope.base}`,
        providerCreatedAt: { not: null },
        terminalAt: { not: null },
      },
      select: {
        id: true,
        buyerUserId: true,
        providerCreatedAt: true,
        terminalAt: true,
        _count: { select: { providerEvents: true, exceptions: true } },
      },
    }),
    tx.primaryOrderPriceComponent.findMany({
      where: { orderId: scope.orderId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        orderLineId: true,
        code: true,
        label: true,
        kind: true,
        amountMinor: true,
        currency: true,
        allocationBaseMinor: true,
        allocationRemainderUnits: true,
        position: true,
      },
    }),
    tx.primaryPurchaseAllocation.findMany({
      where: { orderId: scope.orderId },
      select: {
        admissionTicketId: true,
        amountMinor: true,
        currency: true,
        refundable: true,
        liabilityOwner: true,
        remainderRank: true,
        algorithmVersion: true,
        policyVersionId: true,
        allocationSetDigest: true,
        component: { select: { id: true, code: true } },
      },
    }),
  ]);

  const expectedComponents = [
    {
      id: `${scope.base}-face`,
      orderLineId: scope.lineId,
      code: "FACE_VALUE",
      label: "Face value",
      kind: "FACE_VALUE",
      amountMinor: expected.faceValueSubtotalMinor,
      currency: "CAD",
      allocationBaseMinor: expected.unitFaceValueMinor,
      allocationRemainderUnits: 0,
      position: 0,
    },
    {
      id: `${scope.base}-fee`,
      orderLineId: scope.lineId,
      code: "ORGANIZER_FEE",
      label: "Synthetic organizer fee",
      kind: "MANDATORY_FEE",
      amountMinor: expected.feeMinor,
      currency: "CAD",
      allocationBaseMinor: Math.floor(expected.feeMinor / expected.quantity),
      allocationRemainderUnits: expected.feeMinor % expected.quantity,
      position: 1,
    },
  ];
  const allocationDigestFor = (code: string) => textDigest(Array.from(
    { length: expected.quantity },
    (_, index) => {
      const unit = index + 1;
      const amount = code === "FACE_VALUE"
        ? expected.unitFaceValueMinor
        : Math.floor(expected.feeMinor / expected.quantity) + (unit <= expected.feeMinor % expected.quantity ? 1 : 0);
      return `${scope.base}-ticket-${unit}:${amount}`;
    },
  ).join(","));
  const allocationsAreExact = allocations.length === expected.quantity * expectedComponents.length
    && allocations.every((allocation) => {
      const unit = Number(allocation.admissionTicketId.slice(`${scope.base}-ticket-`.length));
      const component = expectedComponents.find((candidate) => candidate.code === allocation.component.code);
      const expectedAmount = component?.code === "FACE_VALUE"
        ? expected.unitFaceValueMinor
        : component?.code === "ORGANIZER_FEE"
          ? Math.floor(expected.feeMinor / expected.quantity) + (unit <= expected.feeMinor % expected.quantity ? 1 : 0)
          : undefined;
      return Number.isInteger(unit)
        && unit >= 1
        && unit <= expected.quantity
        && allocation.admissionTicketId === `${scope.base}-ticket-${unit}`
        && allocation.component.id === component?.id
        && allocation.amountMinor === expectedAmount
        && allocation.currency === "CAD"
        && allocation.refundable
        && allocation.liabilityOwner === "ORGANIZER"
        && allocation.remainderRank === unit
        && allocation.algorithmVersion === 1
        && allocation.policyVersionId === POLICY_ID
        && allocation.allocationSetDigest === allocationDigestFor(allocation.component.code);
    });
  const anchor = order?.paidAt;
  const timelineIsExact = Boolean(
    anchor
    && event?.submittedAt?.getTime() === anchor.getTime()
    && event.approvedAt?.getTime() === anchor.getTime()
    && reservation?.expiresAt.getTime() === new Date("2038-06-15T18:00:00Z").getTime()
    && reservation.paymentCommittedAt?.getTime() === anchor.getTime()
    && reservation.reconciliationAfter?.getTime() === anchor.getTime() + 120_000
    && reservation.releasedAt === null
    && reservation.expiredAt === null
    && order?.paymentProcessingAt?.getTime() === anchor.getTime()
    && order.paymentFailedAt === null
    && payment?.providerCreatedAt?.getTime() === anchor.getTime()
    && payment.terminalAt?.getTime() === anchor.getTime()
  );

  if (
    !buyer || !organizerUser || !admin || !membership || !organizer || !event || !ticketType || !reservation || !order || !line || !payment
    || membership.userId !== organizerUser.id
    || membership.invitedByUserId !== organizerUser.id
    || organizer.createdByUserId !== organizerUser.id
    || organizer.approvedByUserId !== admin.id
    || event.approvedByUserId !== admin.id
    || reservation.buyerUserId !== buyer.id
    || order.buyerUserId !== buyer.id
    || payment.buyerUserId !== buyer.id
    || payment._count.providerEvents !== 0
    || payment._count.exceptions !== 0
    || JSON.stringify(components) !== JSON.stringify(expectedComponents)
    || !allocationsAreExact
    || !timelineIsExact
  ) {
    throw new PrimaryStagingRefundError("STAGING_REFUND_PURCHASE_STATE_INVALID");
  }
}

async function requireRefundCommandEvidence(
  tx: Tx,
  scope: ReturnType<typeof ids>,
  suffix: string,
  ticketIds: string[],
) {
  const [organizerUser, refund, allocations] = await Promise.all([
    tx.user.findUnique({ where: { email: STAGING_ORGANIZER_EMAIL }, select: { id: true } }),
    tx.primaryRefund.findUnique({
      where: { requestKey: `${scope.base}:refund:${suffix}` },
      include: {
        checkedInApprovals: {
          select: {
            id: true,
            admissionTicketId: true,
            approvedByUserId: true,
            evidenceDigest: true,
            reason: true,
            fraudReview: true,
            costBearer: true,
          },
        },
        items: {
          orderBy: { admissionTicketId: "asc" },
          select: {
            id: true,
            admissionTicketId: true,
            requestedMinor: true,
            currency: true,
            allocations: {
              orderBy: { purchaseAllocationId: "asc" },
              select: {
                refundId: true,
                admissionTicketId: true,
                purchaseAllocationId: true,
                amountMinor: true,
                currency: true,
              },
            },
          },
        },
        attempts: {
          orderBy: { ordinal: "asc" },
          select: {
            id: true,
            ordinal: true,
            status: true,
            providerKey: true,
            expectedAmountMinor: true,
            currency: true,
            providerRefundId: true,
            authorizationKey: true,
            authorizationDigest: true,
            authorizedByUserId: true,
            authorizationReason: true,
            terminalEvidenceHash: true,
            providerEvents: {
              orderBy: { providerCreatedAt: "asc" },
              select: {
                providerEventId: true,
                payloadDigest: true,
                eventType: true,
                providerCreatedAt: true,
              },
            },
          },
        },
        revocations: {
          orderBy: { admissionTicketId: "asc" },
          select: {
            organizerId: true,
            eventId: true,
            admissionTicketId: true,
            credentialId: true,
            refundId: true,
            cancellationId: true,
            policyVersionId: true,
            actorUserId: true,
            cause: true,
            reason: true,
            idempotencyKey: true,
            effectiveAt: true,
          },
        },
      },
    }),
    tx.primaryPurchaseAllocation.findMany({
      where: { admissionTicketId: { in: ticketIds }, refundable: true },
      orderBy: [{ admissionTicketId: "asc" }, { id: "asc" }],
      select: { id: true, admissionTicketId: true, amountMinor: true, currency: true },
    }),
  ]);
  const requestedAmountMinor = allocations.reduce((sum, item) => sum + item.amountMinor, 0);
  const refundItemsAreExact = refund?.items.length === 0 || (
    refund?.items.length === ticketIds.length
    && refund.items.every((item) => {
      const expectedAllocations = allocations.filter((allocation) => allocation.admissionTicketId === item.admissionTicketId);
      return ticketIds.includes(item.admissionTicketId)
        && item.requestedMinor === expectedAllocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0)
        && item.currency === "CAD"
        && item.allocations.length === expectedAllocations.length
        && item.allocations.every((allocation, index) => {
          const expected = expectedAllocations[index];
          return allocation.refundId === refund.id
            && allocation.admissionTicketId === item.admissionTicketId
            && allocation.purchaseAllocationId === expected?.id
            && allocation.amountMinor === expected?.amountMinor
            && allocation.currency === expected?.currency;
        });
    })
  );
  if (
    !organizerUser
    || !refund
    || refund.organizerId !== ORGANIZER_ID
    || refund.eventId !== scope.eventId
    || refund.orderId !== scope.orderId
    || refund.paymentAttemptId !== scope.paymentId
    || refund.requestedByUserId !== organizerUser.id
    || refund.policyVersionId !== POLICY_ID
    || refund.commandDigest !== digest([scope.base, suffix, ticketIds])
    || refund.reason !== `Synthetic ${suffix} refund; no provider or money movement.`
    || refund.requestedAmountMinor !== requestedAmountMinor
    || refund.currency !== "CAD"
    || refund.finalityReason !== null
    || !refundItemsAreExact
  ) {
    throw new PrimaryStagingRefundError("STAGING_REFUND_COMMAND_EVIDENCE_INVALID");
  }
  return refund;
}

async function requireCheckedRefundApprovalEvidence(
  tx: Tx,
  scope: ReturnType<typeof ids>,
  refund: Awaited<ReturnType<typeof requireRefundCommandEvidence>>,
) {
  const admin = await tx.user.findUnique({ where: { email: STAGING_ADMIN_EMAIL }, select: { id: true } });
  const approval = refund.checkedInApprovals[0];
  if (
    !admin
    || refund.checkedInApprovals.length !== 1
    || approval.admissionTicketId !== `${scope.base}-ticket-1`
    || approval.approvedByUserId !== admin.id
    || !/^[0-9a-f]{64}$/.test(approval.evidenceDigest)
    || !approval.reason.trim()
    || !approval.fraudReview.trim()
    || !["ORGANIZER", "TRUEFANTIX"].includes(approval.costBearer)
    || refund.items.length !== 1
  ) {
    throw new PrimaryStagingRefundError("STAGING_REFUND_APPROVAL_EVIDENCE_INVALID");
  }
}

async function requireOrdinaryRefundAuditEvidence(
  tx: Tx,
  scope: ReturnType<typeof ids>,
  refund: Awaited<ReturnType<typeof requireRefundCommandEvidence>>,
) {
  const organizerUser = await tx.user.findUnique({
    where: { email: STAGING_ORGANIZER_EMAIL },
    select: { id: true },
  });
  if (!organizerUser) throw new PrimaryStagingRefundError("STAGING_REFUND_AUDIT_EVIDENCE_INVALID");
  await requireWorkflowAuditEvidence(tx, scope.eventId, [{
    action: "STAGING_ORDINARY_REFUND_COMPLETED",
    actorUserId: organizerUser.id,
    targetType: "PrimaryRefund",
    targetId: refund.id,
    reason: "Ordinary unscanned synthetic refund completed.",
    after: { status: "SUCCEEDED", requestedAmountMinor: refund.requestedAmountMinor, currency: refund.currency },
  }]);
}

async function requireCheckedRefundAuditEvidence(
  tx: Tx,
  scope: ReturnType<typeof ids>,
  refund: Awaited<ReturnType<typeof requireRefundCommandEvidence>>,
  phase: "requested" | "approved" | "completed",
) {
  const [organizerUser, admin] = await Promise.all([
    tx.user.findUnique({ where: { email: STAGING_ORGANIZER_EMAIL }, select: { id: true } }),
    tx.user.findUnique({ where: { email: STAGING_ADMIN_EMAIL }, select: { id: true } }),
  ]);
  const approval = refund.checkedInApprovals[0];
  if (!organizerUser || !admin || (phase !== "requested" && !approval)) {
    throw new PrimaryStagingRefundError("STAGING_REFUND_AUDIT_EVIDENCE_INVALID");
  }
  const expectations: AuditExpectation[] = [{
    action: "STAGING_CHECKED_REFUND_REQUESTED",
    actorUserId: organizerUser.id,
    targetType: "PrimaryRefund",
    targetId: refund.id,
    reason: "Checked-in refund awaits scoped supervisor evidence.",
    after: { status: "REQUESTED" },
  }];
  if (phase !== "requested") expectations.push({
    action: "STAGING_CHECKED_REFUND_APPROVED",
    actorUserId: admin.id,
    targetType: "PrimaryRefund",
    targetId: refund.id,
    reason: approval.reason,
    after: { status: "REQUESTED", costBearer: approval.costBearer, fraudReview: approval.fraudReview },
  });
  if (phase === "completed") expectations.push({
    action: "STAGING_CHECKED_REFUND_COMPLETED",
    actorUserId: organizerUser.id,
    targetType: "PrimaryRefund",
    targetId: refund.id,
    reason: "Approved checked-in synthetic refund completed; admission remains checked in.",
    after: { status: "SUCCEEDED" },
  });
  await requireWorkflowAuditEvidence(tx, scope.eventId, expectations);
}

async function requireSyntheticRefundCompletionEvidence(
  tx: Tx,
  scope: ReturnType<typeof ids>,
  refund: Awaited<ReturnType<typeof requireRefundCommandEvidence>>,
  suffix: "ordinary" | "checked" | "cancellation",
  ticketId: string,
  cancellationId?: string,
) {
  const organizerUser = await tx.user.findUnique({
    where: { email: STAGING_ORGANIZER_EMAIL },
    select: { id: true },
  });
  const ticket = await tx.primaryAdmissionTicket.findUnique({
    where: { id: ticketId },
    select: { status: true, voidedAt: true, voidReason: true },
  });
  const key = `${scope.base}:${suffix}`;
  const attempt = refund.attempts[0];
  const providerEvent = attempt?.providerEvents[0];
  const revocation = refund.revocations[0];
  const cause = suffix === "cancellation" ? "EVENT_CANCELLATION" : "REFUND";
  const expectedStatus = suffix === "checked" ? "CHECKED_IN" : "VOIDED";
  if (
    !organizerUser
    || refund.status !== "SUCCEEDED"
    || refund.attempts.length !== 1
    || attempt.ordinal !== 1
    || attempt.status !== "SUCCEEDED"
    || attempt.providerKey !== `${key}:synthetic-provider-key`
    || attempt.expectedAmountMinor !== refund.requestedAmountMinor
    || attempt.currency !== refund.currency
    || attempt.providerRefundId !== `${key}:synthetic-refund`
    || attempt.authorizationKey !== `${key}:authorization`
    || attempt.authorizationDigest !== digest([key, "authorization"])
    || attempt.authorizedByUserId !== organizerUser.id
    || attempt.authorizationReason !== "Authorized isolated synthetic completion; no external dispatch."
    || attempt.terminalEvidenceHash !== null
    || attempt.providerEvents.length !== 1
    || providerEvent.providerEventId !== `${key}:synthetic-success-event`
    || providerEvent.payloadDigest !== digest([key, "success"])
    || providerEvent.eventType !== "synthetic.refund.succeeded"
    || !(providerEvent.providerCreatedAt instanceof Date)
    || refund.revocations.length !== 1
    || revocation.organizerId !== ORGANIZER_ID
    || revocation.eventId !== scope.eventId
    || revocation.admissionTicketId !== ticketId
    || revocation.credentialId !== `${scope.base}-credential-${ticketId.endsWith("-2") ? 2 : 1}`
    || revocation.refundId !== refund.id
    || revocation.cancellationId !== (cancellationId ?? null)
    || revocation.policyVersionId !== POLICY_ID
    || revocation.actorUserId !== organizerUser.id
    || revocation.cause !== cause
    || revocation.reason !== `Synthetic ${cause.toLowerCase()} evidence; no live credential use.`
    || revocation.idempotencyKey !== `${scope.base}:revoke:${cause}:${ticketId}`
    || !(revocation.effectiveAt instanceof Date)
    || !ticket
    || ticket.status !== expectedStatus
    || (expectedStatus === "VOIDED" && (
      ticket.voidedAt === null
      || ticket.voidReason !== `Synthetic ${cause.toLowerCase()} revocation.`
    ))
    || (expectedStatus === "CHECKED_IN" && (ticket.voidedAt !== null || ticket.voidReason !== null))
  ) {
    throw new PrimaryStagingRefundError("STAGING_REFUND_COMPLETION_EVIDENCE_INVALID");
  }
}

async function requireCancellationCommandEvidence(tx: Tx, scope: ReturnType<typeof ids>) {
  const organizerUser = await tx.user.findUnique({
    where: { email: STAGING_ORGANIZER_EMAIL },
    select: { id: true },
  });
  const cancellation = await tx.primaryEventCancellation.findUnique({
    where: { requestKey: `${scope.base}:cancellation` },
    include: {
      snapshotTickets: {
        orderBy: { admissionTicketId: "asc" },
        select: { admissionTicketId: true, policyVersionId: true, amountMinor: true, currency: true },
      },
    },
  });
  const expectedAmount = scenarioFinancials("cancellation").grossTotalMinor / 2;
  const expectedSnapshots = [1, 2].map((unit) => ({
    admissionTicketId: `${scope.base}-ticket-${unit}`,
    policyVersionId: POLICY_ID,
    amountMinor: expectedAmount,
    currency: "CAD",
  }));
  const resolved = cancellation?.status === "RESOLVED";
  if (
    !organizerUser
    || !cancellation
    || cancellation.status === "REQUESTED"
    || cancellation.organizerId !== ORGANIZER_ID
    || cancellation.eventId !== scope.eventId
    || cancellation.generation !== 1
    || cancellation.policyVersionId !== POLICY_ID
    || cancellation.requestedByUserId !== organizerUser.id
    || cancellation.commandDigest !== digest([scope.base, "cancellation"])
    || cancellation.reason !== "Synthetic full-event cancellation."
    || cancellation.snapshotMaxTicketId !== `${scope.base}-ticket-2`
    || cancellation.expectedTicketCount !== 2
    || cancellation.expectedAmountMinor !== expectedAmount * 2
    || cancellation.processedTicketCount !== (resolved ? 2 : 0)
    || cancellation.processedAmountMinor !== (resolved ? expectedAmount * 2 : 0)
    || cancellation.activatedAt === null
    || JSON.stringify(cancellation.snapshotTickets) !== JSON.stringify(expectedSnapshots)
  ) {
    throw new PrimaryStagingRefundError("STAGING_CANCELLATION_COMMAND_EVIDENCE_INVALID");
  }
  return cancellation;
}

async function requireCancellationPreparationEvidence(
  tx: Tx,
  scope: ReturnType<typeof ids>,
  cancellation: Awaited<ReturnType<typeof requireCancellationCommandEvidence>>,
  phase: "pending" | "resolved" = "pending",
) {
  const refundableTicket = `${scope.base}-ticket-1`;
  const expectedAmount = scenarioFinancials("cancellation").grossTotalMinor / 2;
  const refund = await requireRefundCommandEvidence(tx, scope, "cancellation", [refundableTicket]);
  const [admin, links, obligations] = await Promise.all([
    tx.user.findUnique({ where: { email: STAGING_ADMIN_EMAIL }, select: { id: true } }),
    tx.primaryCancellationRefundLink.findMany({
      where: { cancellationId: cancellation.id },
      select: { cancellationId: true, refundId: true },
    }),
    tx.primaryRefundObligation.findMany({
      where: { cancellationId: cancellation.id },
      orderBy: { idempotencyKey: "asc" },
      include: { waiverApproval: true },
    }),
  ]);
  const refundObligation = obligations.find((item) => item.idempotencyKey === `${scope.base}:obligation:refund`);
  const waiverObligation = obligations.find((item) => item.idempotencyKey === `${scope.base}:obligation:waiver`);
  const waiverApproval = waiverObligation?.waiverApproval;
  const waiverApprovalIsExact = waiverObligation?.status === "OPEN"
    ? waiverApproval === null
    : waiverObligation?.status === "WAIVED_WITH_APPROVAL"
      && admin
      && waiverApproval?.approvedByUserId === admin.id
      && /^[0-9a-f]{64}$/.test(waiverApproval.evidenceDigest)
      && Boolean(waiverApproval.reason.trim());
  if (
    (phase === "pending" ? !["REQUESTED", "PROVIDER_PENDING"].includes(refund.status) : refund.status !== "SUCCEEDED")
    || refund.attempts.length !== (phase === "resolved" ? 1 : 0)
    || refund.items.length !== 1
    || links.length !== 1
    || links[0].cancellationId !== cancellation.id
    || links[0].refundId !== refund.id
    || obligations.length !== 2
    || !refundObligation
    || refundObligation.organizerId !== ORGANIZER_ID
    || refundObligation.eventId !== scope.eventId
    || refundObligation.orderId !== scope.orderId
    || refundObligation.cancellationId !== cancellation.id
    || refundObligation.refundId !== refund.id
    || refundObligation.cause !== "EVENT_CANCELLATION"
    || refundObligation.amountMinor !== expectedAmount
    || refundObligation.currency !== "CAD"
    || refundObligation.reason !== "Synthetic cancellation refund obligation."
    || (phase === "pending" ? !["OPEN", "REFUND_LINKED"].includes(refundObligation.status) : refundObligation.status !== "SATISFIED")
    || refundObligation.waiverApproval !== null
    || !waiverObligation
    || waiverObligation.organizerId !== ORGANIZER_ID
    || waiverObligation.eventId !== scope.eventId
    || waiverObligation.orderId !== scope.orderId
    || waiverObligation.cancellationId !== cancellation.id
    || waiverObligation.refundId !== null
    || waiverObligation.cause !== "CHECKED_IN_CANCELLATION_WAIVER"
    || waiverObligation.amountMinor !== expectedAmount
    || waiverObligation.currency !== "CAD"
    || waiverObligation.reason !== "Synthetic checked-in cancellation waiver candidate."
    || !waiverApprovalIsExact
  ) {
    throw new PrimaryStagingRefundError("STAGING_CANCELLATION_PREPARATION_EVIDENCE_INVALID");
  }
  return { refund, refundObligation, waiverObligation };
}

async function requireCancellationAuditEvidence(
  tx: Tx,
  scope: ReturnType<typeof ids>,
  cancellation: {
    id: string;
    expectedTicketCount: number;
    expectedAmountMinor: number;
    processedTicketCount: number;
    processedAmountMinor: number;
  },
  phase: "active" | "prepared" | "waived" | "resolved",
  preparation?: Awaited<ReturnType<typeof requireCancellationPreparationEvidence>>,
) {
  const [organizerUser, admin] = await Promise.all([
    tx.user.findUnique({ where: { email: STAGING_ORGANIZER_EMAIL }, select: { id: true } }),
    tx.user.findUnique({ where: { email: STAGING_ADMIN_EMAIL }, select: { id: true } }),
  ]);
  if (!organizerUser || !admin) throw new PrimaryStagingRefundError("STAGING_REFUND_AUDIT_EVIDENCE_INVALID");
  const expectations: AuditExpectation[] = [{
    action: "STAGING_CANCELLATION_ACTIVATED",
    actorUserId: organizerUser.id,
    targetType: "PrimaryEventCancellation",
    targetId: cancellation.id,
    reason: "Authoritative ticket snapshot activated.",
    after: {
      status: "ACTIVE",
      expectedTicketCount: cancellation.expectedTicketCount,
      expectedAmountMinor: cancellation.expectedAmountMinor,
    },
  }];
  if (phase !== "active") expectations.push({
    action: "STAGING_CANCELLATION_PREPARED",
    actorUserId: organizerUser.id,
    targetType: "PrimaryEventCancellation",
    targetId: cancellation.id,
    reason: "Refund provenance and exact obligations recorded.",
    after: { status: "REFUNDING" },
  });
  if (phase === "waived" || phase === "resolved") {
    const waiver = preparation?.waiverObligation.waiverApproval;
    if (!waiver) throw new PrimaryStagingRefundError("STAGING_REFUND_AUDIT_EVIDENCE_INVALID");
    expectations.push({
      action: "STAGING_CANCELLATION_WAIVER_APPROVED",
      actorUserId: admin.id,
      targetType: "PrimaryRefundObligation",
      targetId: preparation!.waiverObligation.id,
      reason: waiver.reason,
      after: { status: "WAIVED_WITH_APPROVAL" },
    });
  }
  if (phase === "resolved") expectations.push({
    action: "STAGING_CANCELLATION_RESOLVED",
    actorUserId: organizerUser.id,
    targetType: "PrimaryEventCancellation",
    targetId: cancellation.id,
    reason: "Exact snapshot, refund, waiver, batch, revocation, and obligation evidence reconciled.",
    after: {
      status: "RESOLVED",
      processedTicketCount: cancellation.processedTicketCount,
      processedAmountMinor: cancellation.processedAmountMinor,
    },
  });
  await requireWorkflowAuditEvidence(tx, scope.eventId, expectations);
}

async function requireCancellationResolutionEvidence(
  tx: Tx,
  scope: ReturnType<typeof ids>,
  cancellation: Awaited<ReturnType<typeof requireCancellationCommandEvidence>>,
) {
  const refundableTicket = `${scope.base}-ticket-1`;
  const waivedTicket = `${scope.base}-ticket-2`;
  const expectedAmount = scenarioFinancials("cancellation").grossTotalMinor / 2;
  const { refund, refundObligation, waiverObligation } = await requireCancellationPreparationEvidence(
    tx,
    scope,
    cancellation,
    "resolved",
  );
  await requireSyntheticRefundCompletionEvidence(tx, scope, refund, "cancellation", refundableTicket, cancellation.id);
  const [batches, revocations] = await Promise.all([
    tx.primaryCancellationBatch.findMany({
      where: { cancellationId: cancellation.id },
      include: { tickets: { orderBy: { admissionTicketId: "asc" } } },
    }),
    tx.primaryAdmissionRevocation.findMany({
      where: { cancellationId: cancellation.id },
      orderBy: { admissionTicketId: "asc" },
    }),
  ]);
  const batch = batches[0];
  const claims = batch?.tickets ?? [];
  const refundRevocation = revocations[0];
  const waiverRevocation = revocations[1];
  if (
    cancellation.status !== "RESOLVED"
    || waiverObligation.status !== "WAIVED_WITH_APPROVAL"
    || batches.length !== 1
    || batch.batchKey !== `${scope.base}:batch:1`
    || batch.commandDigest !== digest([scope.base, "batch", 1])
    || batch.firstTicketId !== refundableTicket
    || batch.lastTicketId !== waivedTicket
    || batch.processedTicketCount !== 2
    || batch.processedAmountMinor !== expectedAmount * 2
    || claims.length !== 2
    || claims[0].cancellationId !== cancellation.id
    || claims[0].admissionTicketId !== refundableTicket
    || claims[0].refundItemId !== refund.items[0].id
    || claims[0].obligationId !== refundObligation.id
    || claims[0].amountMinor !== expectedAmount
    || claims[0].currency !== "CAD"
    || claims[1].cancellationId !== cancellation.id
    || claims[1].admissionTicketId !== waivedTicket
    || claims[1].refundItemId !== null
    || claims[1].obligationId !== waiverObligation.id
    || claims[1].amountMinor !== expectedAmount
    || claims[1].currency !== "CAD"
    || revocations.length !== 2
    || refundRevocation.admissionTicketId !== refundableTicket
    || refundRevocation.refundId !== refund.id
    || refundRevocation.cause !== "EVENT_CANCELLATION"
    || waiverRevocation.organizerId !== ORGANIZER_ID
    || waiverRevocation.eventId !== scope.eventId
    || waiverRevocation.admissionTicketId !== waivedTicket
    || waiverRevocation.credentialId !== `${scope.base}-credential-2`
    || waiverRevocation.refundId !== null
    || waiverRevocation.cancellationId !== cancellation.id
    || waiverRevocation.policyVersionId !== POLICY_ID
    || waiverRevocation.actorUserId !== refundRevocation.actorUserId
    || waiverRevocation.cause !== "EVENT_CANCELLATION"
    || waiverRevocation.reason !== "Synthetic event_cancellation evidence; no live credential use."
    || waiverRevocation.idempotencyKey !== `${scope.base}:revoke:EVENT_CANCELLATION:${waivedTicket}`
  ) {
    throw new PrimaryStagingRefundError("STAGING_CANCELLATION_RESOLUTION_EVIDENCE_INVALID");
  }
}

async function refundParent(tx: Tx, actor: Actor, scope: ReturnType<typeof ids>, suffix: string, ticketIds: string[]) {
  const existing = await tx.primaryRefund.findUnique({ where: { requestKey: `${scope.base}:refund:${suffix}` } });
  if (existing) return existing;
  const payment = await tx.primaryPaymentAttempt.findUniqueOrThrow({ where: { orderId: scope.orderId } });
  const allocations = await tx.primaryPurchaseAllocation.findMany({ where: { admissionTicketId: { in: ticketIds }, refundable: true } });
  const requestedAmountMinor = allocations.reduce((sum, item) => sum + item.amountMinor, 0);
  return tx.primaryRefund.create({ data: {
    organizerId: ORGANIZER_ID, eventId: scope.eventId, orderId: scope.orderId, paymentAttemptId: payment.id,
    requestedByUserId: actor.id, policyVersionId: POLICY_ID, requestKey: `${scope.base}:refund:${suffix}`,
    commandDigest: digest([scope.base, suffix, ticketIds]), reason: `Synthetic ${suffix} refund; no provider or money movement.`,
    requestedAmountMinor, currency: "CAD",
  } });
}

async function materializeRefundItems(tx: Tx, refundId: string, ticketIds: string[]) {
  for (const ticketId of ticketIds) {
    const allocations = await tx.primaryPurchaseAllocation.findMany({ where: { admissionTicketId: ticketId, refundable: true }, orderBy: { id: "asc" } });
    const amount = allocations.reduce((sum, item) => sum + item.amountMinor, 0);
    const item = await tx.primaryRefundItem.create({ data: { refundId, admissionTicketId: ticketId, requestedMinor: amount, currency: "CAD" } });
    for (const allocation of allocations) {
      await tx.primaryRefundAllocation.create({ data: { refundId, refundItemId: item.id, admissionTicketId: ticketId, purchaseAllocationId: allocation.id, amountMinor: allocation.amountMinor, currency: "CAD" } });
    }
  }
}

async function completeSyntheticRefund(tx: Tx, actor: Actor, refundId: string, key: string) {
  const refund = await tx.primaryRefund.update({ where: { id: refundId }, data: { status: "PROVIDER_PENDING" } });
  let attempt = await tx.primaryRefundProviderAttempt.create({ data: {
    refundId, ordinal: 1, providerKey: `${key}:synthetic-provider-key`, expectedAmountMinor: refund.requestedAmountMinor,
    currency: refund.currency, authorizationKey: `${key}:authorization`, authorizationDigest: digest([key, "authorization"]),
    authorizedByUserId: actor.id, authorizationReason: "Authorized isolated synthetic completion; no external dispatch.",
  } });
  attempt = await tx.primaryRefundProviderAttempt.update({ where: { id: attempt.id }, data: { status: "PROVIDER_ATTACHED", providerRefundId: `${key}:synthetic-refund` } });
  await tx.primaryRefundProviderEvent.create({ data: { attemptId: attempt.id, providerEventId: `${key}:synthetic-success-event`, payloadDigest: digest([key, "success"]), eventType: "synthetic.refund.succeeded", providerCreatedAt: new Date() } });
  await tx.primaryRefundProviderAttempt.update({ where: { id: attempt.id }, data: { status: "SUCCEEDED" } });
  return tx.primaryRefund.update({ where: { id: refundId }, data: { status: "SUCCEEDED" } });
}

async function revoke(tx: Tx, actor: Actor, scope: ReturnType<typeof ids>, ticketId: string, cause: string, refundId?: string, cancellationId?: string) {
  const ticket = await tx.primaryAdmissionTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { credential: true } });
  if (ticket.status === "ISSUED") await tx.primaryAdmissionTicket.update({ where: { id: ticketId }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: `Synthetic ${cause.toLowerCase()} revocation.` } });
  await tx.primaryAdmissionRevocation.create({ data: {
    organizerId: ORGANIZER_ID, eventId: scope.eventId, admissionTicketId: ticketId, credentialId: ticket.credential!.id,
    refundId, cancellationId, policyVersionId: POLICY_ID, actorUserId: actor.id, cause,
    reason: `Synthetic ${cause.toLowerCase()} evidence; no live credential use.`, idempotencyKey: `${scope.base}:revoke:${cause}:${ticketId}`, effectiveAt: new Date(),
  } });
}

export async function runPrimaryStagingRefundAction(db: Db, actor: Actor, action: string, input: Record<string, unknown>) {
  let attemptedGeneration: number | undefined;
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746836291)");
      const generation = await latestGeneration(tx);
      attemptedGeneration = generation;
      assertPrimaryStagingRefundActionInput(action, input);
      switch (action) {
      case "refundOrdinary": {
        await requireOrganizer(tx, actor);
        const scope = ids(generation, "ordinary"); const ticketId = `${scope.base}-ticket-1`;
        await requireScenarioPurchaseState(tx, scope);
        const existing = await tx.primaryRefund.findUnique({ where: { requestKey: `${scope.base}:refund:ordinary` } });
        if (existing) {
          const evidence = await requireRefundCommandEvidence(tx, scope, "ordinary", [ticketId]);
          if (evidence.status === "SUCCEEDED") {
            await requireSyntheticRefundCompletionEvidence(tx, scope, evidence, "ordinary", ticketId);
            await requireOrdinaryRefundAuditEvidence(tx, scope, evidence);
          } else {
            throw new PrimaryStagingRefundError("ORDINARY_REFUND_INCOMPLETE_EVIDENCE");
          }
          throw new PrimaryStagingRefundError("ORDINARY_REFUND_ALREADY_COMPLETED");
        }
        await requireScenarioTicketStates(tx, scope, [{ unit: 1, status: "ISSUED" }], "ORDINARY_REFUND_REQUIRES_UNSCANNED_TICKET");
        const refund = await refundParent(tx, actor, scope, "ordinary", [ticketId]);
        if (refund.status !== "REQUESTED") throw new PrimaryStagingRefundError("ORDINARY_REFUND_ALREADY_COMPLETED");
        await materializeRefundItems(tx, refund.id, [ticketId]); await revoke(tx, actor, scope, ticketId, "REFUND", refund.id);
        const completed = await completeSyntheticRefund(tx, actor, refund.id, `${scope.base}:ordinary`);
        await audit(tx, actor, scope.eventId, "STAGING_ORDINARY_REFUND_COMPLETED", "PrimaryRefund", completed.id, "Ordinary unscanned synthetic refund completed.", { status: completed.status, requestedAmountMinor: completed.requestedAmountMinor, currency: completed.currency });
        const completionEvidence = await requireRefundCommandEvidence(tx, scope, "ordinary", [ticketId]);
        await requireSyntheticRefundCompletionEvidence(tx, scope, completionEvidence, "ordinary", ticketId);
        await requireOrdinaryRefundAuditEvidence(tx, scope, completionEvidence);
        return completed;
      }
      case "requestCheckedRefund": {
        await requireOrganizer(tx, actor); const scope = ids(generation, "checked"); const ticketId = `${scope.base}-ticket-1`;
        await requireScenarioPurchaseState(tx, scope);
        const existing = await tx.primaryRefund.findUnique({ where: { requestKey: `${scope.base}:refund:checked` }, select: { id: true } });
        if (existing) {
          const evidence = await requireRefundCommandEvidence(tx, scope, "checked", [ticketId]);
          if (evidence.status === "SUCCEEDED") {
            await requireCheckedRefundApprovalEvidence(tx, scope, evidence);
            await requireSyntheticRefundCompletionEvidence(tx, scope, evidence, "checked", ticketId);
            await requireCheckedRefundAuditEvidence(tx, scope, evidence, "completed");
          } else if (evidence.checkedInApprovals.length) {
            await requireCheckedRefundApprovalEvidence(tx, scope, evidence);
            await requireCheckedRefundAuditEvidence(tx, scope, evidence, "approved");
          } else {
            await requireCheckedRefundAuditEvidence(tx, scope, evidence, "requested");
          }
          throw new PrimaryStagingRefundError("CHECKED_REFUND_ALREADY_REQUESTED");
        }
        await requireScenarioTicketStates(tx, scope, [{ unit: 1, status: "CHECKED_IN" }], "CHECKED_REFUND_REQUIRES_CHECKED_IN_TICKET");
        const refund = await refundParent(tx, actor, scope, "checked", [ticketId]);
        await audit(tx, actor, scope.eventId, "STAGING_CHECKED_REFUND_REQUESTED", "PrimaryRefund", refund.id, "Checked-in refund awaits scoped supervisor evidence.", { status: refund.status });
        const requestedEvidence = await requireRefundCommandEvidence(tx, scope, "checked", [ticketId]);
        await requireCheckedRefundAuditEvidence(tx, scope, requestedEvidence, "requested");
        return refund;
      }
      case "approveCheckedRefund": {
        await requireAdmin(tx, actor);
        const reason = requiredText(input, "reason", "SUPERVISOR_REASON_REQUIRED");
        const fraudReview = requiredText(input, "fraudReview", "SUPERVISOR_EVIDENCE_REQUIRED");
        const evidence = requiredText(input, "evidence", "SUPERVISOR_EVIDENCE_REQUIRED", 1000);
        if (input.costBearer !== "ORGANIZER" && input.costBearer !== "TRUEFANTIX") throw new PrimaryStagingRefundError("COST_BEARER_REQUIRED");
        const costBearer = input.costBearer;
        const scope = ids(generation, "checked"); const ticketId = `${scope.base}-ticket-1`;
        await requireScenarioPurchaseState(tx, scope);
        const existing = await tx.primaryRefund.findUnique({ where: { requestKey: `${scope.base}:refund:checked` }, select: { id: true } });
        if (!existing) throw new PrimaryStagingRefundError("CHECKED_REFUND_REQUEST_REQUIRED");
        const refund = await requireRefundCommandEvidence(tx, scope, "checked", [ticketId]);
        if (refund.status !== "REQUESTED") {
          if (refund.status === "SUCCEEDED") {
            await requireCheckedRefundApprovalEvidence(tx, scope, refund);
            await requireSyntheticRefundCompletionEvidence(tx, scope, refund, "checked", ticketId);
            await requireCheckedRefundAuditEvidence(tx, scope, refund, "completed");
          }
          throw new PrimaryStagingRefundError("CHECKED_REFUND_ALREADY_COMPLETED");
        }
        if (refund.checkedInApprovals.length) {
          await requireCheckedRefundApprovalEvidence(tx, scope, refund);
          await requireCheckedRefundAuditEvidence(tx, scope, refund, "approved");
          throw new PrimaryStagingRefundError("CHECKED_REFUND_ALREADY_APPROVED");
        }
        await requireCheckedRefundAuditEvidence(tx, scope, refund, "requested");
        await requireScenarioTicketStates(tx, scope, [{ unit: 1, status: "CHECKED_IN" }], "CHECKED_REFUND_REQUIRES_CHECKED_IN_TICKET");
        await tx.primaryCheckedInRefundApproval.create({ data: { refundId: refund.id, admissionTicketId: ticketId, approvedByUserId: actor.id, evidenceDigest: digest(evidence), reason, fraudReview, costBearer } });
        await materializeRefundItems(tx, refund.id, [ticketId]);
        await audit(tx, actor, scope.eventId, "STAGING_CHECKED_REFUND_APPROVED", "PrimaryRefund", refund.id, reason, { status: refund.status, costBearer, fraudReview });
        const approvedEvidence = await requireRefundCommandEvidence(tx, scope, "checked", [ticketId]);
        await requireCheckedRefundApprovalEvidence(tx, scope, approvedEvidence);
        await requireCheckedRefundAuditEvidence(tx, scope, approvedEvidence, "approved");
        return refund;
      }
      case "completeCheckedRefund": {
        await requireOrganizer(tx, actor); const scope = ids(generation, "checked"); const ticketId = `${scope.base}-ticket-1`;
        await requireScenarioPurchaseState(tx, scope);
        const existing = await tx.primaryRefund.findUnique({ where: { requestKey: `${scope.base}:refund:checked` }, select: { id: true } });
        if (!existing) throw new PrimaryStagingRefundError("CHECKED_REFUND_REQUEST_REQUIRED");
        const refund = await requireRefundCommandEvidence(tx, scope, "checked", [ticketId]);
        if (refund.status !== "REQUESTED") {
          if (refund.status === "SUCCEEDED") {
            await requireCheckedRefundApprovalEvidence(tx, scope, refund);
            await requireSyntheticRefundCompletionEvidence(tx, scope, refund, "checked", ticketId);
            await requireCheckedRefundAuditEvidence(tx, scope, refund, "completed");
          }
          throw new PrimaryStagingRefundError("CHECKED_REFUND_ALREADY_COMPLETED");
        }
        if (!refund.checkedInApprovals.length) throw new PrimaryStagingRefundError("CHECKED_REFUND_APPROVAL_REQUIRED");
        await requireCheckedRefundApprovalEvidence(tx, scope, refund);
        await requireCheckedRefundAuditEvidence(tx, scope, refund, "approved");
        await requireScenarioTicketStates(tx, scope, [{ unit: 1, status: "CHECKED_IN" }], "CHECKED_REFUND_REQUIRES_CHECKED_IN_TICKET");
        await revoke(tx, actor, scope, ticketId, "REFUND", refund.id);
        const completed = await completeSyntheticRefund(tx, actor, refund.id, `${scope.base}:checked`);
        await audit(tx, actor, scope.eventId, "STAGING_CHECKED_REFUND_COMPLETED", "PrimaryRefund", completed.id, "Approved checked-in synthetic refund completed; admission remains checked in.", { status: completed.status });
        const completionEvidence = await requireRefundCommandEvidence(tx, scope, "checked", [ticketId]);
        await requireCheckedRefundApprovalEvidence(tx, scope, completionEvidence);
        await requireSyntheticRefundCompletionEvidence(tx, scope, completionEvidence, "checked", ticketId);
        await requireCheckedRefundAuditEvidence(tx, scope, completionEvidence, "completed");
        return completed;
      }
      case "activateCancellation": {
        await requireOrganizer(tx, actor); const scope = ids(generation, "cancellation");
        await requireScenarioPurchaseState(tx, scope);
        const existing = await tx.primaryEventCancellation.findUnique({ where: { requestKey: `${scope.base}:cancellation` }, select: { id: true } });
        if (existing) {
          const evidence = await requireCancellationCommandEvidence(tx, scope);
          if (evidence.status === "RESOLVED") {
            await requireCancellationResolutionEvidence(tx, scope, evidence);
            const preparation = await requireCancellationPreparationEvidence(tx, scope, evidence, "resolved");
            await requireCancellationAuditEvidence(tx, scope, evidence, "resolved", preparation);
          } else if (evidence.status !== "ACTIVE") {
            const preparation = await requireCancellationPreparationEvidence(tx, scope, evidence);
            await requireCancellationAuditEvidence(
              tx,
              scope,
              evidence,
              preparation.waiverObligation.status === "WAIVED_WITH_APPROVAL" ? "waived" : "prepared",
              preparation,
            );
          } else {
            await requireCancellationAuditEvidence(tx, scope, evidence, "active");
          }
          throw new PrimaryStagingRefundError("CANCELLATION_ALREADY_ACTIVATED");
        }
        await requireScenarioTicketStates(tx, scope, [{ unit: 1, status: "ISSUED" }, { unit: 2, status: "CHECKED_IN" }], "CANCELLATION_SCENARIO_STATE_INVALID");
        const cancellation = await tx.primaryEventCancellation.create({ data: { organizerId: ORGANIZER_ID, eventId: scope.eventId, generation: 1, policyVersionId: POLICY_ID, requestedByUserId: actor.id, requestKey: `${scope.base}:cancellation`, commandDigest: digest([scope.base, "cancellation"]), reason: "Synthetic full-event cancellation.", snapshotMaxTicketId: "derived-on-activation", expectedTicketCount: 0, expectedAmountMinor: 0 } });
        const active = await tx.primaryEventCancellation.update({ where: { id: cancellation.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
        await audit(tx, actor, scope.eventId, "STAGING_CANCELLATION_ACTIVATED", "PrimaryEventCancellation", active.id, "Authoritative ticket snapshot activated.", { status: active.status, expectedTicketCount: active.expectedTicketCount, expectedAmountMinor: active.expectedAmountMinor });
        await requireCancellationAuditEvidence(tx, scope, active, "active");
        return active;
      }
      case "prepareCancellation": {
        await requireOrganizer(tx, actor); const scope = ids(generation, "cancellation");
        await requireScenarioPurchaseState(tx, scope);
        const existing = await tx.primaryEventCancellation.findUnique({ where: { requestKey: `${scope.base}:cancellation` }, select: { id: true } });
        if (!existing) throw new PrimaryStagingRefundError("CANCELLATION_ACTIVATION_REQUIRED");
        const cancellation = await requireCancellationCommandEvidence(tx, scope);
        if (cancellation.status !== "ACTIVE") {
          if (cancellation.status === "RESOLVED") {
            await requireCancellationResolutionEvidence(tx, scope, cancellation);
            const preparation = await requireCancellationPreparationEvidence(tx, scope, cancellation, "resolved");
            await requireCancellationAuditEvidence(tx, scope, cancellation, "resolved", preparation);
          } else {
            const preparation = await requireCancellationPreparationEvidence(tx, scope, cancellation);
            await requireCancellationAuditEvidence(
              tx,
              scope,
              cancellation,
              preparation.waiverObligation.status === "WAIVED_WITH_APPROVAL" ? "waived" : "prepared",
              preparation,
            );
          }
          throw new PrimaryStagingRefundError("CANCELLATION_ALREADY_PREPARED");
        }
        await requireCancellationAuditEvidence(tx, scope, cancellation, "active");
        await requireScenarioTicketStates(tx, scope, [{ unit: 1, status: "ISSUED" }, { unit: 2, status: "CHECKED_IN" }], "CANCELLATION_SCENARIO_STATE_INVALID");
        const refundableTicket = `${scope.base}-ticket-1`; const waivedTicket = `${scope.base}-ticket-2`;
        const refund = await refundParent(tx, actor, scope, "cancellation", [refundableTicket]);
        await tx.primaryCancellationRefundLink.create({ data: { cancellationId: cancellation.id, refundId: refund.id } });
        await materializeRefundItems(tx, refund.id, [refundableTicket]);
        const snapshots = await tx.primaryCancellationSnapshotTicket.findMany({ where: { cancellationId: cancellation.id } });
        const amount = (ticketId: string) => snapshots.find((item) => item.admissionTicketId === ticketId)?.amountMinor ?? 0;
        await tx.primaryRefundObligation.create({ data: { organizerId: ORGANIZER_ID, eventId: scope.eventId, orderId: scope.orderId, cancellationId: cancellation.id, refundId: refund.id, cause: "EVENT_CANCELLATION", amountMinor: amount(refundableTicket), currency: "CAD", idempotencyKey: `${scope.base}:obligation:refund`, reason: "Synthetic cancellation refund obligation." } });
        await tx.primaryRefundObligation.create({ data: { organizerId: ORGANIZER_ID, eventId: scope.eventId, orderId: scope.orderId, cancellationId: cancellation.id, cause: "CHECKED_IN_CANCELLATION_WAIVER", amountMinor: amount(waivedTicket), currency: "CAD", idempotencyKey: `${scope.base}:obligation:waiver`, reason: "Synthetic checked-in cancellation waiver candidate." } });
        const prepared = await tx.primaryEventCancellation.update({ where: { id: cancellation.id }, data: { status: "REFUNDING" } });
        await audit(tx, actor, scope.eventId, "STAGING_CANCELLATION_PREPARED", "PrimaryEventCancellation", prepared.id, "Refund provenance and exact obligations recorded.", { status: prepared.status });
        const preparedEvidence = await requireCancellationCommandEvidence(tx, scope);
        const preparation = await requireCancellationPreparationEvidence(tx, scope, preparedEvidence);
        await requireCancellationAuditEvidence(tx, scope, preparedEvidence, "prepared", preparation);
        return prepared;
      }
      case "approveCancellationWaiver": {
        await requireAdmin(tx, actor);
        const reason = requiredText(input, "reason", "SUPERVISOR_REASON_REQUIRED");
        const evidence = requiredText(input, "evidence", "SUPERVISOR_EVIDENCE_REQUIRED", 1000);
        const scope = ids(generation, "cancellation");
        await requireScenarioPurchaseState(tx, scope);
        const existing = await tx.primaryEventCancellation.findUnique({ where: { requestKey: `${scope.base}:cancellation` }, select: { id: true } });
        if (!existing) throw new PrimaryStagingRefundError("CANCELLATION_PREPARATION_REQUIRED");
        const cancellation = await requireCancellationCommandEvidence(tx, scope);
        if (cancellation.status === "ACTIVE") {
          await requireCancellationAuditEvidence(tx, scope, cancellation, "active");
          throw new PrimaryStagingRefundError("CANCELLATION_PREPARATION_REQUIRED");
        }
        if (cancellation.status === "RESOLVED") {
          await requireCancellationResolutionEvidence(tx, scope, cancellation);
          const preparation = await requireCancellationPreparationEvidence(tx, scope, cancellation, "resolved");
          await requireCancellationAuditEvidence(tx, scope, cancellation, "resolved", preparation);
          throw new PrimaryStagingRefundError("CANCELLATION_ALREADY_RESOLVED");
        }
        const obligation = await tx.primaryRefundObligation.findUnique({
          where: { idempotencyKey: `${scope.base}:obligation:waiver` },
          include: { waiverApproval: { select: { id: true } } },
        });
        if (!obligation) throw new PrimaryStagingRefundError("CANCELLATION_PREPARATION_REQUIRED");
        const preparation = await requireCancellationPreparationEvidence(tx, scope, cancellation);
        if (obligation.waiverApproval) {
          await requireCancellationAuditEvidence(tx, scope, cancellation, "waived", preparation);
          throw new PrimaryStagingRefundError("CANCELLATION_WAIVER_ALREADY_APPROVED");
        }
        await requireCancellationAuditEvidence(tx, scope, cancellation, "prepared", preparation);
        await tx.primaryObligationWaiverApproval.create({ data: { obligationId: obligation.id, approvedByUserId: actor.id, evidenceDigest: digest(evidence), reason } });
        const waived = await tx.primaryRefundObligation.update({ where: { id: obligation.id }, data: { status: "WAIVED_WITH_APPROVAL" } });
        await audit(tx, actor, scope.eventId, "STAGING_CANCELLATION_WAIVER_APPROVED", "PrimaryRefundObligation", waived.id, reason, { status: waived.status });
        const waivedPreparation = await requireCancellationPreparationEvidence(tx, scope, cancellation);
        await requireCancellationAuditEvidence(tx, scope, cancellation, "waived", waivedPreparation);
        return waived;
      }
      case "completeCancellation": {
        await requireOrganizer(tx, actor); const scope = ids(generation, "cancellation");
        await requireScenarioPurchaseState(tx, scope);
        const existing = await tx.primaryEventCancellation.findUnique({ where: { requestKey: `${scope.base}:cancellation` }, select: { id: true } });
        if (!existing) throw new PrimaryStagingRefundError("CANCELLATION_ACTIVATION_REQUIRED");
        const cancellation = await requireCancellationCommandEvidence(tx, scope);
        if (cancellation.status === "ACTIVE") {
          await requireCancellationAuditEvidence(tx, scope, cancellation, "active");
          throw new PrimaryStagingRefundError("CANCELLATION_PREPARATION_REQUIRED");
        }
        if (cancellation.status === "RESOLVED") {
          await requireCancellationResolutionEvidence(tx, scope, cancellation);
          const preparation = await requireCancellationPreparationEvidence(tx, scope, cancellation, "resolved");
          await requireCancellationAuditEvidence(tx, scope, cancellation, "resolved", preparation);
          throw new PrimaryStagingRefundError("CANCELLATION_ALREADY_RESOLVED");
        }
        await requireScenarioTicketStates(tx, scope, [{ unit: 1, status: "ISSUED" }, { unit: 2, status: "CHECKED_IN" }], "CANCELLATION_SCENARIO_STATE_INVALID");
        const existingRefund = await tx.primaryRefund.findUnique({ where: { requestKey: `${scope.base}:refund:cancellation` }, select: { id: true } });
        if (!existingRefund) throw new PrimaryStagingRefundError("CANCELLATION_PREPARATION_REQUIRED");
        const { refund, refundObligation, waiverObligation } = await requireCancellationPreparationEvidence(tx, scope, cancellation);
        if (waiverObligation.status !== "WAIVED_WITH_APPROVAL") throw new PrimaryStagingRefundError("CANCELLATION_WAIVER_REQUIRED");
        await requireCancellationAuditEvidence(tx, scope, cancellation, "waived", { refund, refundObligation, waiverObligation });
        const refundableTicket = `${scope.base}-ticket-1`; const waivedTicket = `${scope.base}-ticket-2`;
        await revoke(tx, actor, scope, refundableTicket, "EVENT_CANCELLATION", refund.id, cancellation.id);
        await revoke(tx, actor, scope, waivedTicket, "EVENT_CANCELLATION", undefined, cancellation.id);
        await completeSyntheticRefund(tx, actor, refund.id, `${scope.base}:cancellation`);
        await tx.primaryRefundObligation.update({ where: { id: refundObligation.id }, data: { status: "REFUND_LINKED" } });
        await tx.primaryRefundObligation.update({ where: { id: refundObligation.id }, data: { status: "SATISFIED" } });
        const snapshots = await tx.primaryCancellationSnapshotTicket.findMany({ where: { cancellationId: cancellation.id }, orderBy: { admissionTicketId: "asc" } });
        const batch = await tx.primaryCancellationBatch.create({ data: { cancellationId: cancellation.id, batchKey: `${scope.base}:batch:1`, commandDigest: digest([scope.base, "batch", 1]), firstTicketId: snapshots[0].admissionTicketId, lastTicketId: snapshots.at(-1)!.admissionTicketId, processedTicketCount: snapshots.length, processedAmountMinor: snapshots.reduce((sum, item) => sum + item.amountMinor, 0) } });
        for (const snapshot of snapshots) {
          const isRefund = snapshot.admissionTicketId === refundableTicket;
          await tx.primaryCancellationBatchTicket.create({ data: { cancellationId: cancellation.id, batchId: batch.id, admissionTicketId: snapshot.admissionTicketId, refundItemId: isRefund ? refund.items[0].id : undefined, obligationId: isRefund ? refundObligation.id : waiverObligation.id, amountMinor: snapshot.amountMinor, currency: snapshot.currency } });
        }
        const resolved = await tx.primaryEventCancellation.update({ where: { id: cancellation.id }, data: { status: "RESOLVED" } });
        await audit(tx, actor, scope.eventId, "STAGING_CANCELLATION_RESOLVED", "PrimaryEventCancellation", resolved.id, "Exact snapshot, refund, waiver, batch, revocation, and obligation evidence reconciled.", { status: resolved.status, processedTicketCount: resolved.processedTicketCount, processedAmountMinor: resolved.processedAmountMinor });
        const resolutionEvidence = await requireCancellationCommandEvidence(tx, scope);
        await requireCancellationResolutionEvidence(tx, scope, resolutionEvidence);
        const resolvedPreparation = await requireCancellationPreparationEvidence(tx, scope, resolutionEvidence, "resolved");
        await requireCancellationAuditEvidence(tx, scope, resolutionEvidence, "resolved", resolvedPreparation);
        return resolved;
      }
        default: throw new PrimaryStagingRefundError("UNKNOWN_REFUND_ACTION");
      }
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof PrimaryStagingRefundError) {
      if (error.generation !== undefined || attemptedGeneration === undefined) throw error;
      throw new PrimaryStagingRefundError(error.code, error.message, attemptedGeneration);
    }
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (["P2002", "P2034", "23505", "40001", "40P01"].includes(code)) {
      throw new PrimaryStagingRefundError("STAGING_REFUND_CONCURRENT_CONFLICT", undefined, attemptedGeneration);
    }
    throw error;
  }
}

export async function getPrimaryStagingRefundState(db: Db) {
  const rows = await db.$queryRawUnsafe<Array<{ generation: number }>>(`SELECT COALESCE(MAX((regexp_match(id, '^staging-refund-g([0-9]+)-ordinary-event$'))[1]::int),0)::int AS generation FROM "PrimaryEvent" WHERE "organizerId"=$1`, ORGANIZER_ID);
  const generation = Number(rows[0]?.generation ?? 0); if (!generation) return null;
  const eventIds = (["ordinary", "checked", "cancellation"] as const).map((kind) => ids(generation, kind).eventId);
  const events = await db.primaryEvent.findMany({ where: { id: { in: eventIds }, organizerId: ORGANIZER_ID }, orderBy: { id: "asc" }, select: {
    id: true, title: true, status: true,
    refunds: { orderBy: { createdAt: "asc" }, select: {
      id: true, status: true, reason: true, requestedAmountMinor: true, currency: true,
      checkedInApprovals: { select: { reason: true, fraudReview: true, costBearer: true, evidenceDigest: true, approver: { select: { email: true } } } },
    } },
    orders: { select: {
      id: true, grossTotalMinor: true, currency: true,
      admissionTickets: { orderBy: { unitNumber: "asc" }, select: {
        id: true, unitNumber: true, status: true, voidReason: true,
        purchaseAllocations: { orderBy: [{ remainderRank: "asc" }, { orderComponentId: "asc" }], select: {
          amountMinor: true, currency: true, refundable: true, liabilityOwner: true,
          remainderRank: true, algorithmVersion: true, allocationSetDigest: true,
          component: { select: { code: true, label: true, kind: true } },
        } },
        refundItems: { select: {
          refundId: true, requestedMinor: true,
          refund: { select: {
            status: true, reason: true,
            attempts: { orderBy: { ordinal: "asc" }, select: {
              ordinal: true, status: true, expectedAmountMinor: true, currency: true,
              providerRefundId: true, authorizationReason: true,
              providerEvents: { orderBy: { providerCreatedAt: "asc" }, select: {
                providerEventId: true, eventType: true, payloadDigest: true, providerCreatedAt: true,
              } },
            } },
            checkedInApprovals: { select: { reason: true, fraudReview: true, costBearer: true, evidenceDigest: true, approver: { select: { email: true } } } },
          } },
        } },
        revocations: { select: { cause: true, reason: true, refundId: true, cancellationId: true } },
      } },
    } },
    cancellations: { select: { id: true, status: true, activatedAt: true, expectedTicketCount: true, expectedAmountMinor: true, processedTicketCount: true, processedAmountMinor: true, snapshotTickets: { orderBy: { admissionTicketId: "asc" }, select: { admissionTicketId: true, amountMinor: true, currency: true } }, refundLinks: { select: { refundId: true } }, obligations: { orderBy: { createdAt: "asc" }, select: { id: true, status: true, cause: true, amountMinor: true, currency: true, refundId: true, waiverApproval: { select: { reason: true, evidenceDigest: true, approver: { select: { email: true } } } }, cancellationClaims: { select: { admissionTicketId: true, amountMinor: true, refundItemId: true } } } }, batches: { select: { processedTicketCount: true, processedAmountMinor: true, firstTicketId: true, lastTicketId: true } } } },
  } });
  const audit = await db.primaryAuditEvent.findMany({ where: { organizerId: ORGANIZER_ID, eventId: { in: eventIds }, action: { startsWith: "STAGING_" } }, orderBy: { createdAt: "desc" }, take: 80, select: { id: true, eventId: true, actorUserId: true, actor: { select: { email: true } }, action: true, targetType: true, targetId: true, reason: true, afterJson: true, createdAt: true } });
  return { generation, organizerId: ORGANIZER_ID, events, audit };
}

export async function recordPrimaryStagingRefundRejection(db: Db, actor: Actor, action: string, code: string, attemptedGeneration?: number) {
  const state = attemptedGeneration === undefined ? await getPrimaryStagingRefundState(db) : null;
  const generation = attemptedGeneration ?? state?.generation;
  if (!generation) return;
  const scenario = ACTION_SCENARIOS[action];
  const targetAction = scenario ? action : "unknown";
  const eventId = scenario ? ids(generation, scenario).eventId : state?.events[0]?.id;
  if (!eventId) return;
  const event = await db.primaryEvent.findFirst({ where: { id: eventId, organizerId: ORGANIZER_ID }, select: { id: true } });
  if (!event) return;
  await db.primaryAuditEvent.create({ data: { organizerId: ORGANIZER_ID, eventId, actorUserId: actor.id, actorType: "USER", action: "STAGING_REFUND_ACTION_REJECTED", targetType: "StagingRefundCommand", targetId: targetAction, reason: code, requestId: `staging-refund-rejection:${randomUUID()}`, afterJson: { status: "REJECTED", code, scenario: scenario ?? "unknown", generation } } });
}
