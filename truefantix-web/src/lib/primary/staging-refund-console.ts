import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, UserRole } from "@prisma/client";
import { STAGING_ADMIN_EMAIL, STAGING_ORGANIZER_EMAIL } from "./staging-console";

const ORGANIZER_ID = "primary-staging-refund-organizer";
const POLICY_ID = "primary-refund-policy-v1";
const EVENT_PREFIX = "staging-refund-g";
const BUYER_EMAIL = "refund-buyer@primary-staging.example.invalid";

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

export class PrimaryStagingRefundError extends Error {
  constructor(readonly code: string, message = code, readonly generation?: number) {
    super(message);
    this.name = "PrimaryStagingRefundError";
  }
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requiredText(input: Record<string, unknown>, key: string, code: string, maximum = 500) {
  const value = typeof input[key] === "string" ? input[key].trim() : "";
  if (!value || value.length > maximum) throw new PrimaryStagingRefundError(code);
  return value;
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

async function requireOrganizer(tx: Tx, actor: Actor) {
  if (actor.email !== STAGING_ORGANIZER_EMAIL || actor.role !== "USER") {
    throw new PrimaryStagingRefundError("STAGING_ORGANIZER_REQUIRED");
  }
  const membership = await tx.primaryOrganizerMembership.findFirst({
    where: { organizerId: ORGANIZER_ID, userId: actor.id, role: "OWNER", status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) throw new PrimaryStagingRefundError("STAGING_REFUND_SCOPE_REQUIRED");
}

function requireAdmin(actor: Actor) {
  if (actor.email !== STAGING_ADMIN_EMAIL || actor.role !== "ADMIN") {
    throw new PrimaryStagingRefundError("STAGING_ADMIN_REQUIRED");
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

async function seedOrder(tx: Tx, generation: number, kind: ScenarioKind, buyerId: string, adminId: string) {
  const scope = ids(generation, kind);
  const quantity = kind === "cancellation" ? 2 : 1;
  const unitPrice = kind === "ordinary" ? 2500 : kind === "checked" ? 3000 : 2000;
  const fee = kind === "ordinary" ? 100 : kind === "checked" ? 120 : 200;
  const gross = unitPrice * quantity + fee;
  const now = new Date();
  const title = kind === "ordinary" ? "Ordinary unscanned refund" : kind === "checked" ? "Checked-in supervised refund" : "Event cancellation and obligations";

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
    requireAdmin(actor);
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(746836291)");
    const organizerUser = await tx.user.findUniqueOrThrow({ where: { email: STAGING_ORGANIZER_EMAIL } });
    const buyer = await tx.user.upsert({
      where: { email: BUYER_EMAIL },
      create: { email: BUYER_EMAIL, passwordHash: "synthetic-staging-no-login", emailVerifiedAt: new Date(), firstName: "Synthetic", lastName: "Refund Buyer", phone: "+15550001004", phoneVerifiedAt: new Date(), streetAddress1: "1 Synthetic Way", city: "Toronto", region: "ON", postalCode: "M5V 0A1", country: "CA", canBuy: false, canSell: false, canComment: false },
      update: { emailVerifiedAt: new Date(), phoneVerifiedAt: new Date(), isBanned: false },
    });
    await tx.primaryOrganizer.upsert({
      where: { id: ORGANIZER_ID },
      create: { id: ORGANIZER_ID, legalName: "Synthetic Refund Operations Inc.", displayName: "Synthetic Refund Operations", addressLine1: "1 Synthetic Way", city: "Toronto", region: "ON", postalCode: "M5V 0A1", country: "CA", supportEmail: "refunds@primary-staging.example.invalid", supportPhone: "+15550001003", status: "APPROVED", submittedAt: new Date(), approvedAt: new Date(), approvedByUserId: actor.id, createdByUserId: organizerUser.id },
      update: {},
    });
    await tx.primaryOrganizerMembership.upsert({
      where: { organizerId_userId: { organizerId: ORGANIZER_ID, userId: organizerUser.id } },
      create: { organizerId: ORGANIZER_ID, userId: organizerUser.id, role: "OWNER", status: "ACTIVE", acceptedAt: new Date(), invitedByUserId: organizerUser.id },
      update: { role: "OWNER", status: "ACTIVE", acceptedAt: new Date(), revokedAt: null },
    });
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
      switch (action) {
      case "refundOrdinary": {
        await requireOrganizer(tx, actor);
        const scope = ids(generation, "ordinary"); const ticketId = `${scope.base}-ticket-1`;
        const refund = await refundParent(tx, actor, scope, "ordinary", [ticketId]);
        if (refund.status !== "REQUESTED") throw new PrimaryStagingRefundError("ORDINARY_REFUND_ALREADY_COMPLETED");
        await materializeRefundItems(tx, refund.id, [ticketId]); await revoke(tx, actor, scope, ticketId, "REFUND", refund.id);
        const completed = await completeSyntheticRefund(tx, actor, refund.id, `${scope.base}:ordinary`);
        await audit(tx, actor, scope.eventId, "STAGING_ORDINARY_REFUND_COMPLETED", "PrimaryRefund", completed.id, "Ordinary unscanned synthetic refund completed.", { status: completed.status, requestedAmountMinor: completed.requestedAmountMinor, currency: completed.currency });
        return completed;
      }
      case "requestCheckedRefund": {
        await requireOrganizer(tx, actor); const scope = ids(generation, "checked"); const ticketId = `${scope.base}-ticket-1`;
        const existing = await tx.primaryRefund.findUnique({ where: { requestKey: `${scope.base}:refund:checked` }, select: { id: true } });
        if (existing) throw new PrimaryStagingRefundError("CHECKED_REFUND_ALREADY_REQUESTED");
        const refund = await refundParent(tx, actor, scope, "checked", [ticketId]);
        await audit(tx, actor, scope.eventId, "STAGING_CHECKED_REFUND_REQUESTED", "PrimaryRefund", refund.id, "Checked-in refund awaits scoped supervisor evidence.", { status: refund.status });
        return refund;
      }
      case "approveCheckedRefund": {
        requireAdmin(actor);
        const reason = requiredText(input, "reason", "SUPERVISOR_REASON_REQUIRED");
        const fraudReview = requiredText(input, "fraudReview", "SUPERVISOR_EVIDENCE_REQUIRED");
        const evidence = requiredText(input, "evidence", "SUPERVISOR_EVIDENCE_REQUIRED", 1000);
        if (input.costBearer !== "ORGANIZER" && input.costBearer !== "TRUEFANTIX") throw new PrimaryStagingRefundError("COST_BEARER_REQUIRED");
        const costBearer = input.costBearer;
        const scope = ids(generation, "checked"); const ticketId = `${scope.base}-ticket-1`;
        const refund = await tx.primaryRefund.findUnique({
          where: { requestKey: `${scope.base}:refund:checked` },
          include: { checkedInApprovals: { select: { id: true } } },
        });
        if (!refund) throw new PrimaryStagingRefundError("CHECKED_REFUND_REQUEST_REQUIRED");
        if (refund.status !== "REQUESTED") throw new PrimaryStagingRefundError("CHECKED_REFUND_ALREADY_COMPLETED");
        if (refund.checkedInApprovals.length) throw new PrimaryStagingRefundError("CHECKED_REFUND_ALREADY_APPROVED");
        await tx.primaryCheckedInRefundApproval.create({ data: { refundId: refund.id, admissionTicketId: ticketId, approvedByUserId: actor.id, evidenceDigest: digest(evidence), reason, fraudReview, costBearer } });
        await materializeRefundItems(tx, refund.id, [ticketId]);
        await audit(tx, actor, scope.eventId, "STAGING_CHECKED_REFUND_APPROVED", "PrimaryRefund", refund.id, reason, { status: refund.status, costBearer, fraudReview });
        return refund;
      }
      case "completeCheckedRefund": {
        await requireOrganizer(tx, actor); const scope = ids(generation, "checked"); const ticketId = `${scope.base}-ticket-1`;
        const refund = await tx.primaryRefund.findUnique({
          where: { requestKey: `${scope.base}:refund:checked` },
          include: { checkedInApprovals: { select: { id: true } } },
        });
        if (!refund) throw new PrimaryStagingRefundError("CHECKED_REFUND_REQUEST_REQUIRED");
        if (refund.status !== "REQUESTED") throw new PrimaryStagingRefundError("CHECKED_REFUND_ALREADY_COMPLETED");
        if (!refund.checkedInApprovals.length) throw new PrimaryStagingRefundError("CHECKED_REFUND_APPROVAL_REQUIRED");
        await revoke(tx, actor, scope, ticketId, "REFUND", refund.id);
        const completed = await completeSyntheticRefund(tx, actor, refund.id, `${scope.base}:checked`);
        await audit(tx, actor, scope.eventId, "STAGING_CHECKED_REFUND_COMPLETED", "PrimaryRefund", completed.id, "Approved checked-in synthetic refund completed; admission remains checked in.", { status: completed.status });
        return completed;
      }
      case "activateCancellation": {
        await requireOrganizer(tx, actor); const scope = ids(generation, "cancellation");
        const existing = await tx.primaryEventCancellation.findUnique({ where: { requestKey: `${scope.base}:cancellation` }, select: { id: true } });
        if (existing) throw new PrimaryStagingRefundError("CANCELLATION_ALREADY_ACTIVATED");
        const cancellation = await tx.primaryEventCancellation.create({ data: { organizerId: ORGANIZER_ID, eventId: scope.eventId, generation: 1, policyVersionId: POLICY_ID, requestedByUserId: actor.id, requestKey: `${scope.base}:cancellation`, commandDigest: digest([scope.base, "cancellation"]), reason: "Synthetic full-event cancellation.", snapshotMaxTicketId: "derived-on-activation", expectedTicketCount: 0, expectedAmountMinor: 0 } });
        const active = await tx.primaryEventCancellation.update({ where: { id: cancellation.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
        await audit(tx, actor, scope.eventId, "STAGING_CANCELLATION_ACTIVATED", "PrimaryEventCancellation", active.id, "Authoritative ticket snapshot activated.", { status: active.status, expectedTicketCount: active.expectedTicketCount, expectedAmountMinor: active.expectedAmountMinor });
        return active;
      }
      case "prepareCancellation": {
        await requireOrganizer(tx, actor); const scope = ids(generation, "cancellation");
        const cancellation = await tx.primaryEventCancellation.findUnique({ where: { requestKey: `${scope.base}:cancellation` } });
        if (!cancellation) throw new PrimaryStagingRefundError("CANCELLATION_ACTIVATION_REQUIRED");
        if (cancellation.status !== "ACTIVE") throw new PrimaryStagingRefundError("CANCELLATION_ALREADY_PREPARED");
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
        return prepared;
      }
      case "approveCancellationWaiver": {
        requireAdmin(actor);
        const reason = requiredText(input, "reason", "SUPERVISOR_REASON_REQUIRED");
        const evidence = requiredText(input, "evidence", "SUPERVISOR_EVIDENCE_REQUIRED", 1000);
        const scope = ids(generation, "cancellation");
        const cancellation = await tx.primaryEventCancellation.findUnique({ where: { requestKey: `${scope.base}:cancellation` }, select: { status: true } });
        if (!cancellation || cancellation.status === "ACTIVE") throw new PrimaryStagingRefundError("CANCELLATION_PREPARATION_REQUIRED");
        if (cancellation.status === "RESOLVED") throw new PrimaryStagingRefundError("CANCELLATION_ALREADY_RESOLVED");
        const obligation = await tx.primaryRefundObligation.findUnique({
          where: { idempotencyKey: `${scope.base}:obligation:waiver` },
          include: { waiverApproval: { select: { id: true } } },
        });
        if (!obligation) throw new PrimaryStagingRefundError("CANCELLATION_PREPARATION_REQUIRED");
        if (obligation.waiverApproval) throw new PrimaryStagingRefundError("CANCELLATION_WAIVER_ALREADY_APPROVED");
        await tx.primaryObligationWaiverApproval.create({ data: { obligationId: obligation.id, approvedByUserId: actor.id, evidenceDigest: digest(evidence), reason } });
        const waived = await tx.primaryRefundObligation.update({ where: { id: obligation.id }, data: { status: "WAIVED_WITH_APPROVAL" } });
        await audit(tx, actor, scope.eventId, "STAGING_CANCELLATION_WAIVER_APPROVED", "PrimaryRefundObligation", waived.id, reason, { status: waived.status });
        return waived;
      }
      case "completeCancellation": {
        await requireOrganizer(tx, actor); const scope = ids(generation, "cancellation");
        const cancellation = await tx.primaryEventCancellation.findUnique({ where: { requestKey: `${scope.base}:cancellation` } });
        if (!cancellation) throw new PrimaryStagingRefundError("CANCELLATION_ACTIVATION_REQUIRED");
        if (cancellation.status === "ACTIVE") throw new PrimaryStagingRefundError("CANCELLATION_PREPARATION_REQUIRED");
        if (cancellation.status === "RESOLVED") throw new PrimaryStagingRefundError("CANCELLATION_ALREADY_RESOLVED");
        const refund = await tx.primaryRefund.findUnique({ where: { requestKey: `${scope.base}:refund:cancellation` }, include: { items: true } });
        const refundObligation = await tx.primaryRefundObligation.findUnique({ where: { idempotencyKey: `${scope.base}:obligation:refund` } });
        const waiverObligation = await tx.primaryRefundObligation.findUnique({ where: { idempotencyKey: `${scope.base}:obligation:waiver` } });
        if (!refund || !refundObligation || !waiverObligation) throw new PrimaryStagingRefundError("CANCELLATION_PREPARATION_REQUIRED");
        if (waiverObligation.status !== "WAIVED_WITH_APPROVAL") throw new PrimaryStagingRefundError("CANCELLATION_WAIVER_REQUIRED");
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
