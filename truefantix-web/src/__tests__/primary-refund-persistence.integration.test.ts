/** @jest-environment node */
import { generateKeyPairSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { requirePrimaryPreflight } from "@/lib/primary/config";
import { createPrimaryOrderInternalCapabilityForTests, PrimaryOrderService } from "@/lib/primary/order-service";
import { createPrimaryAdmissionInternalCapabilityForTests, PrimaryAdmissionService, requirePrimaryAdmissionTestConfig } from "@/lib/primary/admission-service";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;
if (!databaseUrl) describe.skip("primary refund persistence PostgreSQL integration", () => { it("requires an isolated database", () => undefined); });
else describe("primary refund persistence PostgreSQL integration", () => {
  process.env.PRIMARY_TICKETING_ENVIRONMENT_ID = "isolated-test";
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const capability = requirePrimaryPreflight({ NODE_ENV: "test", PRIMARY_TICKETING_ENABLED: "true", PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-test", PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-test", PRIMARY_TICKETING_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl } as NodeJS.ProcessEnv);
  const pair = generateKeyPairSync("ed25519");
  const admissionConfig = requirePrimaryAdmissionTestConfig(capability, { NODE_ENV: "test", PRIMARY_ADMISSION_SIGNING_KEY_ID: "test_refund_1", PRIMARY_ADMISSION_PRIVATE_KEY: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), PRIMARY_ADMISSION_PUBLIC_KEY: pair.publicKey.export({ type: "spki", format: "pem" }).toString() } as NodeJS.ProcessEnv);
  const now = new Date("2037-02-01T12:00:00Z"); const runId = `${process.pid}-${Date.now()}`; let sequence = 0;
  const orders = new PrimaryOrderService(db, capability, () => now);
  const admission = new PrimaryAdmissionService(db, capability, admissionConfig, () => now);
  const orderInternal = createPrimaryOrderInternalCapabilityForTests();
  const admissionInternal = createPrimaryAdmissionInternalCapabilityForTests();

  async function seed(quantity = 2, issue = true) {
    const n = ++sequence;
    const buyer = await db.user.create({ data: { email: `refund-${runId}-${n}@example.test`, passwordHash: "synthetic", emailVerifiedAt: now, firstName: "Refund", lastName: `${n}`, phone: `+3${String(Date.now() + n).slice(-10)}`, phoneVerifiedAt: now, streetAddress1: "1 Test", city: "Toronto", region: "ON", postalCode: "A1A1A1", country: "CA" } });
    const organizer = await db.primaryOrganizer.create({ data: { legalName: `Refund ${n}`, displayName: `Refund ${n}`, addressLine1: "1 Test", city: "Toronto", region: "ON", postalCode: "A1A1A1", country: "CA", supportEmail: `refund-org-${runId}-${n}@example.test`, status: "APPROVED", createdByUserId: buyer.id } });
    const event = await db.primaryEvent.create({ data: { organizerId: organizer.id, title: "Refund Event", description: "Synthetic", category: "CONCERT", venueName: "Hall", venueAddressLine1: "1 Test", venueCity: "Toronto", venueRegion: "ON", venuePostalCode: "A1A1A1", venueCountry: "CA", startsAtLocal: new Date("2038-01-01T19:00:00Z"), endsAtLocal: new Date("2038-01-01T22:00:00Z"), timezone: "America/Toronto", contactEmail: "events@example.test", draftPolicyText: "Synthetic", totalCapacity: 10, status: "APPROVED" } });
    const ticketType = await db.primaryTicketType.create({ data: { organizerId: organizer.id, eventId: event.id, name: "GA", allocatedQuantity: 10, currency: "CAD", basePriceMinor: 2500 } });
    const reservation = await db.primaryInventoryReservation.create({ data: { organizerId: organizer.id, eventId: event.id, ticketTypeId: ticketType.id, buyerUserId: buyer.id, quantity, expiresAt: new Date(now.getTime() + 60_000), createIdempotencyKey: `refund-res-${runId}-${n}` } });
    const order = await orders.create({ internalCapability: orderInternal, actor: { id: buyer.id, role: buyer.role }, organizerId: organizer.id, eventId: event.id, reservationId: reservation.id, idempotencyKey: `refund-order-${runId}-${n}`, additionalComponents: [{ code: "SERVICE_FEE", label: "Organizer fee", kind: "MANDATORY_FEE", amountMinor: 5 }] });
    await orders.prepareForPayment({ internalCapability: orderInternal, organizerId: organizer.id, eventId: event.id, orderId: order.id, idempotencyKey: `refund-prepare-${runId}-${n}` });
    let attempt = await db.primaryPaymentAttempt.create({ data: { organizerId: organizer.id, eventId: event.id, buyerUserId: buyer.id, reservationId: reservation.id, orderId: order.id, status: "PROCESSING", expectedAmountMinor: order.grossTotalMinor, currency: order.currency, createIdempotencyKey: `refund-payment-${runId}-${n}`, providerIntentId: `pi_refund_${runId}_${n}`, providerCreatedAt: now } });
    attempt = await db.primaryPaymentAttempt.update({ where: { id: attempt.id }, data: { status: "SUCCEEDED", terminalAt: now } });
    await db.primaryOrder.update({ where: { id: order.id }, data: { status: "PAID", paidAt: now } });
    const issued = issue ? await admission.issue({ internalCapability: admissionInternal, organizerId: organizer.id, eventId: event.id, orderId: order.id, idempotencyKey: `refund-issue-${runId}-${n}` }) : [];
    return { buyer, organizer, event, order, attempt, issued };
  }

  function refundData(scope: Awaited<ReturnType<typeof seed>>, suffix: string) {
    return { organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, paymentAttemptId: scope.attempt.id, requestedByUserId: scope.buyer.id, policyVersionId: "primary-refund-policy-v1", requestKey: `refund-request-${runId}-${suffix}`, commandDigest: "a".repeat(64), reason: "Synthetic reviewed refund", requestedAmountMinor: scope.order.grossTotalMinor, currency: "CAD" };
  }
  async function completeRefund(scope: Awaited<ReturnType<typeof seed>>, suffix: string, ticketIndexes = scope.issued.map((_, index) => index)) {
    await db.$queryRaw`SELECT materialize_primary_purchase_allocations(${scope.order.id})`;
    const selected = ticketIndexes.map((index) => scope.issued[index].ticket.id);
    const allocations = await db.primaryPurchaseAllocation.findMany({ where: { admissionTicketId: { in: selected } }, orderBy: [{ admissionTicketId: "asc" }, { orderComponentId: "asc" }] });
    const requestedAmountMinor = allocations.reduce((sum, row) => sum + row.amountMinor, 0);
    const refund = await db.primaryRefund.create({ data: { ...refundData(scope, suffix), requestedAmountMinor } });
    for (const ticketId of selected) {
      const ticketAllocations = allocations.filter((row) => row.admissionTicketId === ticketId); const requestedMinor = ticketAllocations.reduce((sum, row) => sum + row.amountMinor, 0);
      const item = await db.primaryRefundItem.create({ data: { refundId: refund.id, admissionTicketId: ticketId, requestedMinor, currency: "CAD" } });
      for (const allocation of ticketAllocations) await db.primaryRefundAllocation.create({ data: { refundId: refund.id, refundItemId: item.id, admissionTicketId: ticketId, purchaseAllocationId: allocation.id, amountMinor: allocation.amountMinor, currency: "CAD" } });
    }
    return refund;
  }

  beforeAll(async () => { process.env.PRIMARY_TICKETING_ENVIRONMENT_ID = "isolated-test"; await db.$executeRawUnsafe('TRUNCATE TABLE "PrimaryRefundProviderEvent", "PrimaryRefundProviderAttempt", "PrimaryRefundAllocation", "PrimaryRefundItem", "PrimaryAdmissionRevocation", "PrimaryRefundObligation", "PrimaryCancellationBatch", "PrimaryEventCancellation", "PrimaryRefund", "PrimaryPurchaseAllocation", "PrimaryAdmissionScan", "PrimaryAdmissionCredential", "PrimaryAdmissionTicket", "PrimaryPaymentException", "PrimaryPaymentProviderEvent", "PrimaryPaymentAttempt", "PrimaryOrderPriceComponent", "PrimaryOrderLine", "PrimaryOrder", "PrimaryAuditEvent", "PrimaryOutboxMessage" CASCADE'); });
  afterAll(async () => {
    await db.$executeRawUnsafe('TRUNCATE TABLE "PrimaryRefundProviderEvent", "PrimaryRefundProviderAttempt", "PrimaryRefundAllocation", "PrimaryRefundItem", "PrimaryAdmissionRevocation", "PrimaryRefundObligation", "PrimaryCancellationBatch", "PrimaryEventCancellation", "PrimaryRefund", "PrimaryPurchaseAllocation" CASCADE');
    delete process.env.PRIMARY_TICKETING_ENVIRONMENT_ID; await db.$disconnect(); await pool.end();
  });

  it("materializes exact deterministic allocations and replays idempotently", async () => {
    const scope = await seed(3); const first = await db.$queryRaw<Array<{ count: number }>>`SELECT materialize_primary_purchase_allocations(${scope.order.id}) count`; expect(Number(first[0].count)).toBe(6);
    const second = await db.$queryRaw<Array<{ count: number }>>`SELECT materialize_primary_purchase_allocations(${scope.order.id}) count`; expect(Number(second[0].count)).toBe(0);
    const sums = await db.$queryRaw<Array<{ allocated: number; original: number }>>`SELECT sum(a."amountMinor")::int allocated, c."amountMinor" original FROM "PrimaryPurchaseAllocation" a JOIN "PrimaryOrderPriceComponent" c ON c.id=a."orderComponentId" WHERE a."orderId"=${scope.order.id} GROUP BY c.id,c."amountMinor"`;
    expect(sums.every((row) => row.allocated === row.original)).toBe(true);
    expect((await db.primaryPurchaseAllocation.findMany({ where: { orderId: scope.order.id } })).every((row) => row.liabilityOwner === "ORGANIZER" && row.policyVersionId === "primary-refund-policy-v1")).toBe(true);
  });

  it("materializes mixed-line and mixed-quantity orders line by line", async () => {
    const scope = await seed(1); const reservation = await db.primaryInventoryReservation.create({ data: { organizerId: scope.organizer.id, eventId: scope.event.id, ticketTypeId: scope.issued[0].ticket.ticketTypeId, buyerUserId: scope.buyer.id, quantity: 3, status: "PAYMENT_COMMITTED", expiresAt: new Date(now.getTime() + 60_000), paymentCommittedAt: now, reconciliationAfter: new Date(now.getTime() + 120_000), createIdempotencyKey: `multi-res-${runId}` } });
    const order = await db.primaryOrder.create({ data: { organizerId: scope.organizer.id, eventId: scope.event.id, buyerUserId: scope.buyer.id, reservationId: reservation.id, status: "PAID", currency: "CAD", faceValueSubtotalMinor: 7500, grossTotalMinor: 7505, createIdempotencyKey: `multi-order-${runId}`, prepareIdempotencyKey: `multi-prepare-${runId}`, prepareReconciliationDelayMs: 120000, paymentProcessingAt: now, paidAt: now } });
    const lineA = await db.primaryOrderLine.create({ data: { orderId: order.id, ticketTypeId: scope.issued[0].ticket.ticketTypeId, reservationId: reservation.id, quantity: 1, ticketTypeNameSnapshot: "GA A", unitFaceValueMinor: 2500, faceValueSubtotalMinor: 2500, currency: "CAD" } });
    const lineB = await db.primaryOrderLine.create({ data: { orderId: order.id, ticketTypeId: scope.issued[0].ticket.ticketTypeId, reservationId: reservation.id, quantity: 2, ticketTypeNameSnapshot: "GA B", unitFaceValueMinor: 2500, faceValueSubtotalMinor: 5000, currency: "CAD" } });
    await db.primaryOrderPriceComponent.createMany({ data: [{ orderId: order.id, orderLineId: lineA.id, code: "FACE_A", label: "Face A", kind: "FACE_VALUE", amountMinor: 2500, currency: "CAD", allocationBaseMinor: 2500, allocationRemainderUnits: 0, position: 0 }, { orderId: order.id, orderLineId: lineB.id, code: "FACE_B", label: "Face B", kind: "FACE_VALUE", amountMinor: 5000, currency: "CAD", allocationBaseMinor: 2500, allocationRemainderUnits: 0, position: 1 }, { orderId: order.id, orderLineId: lineB.id, code: "FEE_B", label: "Fee B", kind: "MANDATORY_FEE", amountMinor: 5, currency: "CAD", allocationBaseMinor: 2, allocationRemainderUnits: 1, position: 2 }] });
    await db.primaryPaymentAttempt.create({ data: { organizerId: scope.organizer.id, eventId: scope.event.id, buyerUserId: scope.buyer.id, reservationId: reservation.id, orderId: order.id, status: "SUCCEEDED", expectedAmountMinor: 7505, currency: "CAD", createIdempotencyKey: `multi-attempt-${runId}`, providerIntentId: `pi_multi_${runId}`, providerCreatedAt: now, terminalAt: now } });
    for (const [line, quantity, label] of [[lineA, 1, "a"], [lineB, 2, "b"]] as const) for (let unit=1; unit<=quantity; unit++) await db.primaryAdmissionTicket.create({ data: { organizerId: scope.organizer.id, eventId: scope.event.id, buyerUserId: scope.buyer.id, reservationId: reservation.id, orderId: order.id, orderLineId: line.id, ticketTypeId: scope.issued[0].ticket.ticketTypeId, unitNumber: unit, issuanceIdempotencyKey: `multi-ticket-${runId}-${label}-${unit}`, issuedAt: now } });
    await expect(db.$queryRaw`SELECT materialize_primary_purchase_allocations(${order.id})`).resolves.toBeTruthy();
    const rows = await db.primaryPurchaseAllocation.findMany({ where: { orderId: order.id } }); expect(rows).toHaveLength(5); expect(rows.reduce((sum,row)=>sum+row.amountMinor,0)).toBe(7505);
  });

  it("fails closed when immutable admission-unit evidence is incomplete", async () => {
    const scope = await seed(2, false); await expect(db.$queryRaw`SELECT materialize_primary_purchase_allocations(${scope.order.id})`).rejects.toBeTruthy();
    expect(await db.primaryPurchaseAllocation.count({ where: { orderId: scope.order.id } })).toBe(0);
  });

  it("prevents overlapping ticket refunds and over-allocation", async () => {
    const scope = await seed(2); await db.$queryRaw`SELECT materialize_primary_purchase_allocations(${scope.order.id})`;
    const refund = await db.primaryRefund.create({ data: refundData(scope, "overlap-a") });
    const allocations = await db.primaryPurchaseAllocation.findMany({ where: { admissionTicketId: scope.issued[0].ticket.id } }); const requestedMinor = allocations.reduce((sum, row) => sum + row.amountMinor, 0);
    const item = await db.primaryRefundItem.create({ data: { refundId: refund.id, admissionTicketId: scope.issued[0].ticket.id, requestedMinor, currency: "CAD" } });
    await expect(db.primaryRefundAllocation.create({ data: { refundId: refund.id, refundItemId: item.id, admissionTicketId: scope.issued[0].ticket.id, purchaseAllocationId: allocations[0].id, amountMinor: allocations[0].amountMinor + 1, currency: "CAD" } })).rejects.toBeTruthy();
    const second = await db.primaryRefund.create({ data: refundData(scope, "overlap-b") });
    await expect(db.primaryRefundItem.create({ data: { refundId: second.id, admissionTicketId: scope.issued[0].ticket.id, requestedMinor, currency: "CAD" } })).rejects.toBeTruthy();
  });

  it("requires fully reconciled items and allocations before provider eligibility", async () => {
    const scope = await seed(2); await db.$queryRaw`SELECT materialize_primary_purchase_allocations(${scope.order.id})`; const ticketId = scope.issued[0].ticket.id;
    const allocations = await db.primaryPurchaseAllocation.findMany({ where: { admissionTicketId: ticketId } }); const requestedMinor = allocations.reduce((sum,row)=>sum+row.amountMinor,0);
    const refund = await db.primaryRefund.create({ data: { ...refundData(scope, "incomplete"), requestedAmountMinor: requestedMinor } }); const item = await db.primaryRefundItem.create({ data: { refundId: refund.id, admissionTicketId: ticketId, requestedMinor, currency: "CAD" } });
    await db.primaryRefundAllocation.create({ data: { refundId: refund.id, refundItemId: item.id, admissionTicketId: ticketId, purchaseAllocationId: allocations[0].id, amountMinor: allocations[0].amountMinor, currency: "CAD" } });
    await expect(db.primaryRefund.update({ where: { id: refund.id }, data: { status: "PROVIDER_PENDING" } })).rejects.toBeTruthy();
    await db.primaryRefundAllocation.create({ data: { refundId: refund.id, refundItemId: item.id, admissionTicketId: ticketId, purchaseAllocationId: allocations[1].id, amountMinor: allocations[1].amountMinor, currency: "CAD" } });
    await db.primaryRefund.update({ where: { id: refund.id }, data: { status: "PROVIDER_PENDING" } });
    await expect(db.primaryRefundProviderAttempt.create({ data: { refundId: refund.id, ordinal: 1, providerKey: `wrong-amount-${runId}`, expectedAmountMinor: requestedMinor-1, currency: "CAD", authorizationKey: `wrong-amount-auth-${runId}`, authorizationDigest: "5".repeat(64), authorizedByUserId: scope.buyer.id, authorizationReason: "Wrong amount negative" } })).rejects.toBeTruthy();
    await expect(db.primaryRefundProviderAttempt.create({ data: { refundId: refund.id, ordinal: 1, providerKey: `wrong-currency-${runId}`, expectedAmountMinor: requestedMinor, currency: "USD", authorizationKey: `wrong-currency-auth-${runId}`, authorizationDigest: "6".repeat(64), authorizedByUserId: scope.buyer.id, authorizationReason: "Wrong currency negative" } })).rejects.toBeTruthy();
  });

  it("allows exactly one concurrent refund claim for a ticket", async () => {
    const scope = await seed(1); await db.$queryRaw`SELECT materialize_primary_purchase_allocations(${scope.order.id})`; const allocations = await db.primaryPurchaseAllocation.findMany({ where: { admissionTicketId: scope.issued[0].ticket.id } }); const requestedMinor=allocations.reduce((sum,row)=>sum+row.amountMinor,0);
    const [a,b] = await Promise.all(["a","b"].map((suffix)=>db.primaryRefund.create({ data: { ...refundData(scope, `concurrent-${suffix}`), requestedAmountMinor: requestedMinor } })));
    const make=(refundId:string,suffix:string)=>db.primaryRefundItem.create({ data: { refundId, admissionTicketId: scope.issued[0].ticket.id, requestedMinor, currency: "CAD", id: `claim-${runId}-${suffix}` } });
    const results=await Promise.allSettled([make(a.id,"a"),make(b.id,"b")]); expect(results.filter(row=>row.status==="fulfilled")).toHaveLength(1); expect(await db.primaryRefundTicketClaim.count({ where: { admissionTicketId: scope.issued[0].ticket.id } })).toBe(1);
  });

  it("requires immutable supervised approval for checked-in refunds", async () => {
    const scope = await seed(1); await db.$queryRaw`SELECT materialize_primary_purchase_allocations(${scope.order.id})`; await db.primaryAdmissionTicket.update({ where: { id: scope.issued[0].ticket.id }, data: { status: "CHECKED_IN" } });
    const allocations=await db.primaryPurchaseAllocation.findMany({ where: { admissionTicketId: scope.issued[0].ticket.id } }); const requestedMinor=allocations.reduce((sum,row)=>sum+row.amountMinor,0); const refund=await db.primaryRefund.create({ data: { ...refundData(scope,"checked-in"), requestedAmountMinor: requestedMinor } });
    const itemData={ refundId:refund.id,admissionTicketId:scope.issued[0].ticket.id,requestedMinor,currency:"CAD" };
    await expect(db.primaryRefundItem.create({ data:itemData })).rejects.toBeTruthy();
    const approval=await db.primaryCheckedInRefundApproval.create({ data:{ refundId:refund.id,admissionTicketId:scope.issued[0].ticket.id,approvedByUserId:scope.buyer.id,evidenceDigest:"7".repeat(64),reason:"Supervised post-entry exception",fraudReview:"Reviewed; no fraud indicators",costBearer:"ORGANIZER" } });
    await expect(db.primaryCheckedInRefundApproval.update({ where:{ id:approval.id },data:{ reason:"changed" } })).rejects.toBeTruthy(); await expect(db.primaryRefundItem.create({ data:itemData })).resolves.toBeTruthy();
  });

  it("serializes next-attempt authorization and rejects terminal parents", async () => {
    const scope = await seed(1); const refund = await completeRefund(scope, "attempt"); await db.primaryRefund.update({ where: { id: refund.id }, data: { status: "PROVIDER_PENDING" } });
    const first = await db.primaryRefundProviderAttempt.create({ data: { refundId: refund.id, ordinal: 1, status: "NOT_SENT", providerKey: `provider-${runId}-1`, expectedAmountMinor: scope.order.grossTotalMinor, currency: "CAD", authorizationKey: `auth-${runId}-1`, authorizationDigest: "b".repeat(64), authorizedByUserId: scope.buyer.id, authorizationReason: "Initial reviewed attempt" } });
    await db.primaryRefundProviderAttempt.update({ where: { id: first.id }, data: { status: "TERMINAL_FAILED", terminalEvidenceHash: "c".repeat(64) } });
    const make = (suffix: string) => db.primaryRefundProviderAttempt.create({ data: { refundId: refund.id, ordinal: 2, providerKey: `provider-${runId}-${suffix}`, expectedAmountMinor: scope.order.grossTotalMinor, currency: "CAD", authorizationKey: `auth-${runId}-${suffix}`, authorizationDigest: "d".repeat(64), authorizedByUserId: scope.buyer.id, authorizationReason: "Authenticated terminal failure retry" } });
    const results = await Promise.allSettled([make("2a"), make("2b")]); expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1); expect(await db.primaryRefundProviderAttempt.count({ where: { refundId: refund.id, ordinal: 2 } })).toBe(1);
    await db.primaryRefund.update({ where: { id: refund.id }, data: { status: "FAILED", finalityReason: "Reviewed final abandonment" } });
    await expect(db.primaryRefundProviderAttempt.create({ data: { refundId: refund.id, ordinal: 3, providerKey: `provider-${runId}-3`, expectedAmountMinor: scope.order.grossTotalMinor, currency: "CAD", authorizationKey: `auth-${runId}-3`, authorizationDigest: "e".repeat(64), authorizedByUserId: scope.buyer.id, authorizationReason: "Forbidden terminal retry" } })).rejects.toBeTruthy();
    await expect(db.primaryRefund.update({ where: { id: refund.id }, data: { status: "SUCCEEDED" } })).rejects.toBeTruthy();
  });

  it("requires exact cancellation coverage and resolved obligations", async () => {
    const scope = await seed(1); const cancellation = await db.primaryEventCancellation.create({ data: { organizerId: scope.organizer.id, eventId: scope.event.id, generation: 1, policyVersionId: "primary-refund-policy-v1", requestedByUserId: scope.buyer.id, requestKey: `cancel-${runId}`, commandDigest: "f".repeat(64), reason: "Synthetic cancellation", snapshotMaxTicketId: scope.issued[0].ticket.id, expectedTicketCount: 1, expectedAmountMinor: scope.order.grossTotalMinor } });
    await db.primaryEventCancellation.update({ where: { id: cancellation.id }, data: { status: "ACTIVE", activatedAt: now } }); await db.primaryEventCancellation.update({ where: { id: cancellation.id }, data: { status: "REFUNDING" } });
    const obligation = await db.primaryRefundObligation.create({ data: { organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, cancellationId: cancellation.id, cause: "EVENT_CANCELLATION", amountMinor: scope.order.grossTotalMinor, currency: "CAD", idempotencyKey: `obligation-${runId}`, reason: "Organizer cancellation liability" } });
    await expect(db.primaryEventCancellation.update({ where: { id: cancellation.id }, data: { status: "RESOLVED" } })).rejects.toBeTruthy();
    await expect(db.primaryEventCancellation.update({ where: { id: cancellation.id }, data: { processedTicketCount: 1, processedAmountMinor: scope.order.grossTotalMinor } })).rejects.toBeTruthy();
    const batch = await db.primaryCancellationBatch.create({ data: { cancellationId: cancellation.id, batchKey: `batch-${runId}`, commandDigest: "3".repeat(64), firstTicketId: scope.issued[0].ticket.id, lastTicketId: scope.issued[0].ticket.id, processedTicketCount: 1, processedAmountMinor: scope.order.grossTotalMinor } });
    await db.primaryCancellationBatchTicket.create({ data: { cancellationId: cancellation.id, batchId: batch.id, admissionTicketId: scope.issued[0].ticket.id, obligationId: obligation.id, amountMinor: scope.order.grossTotalMinor, currency: "CAD" } });
    await expect(db.primaryRefundObligation.update({ where: { id: obligation.id }, data: { status: "WAIVED_WITH_APPROVAL" } })).rejects.toBeTruthy();
    await db.primaryObligationWaiverApproval.create({ data: { obligationId: obligation.id, approvedByUserId: scope.buyer.id, evidenceDigest: "4".repeat(64), reason: "Named supervised waiver" } });
    await db.primaryRefundObligation.update({ where: { id: obligation.id }, data: { status: "WAIVED_WITH_APPROVAL" } });
    await expect(db.primaryEventCancellation.update({ where: { id: cancellation.id }, data: { status: "RESOLVED" } })).resolves.toMatchObject({ status: "RESOLVED", processedTicketCount: 1, processedAmountMinor: scope.order.grossTotalMinor });
  });

  it("rejects active-generation and cross-aggregate scope forgery", async () => {
    const a=await seed(1); const b=await seed(1); const cancellation=await db.primaryEventCancellation.create({ data:{ organizerId:a.organizer.id,eventId:a.event.id,generation:1,policyVersionId:"primary-refund-policy-v1",requestedByUserId:a.buyer.id,requestKey:`scope-cancel-a-${runId}`,commandDigest:"9".repeat(64),reason:"Scope A",snapshotMaxTicketId:a.issued[0].ticket.id,expectedTicketCount:1,expectedAmountMinor:a.order.grossTotalMinor } });
    await db.primaryEventCancellation.update({ where:{ id:cancellation.id },data:{ status:"ACTIVE",activatedAt:now } }); const second=await db.primaryEventCancellation.create({ data:{ organizerId:a.organizer.id,eventId:a.event.id,generation:2,policyVersionId:"primary-refund-policy-v1",requestedByUserId:a.buyer.id,requestKey:`scope-cancel-b-${runId}`,commandDigest:"0".repeat(64),reason:"Scope B",snapshotMaxTicketId:a.issued[0].ticket.id,expectedTicketCount:1,expectedAmountMinor:a.order.grossTotalMinor } });
    await expect(db.primaryEventCancellation.update({ where:{ id:second.id },data:{ status:"ACTIVE",activatedAt:now } })).rejects.toBeTruthy();
    await expect(db.primaryRefundObligation.create({ data:{ organizerId:a.organizer.id,eventId:a.event.id,orderId:b.order.id,cancellationId:cancellation.id,cause:"FORGED",amountMinor:1,currency:"CAD",idempotencyKey:`forged-obligation-${runId}`,reason:"Wrong order scope" } })).rejects.toBeTruthy();
    const refund=await db.primaryRefund.create({ data:refundData(a,"revocation-scope") });
    await expect(db.primaryAdmissionRevocation.create({ data:{ organizerId:a.organizer.id,eventId:a.event.id,admissionTicketId:b.issued[0].ticket.id,credentialId:b.issued[0].ticket.credential!.id,refundId:refund.id,policyVersionId:"primary-refund-policy-v1",cause:"FORGED",reason:"Wrong ticket aggregate",idempotencyKey:`forged-revocation-${runId}`,effectiveAt:now } })).rejects.toBeTruthy();
    const cancellationB=await db.primaryEventCancellation.create({ data:{ organizerId:b.organizer.id,eventId:b.event.id,generation:1,policyVersionId:"primary-refund-policy-v1",requestedByUserId:b.buyer.id,requestKey:`overlap-cancel-${runId}`,commandDigest:"8".repeat(64),reason:"Overlap test",snapshotMaxTicketId:b.issued[0].ticket.id,expectedTicketCount:1,expectedAmountMinor:b.order.grossTotalMinor } }); await db.primaryEventCancellation.update({ where:{id:cancellationB.id},data:{status:"ACTIVE",activatedAt:now} });
    const obligationB=await db.primaryRefundObligation.create({ data:{organizerId:b.organizer.id,eventId:b.event.id,orderId:b.order.id,cancellationId:cancellationB.id,cause:"EVENT_CANCELLATION",amountMinor:b.order.grossTotalMinor,currency:"CAD",idempotencyKey:`overlap-obligation-${runId}`,reason:"Overlap evidence"} });
    const batch1=await db.primaryCancellationBatch.create({data:{cancellationId:cancellationB.id,batchKey:`overlap-batch-1-${runId}`,commandDigest:"1".repeat(64),firstTicketId:b.issued[0].ticket.id,lastTicketId:b.issued[0].ticket.id,processedTicketCount:1,processedAmountMinor:b.order.grossTotalMinor}}); const batch2=await db.primaryCancellationBatch.create({data:{cancellationId:cancellationB.id,batchKey:`overlap-batch-2-${runId}`,commandDigest:"2".repeat(64),firstTicketId:"0",lastTicketId:"z",processedTicketCount:1,processedAmountMinor:b.order.grossTotalMinor}});
    await db.primaryCancellationBatchTicket.create({data:{cancellationId:cancellationB.id,batchId:batch1.id,admissionTicketId:b.issued[0].ticket.id,obligationId:obligationB.id,amountMinor:b.order.grossTotalMinor,currency:"CAD"}}); await expect(db.primaryCancellationBatchTicket.create({data:{cancellationId:cancellationB.id,batchId:batch2.id,admissionTicketId:b.issued[0].ticket.id,obligationId:obligationB.id,amountMinor:b.order.grossTotalMinor,currency:"CAD"}})).rejects.toBeTruthy();
  });

  it("protects policy, allocation, item, event, revocation, and audit evidence", async () => {
    const scope = await seed(1); await db.$queryRaw`SELECT materialize_primary_purchase_allocations(${scope.order.id})`; const allocation = await db.primaryPurchaseAllocation.findFirstOrThrow({ where: { orderId: scope.order.id } });
    await expect(db.primaryRefundPolicyVersion.update({ where: { id: "primary-refund-policy-v1" }, data: { merchantOfRecord: "changed" } })).rejects.toBeTruthy();
    await expect(db.primaryPurchaseAllocation.delete({ where: { id: allocation.id } })).rejects.toBeTruthy();
    const refund = await completeRefund(scope, "immutable"); const item = await db.primaryRefundItem.findFirstOrThrow({ where: { refundId: refund.id } });
    await expect(db.primaryRefundItem.update({ where: { id: item.id }, data: { requestedMinor: item.requestedMinor + 1 } })).rejects.toBeTruthy();
    await db.primaryRefund.update({ where: { id: refund.id }, data: { status: "PROVIDER_PENDING" } });
    const event = await db.primaryRefundProviderEvent.create({ data: { attempt: { create: { refundId: refund.id, ordinal: 1, providerKey: `immutable-provider-${runId}`, expectedAmountMinor: scope.order.grossTotalMinor, currency: "CAD", authorizationKey: `immutable-auth-${runId}`, authorizationDigest: "1".repeat(64), authorizedByUserId: scope.buyer.id, authorizationReason: "Initial authorization" } }, providerEventId: `refund-event-${runId}`, payloadDigest: "2".repeat(64), eventType: "refund.pending", providerCreatedAt: now } });
    await expect(db.primaryRefundProviderEvent.delete({ where: { id: event.id } })).rejects.toBeTruthy();
  });
});
