/** @jest-environment node */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  getPrimaryStagingRefundState,
  PrimaryStagingRefundError,
  recordPrimaryStagingRefundRejection,
  reseedPrimaryStagingRefundScenario,
  runPrimaryStagingRefundAction,
} from "@/lib/primary/staging-refund-console";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) describe.skip("primary staging refund console PostgreSQL integration", () => {
  it("requires an isolated database", () => undefined);
}); else describe("primary staging refund console PostgreSQL integration", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const now = new Date("2037-02-01T12:00:00Z");
  const organizer = { id: "staging-refund-organizer-user", email: "organizer@primary-staging.example.invalid", role: "USER" as const };
  const admin = { id: "staging-refund-admin-user", email: "admin@primary-staging.example.invalid", role: "ADMIN" as const };
  const outsider = { id: "staging-refund-outsider-user", email: "outsider@primary-staging.example.invalid", role: "USER" as const };

  beforeAll(async () => {
    await db.$executeRawUnsafe('TRUNCATE TABLE "PrimaryAuditEvent", "PrimaryOutboxMessage", "PrimaryRefundProviderEvent", "PrimaryRefundProviderAttempt", "PrimaryRefundAllocation", "PrimaryRefundItem", "PrimaryAdmissionRevocation", "PrimaryRefundObligation", "PrimaryCancellationBatch", "PrimaryEventCancellation", "PrimaryRefund", "PrimaryPurchaseAllocation", "PrimaryAdmissionScan", "PrimaryAdmissionCredential", "PrimaryAdmissionTicket", "PrimaryPaymentException", "PrimaryPaymentProviderEvent", "PrimaryPaymentAttempt", "PrimaryOrderPriceComponent", "PrimaryOrderLine", "PrimaryOrder", "PrimaryInventoryReservation", "PrimaryTicketType", "PrimaryEvent", "PrimaryOrganizerMembership", "PrimaryOrganizer" CASCADE');
    for (const [index, user] of [organizer, admin, outsider].entries()) await db.user.upsert({ where: { email: user.email }, create: { id: user.id, email: user.email, passwordHash: "synthetic", emailVerifiedAt: now, firstName: "Staging", lastName: user.role, phone: `+1555000100${index + 1}`, phoneVerifiedAt: now, streetAddress1: "1 Synthetic Way", city: "Toronto", region: "ON", postalCode: "M5V 0A1", country: "CA", role: user.role }, update: { id: user.id, role: user.role, isBanned: false, emailVerifiedAt: now, phoneVerifiedAt: now } });
  });

  afterAll(async () => {
    await db.$executeRawUnsafe('TRUNCATE TABLE "PrimaryAuditEvent", "PrimaryOutboxMessage", "PrimaryRefundProviderEvent", "PrimaryRefundProviderAttempt", "PrimaryRefundAllocation", "PrimaryRefundItem", "PrimaryAdmissionRevocation", "PrimaryRefundObligation", "PrimaryCancellationBatch", "PrimaryEventCancellation", "PrimaryRefund", "PrimaryPurchaseAllocation", "PrimaryAdmissionScan", "PrimaryAdmissionCredential", "PrimaryAdmissionTicket", "PrimaryPaymentException", "PrimaryPaymentProviderEvent", "PrimaryPaymentAttempt", "PrimaryOrderPriceComponent", "PrimaryOrderLine", "PrimaryOrder", "PrimaryInventoryReservation", "PrimaryTicketType", "PrimaryEvent", "PrimaryOrganizerMembership", "PrimaryOrganizer" CASCADE');
    await db.$disconnect(); await pool.end();
  });

  it("seeds deterministic isolated orders and permits only one concurrent ordinary refund", async () => {
    await expect(reseedPrimaryStagingRefundScenario(db, admin)).resolves.toEqual({ generation: 1 });
    const initial = await getPrimaryStagingRefundState(db);
    expect(initial?.events).toHaveLength(3);
    expect(initial?.events.flatMap((event) => event.orders.flatMap((order) => order.admissionTickets.map((ticket) => ticket.status))).sort()).toEqual(["CHECKED_IN", "CHECKED_IN", "ISSUED", "ISSUED"]);
    const allocations = initial?.events.flatMap((event) => event.orders.flatMap((order) => order.admissionTickets.map((ticket) => ({
      amounts: ticket.purchaseAllocations.map((allocation) => allocation.amountMinor),
      total: ticket.purchaseAllocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0),
      digests: new Set(ticket.purchaseAllocations.map((allocation) => allocation.allocationSetDigest)).size,
      validDigests: ticket.purchaseAllocations.every((allocation) => /^[0-9a-f]{64}$/.test(allocation.allocationSetDigest)),
    }))));
    expect(allocations).toEqual([
      { amounts: [2000, 100], total: 2100, digests: 2, validDigests: true },
      { amounts: [2000, 100], total: 2100, digests: 2, validDigests: true },
      { amounts: [3000, 120], total: 3120, digests: 2, validDigests: true },
      { amounts: [2500, 100], total: 2600, digests: 2, validDigests: true },
    ]);

    const outcomes = await Promise.allSettled([
      runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {}),
      runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {}),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(outcomes.find((item) => item.status === "rejected")).toMatchObject({ reason: { code: "STAGING_REFUND_CONCURRENT_CONFLICT" } });
    const state = await getPrimaryStagingRefundState(db);
    const ordinary = state?.events.find((event) => event.id.includes("-ordinary-"));
    expect(ordinary?.orders[0].admissionTickets[0]).toMatchObject({ status: "VOIDED", refundItems: [{ refund: { status: "SUCCEEDED", attempts: [{ status: "SUCCEEDED" }] } }] });
    expect(ordinary?.orders[0].admissionTickets[0].refundItems[0].refund.attempts[0]).toMatchObject({
      ordinal: 1,
      expectedAmountMinor: 2600,
      currency: "CAD",
      providerEvents: [{ eventType: "synthetic.refund.succeeded", payloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/) }],
    });
  });

  it("requires complete scoped supervisor evidence for a checked-in refund", async () => {
    await runPrimaryStagingRefundAction(db, organizer, "requestCheckedRefund", {});
    await expect(runPrimaryStagingRefundAction(db, organizer, "requestCheckedRefund", {})).rejects.toEqual(expect.objectContaining({ code: "CHECKED_REFUND_ALREADY_REQUESTED" }));
    await expect(db.primaryAuditEvent.count({ where: { action: "STAGING_CHECKED_REFUND_REQUESTED" } })).resolves.toBe(1);
    const requestedState = await getPrimaryStagingRefundState(db);
    const checkedScenario = requestedState?.events.find((event) => event.id.includes("-checked-"));
    const checkedTicket = checkedScenario?.orders[0].admissionTickets[0];
    expect(checkedScenario).toMatchObject({
      refunds: [{ status: "REQUESTED", requestedAmountMinor: 3120, currency: "CAD", checkedInApprovals: [] }],
      orders: [{ admissionTickets: [{ refundItems: [] }] }],
    });
    const checkedRefund = await db.primaryRefund.findFirstOrThrow({ where: { eventId: { contains: "-checked-" } } });
    await expect(db.primaryCheckedInRefundApproval.create({ data: { refundId: checkedRefund.id, admissionTicketId: checkedTicket!.id, approvedByUserId: outsider.id, evidenceDigest: "f".repeat(64), reason: "Forged approval", fraudReview: "Skipped", costBearer: "ORGANIZER" } })).rejects.toThrow("Checked-in approval requires an authorized scoped supervisor");
    await expect(db.primaryRefundItem.create({ data: { refundId: checkedRefund.id, admissionTicketId: checkedTicket!.id, requestedMinor: checkedRefund.requestedAmountMinor, currency: "CAD" } })).rejects.toThrow("Checked-in refund requires immutable supervised approval");
    await expect(runPrimaryStagingRefundAction(db, organizer, "approveCheckedRefund", { reason: "invalid", evidence: "invalid", fraudReview: "invalid" })).rejects.toEqual(expect.objectContaining({ code: "STAGING_ADMIN_REQUIRED" }));
    await expect(runPrimaryStagingRefundAction(db, admin, "approveCheckedRefund", { reason: "", evidence: "case", fraudReview: "clear" })).rejects.toEqual(expect.objectContaining({ code: "SUPERVISOR_REASON_REQUIRED" }));
    await runPrimaryStagingRefundAction(db, admin, "approveCheckedRefund", { reason: "Scoped approval", evidence: "case-001", fraudReview: "No indicators", costBearer: "ORGANIZER" });
    await runPrimaryStagingRefundAction(db, organizer, "completeCheckedRefund", {});
    const state = await getPrimaryStagingRefundState(db); const checked = state?.events.find((event) => event.id.includes("-checked-"));
    expect(checked?.orders[0].admissionTickets[0]).toMatchObject({ status: "CHECKED_IN", refundItems: [{ refund: { status: "SUCCEEDED", checkedInApprovals: [{ reason: "Scoped approval", fraudReview: "No indicators", costBearer: "ORGANIZER" }] } }], revocations: [{ cause: "REFUND" }] });
  });

  it("derives the cancellation snapshot and requires waiver evidence before exact resolution", async () => {
    const cancellationEvent = await db.primaryEvent.findFirstOrThrow({ where: { id: { contains: "-cancellation-event" } } });
    await expect(db.primaryEventCancellation.create({ data: { organizerId: cancellationEvent.organizerId, eventId: cancellationEvent.id, generation: 1, status: "ACTIVE", policyVersionId: "primary-refund-policy-v1", requestedByUserId: organizer.id, requestKey: "forged-active-cancellation", commandDigest: "d".repeat(64), reason: "Forged active cancellation.", snapshotMaxTicketId: "forged", expectedTicketCount: 0, expectedAmountMinor: 0, activatedAt: now } })).rejects.toThrow("Event cancellation must begin in REQUESTED");
    const active = await runPrimaryStagingRefundAction(db, organizer, "activateCancellation", {});
    expect(active).toMatchObject({ status: "ACTIVE", expectedTicketCount: 2, expectedAmountMinor: 4200 });
    const cancellationTicket = await db.primaryAdmissionTicket.findFirstOrThrow({ where: { eventId: { contains: "-cancellation-" }, status: "ISSUED" } });
    await expect(db.primaryAdmissionTicket.update({ where: { id: cancellationTicket.id }, data: { status: "CHECKED_IN" } })).rejects.toThrow("Admission is blocked by event cancellation");
    const cancellationCredential = await db.primaryAdmissionCredential.findUniqueOrThrow({ where: { admissionTicketId: cancellationTicket.id } });
    await expect(db.primaryAdmissionScan.create({ data: { requestId: "forged-cancelled-accept", commandDigest: "a".repeat(64), organizerId: active.organizerId, eventId: active.eventId, admissionTicketId: cancellationTicket.id, credentialId: cancellationCredential.id, operatorUserId: organizer.id, result: "ACCEPTED", scannedAt: now } })).rejects.toThrow("Admission is blocked by event cancellation");
    await expect(db.primaryAdmissionScan.create({ data: { requestId: "cancelled-admission-rejection", commandDigest: "b".repeat(64), organizerId: active.organizerId, eventId: active.eventId, admissionTicketId: cancellationTicket.id, credentialId: cancellationCredential.id, operatorUserId: organizer.id, result: "VOIDED", scannedAt: now } })).resolves.toMatchObject({ result: "VOIDED", admissionTicketId: cancellationTicket.id });
    await expect(db.primaryEventCancellation.update({ where: { id: active.id }, data: { expectedAmountMinor: 1 } })).rejects.toThrow("Cancellation snapshot is immutable");
    await runPrimaryStagingRefundAction(db, organizer, "prepareCancellation", {});
    const preparedRefund = await db.primaryRefund.findFirstOrThrow({ where: { eventId: active.eventId } });
    const preparedObligation = await db.primaryRefundObligation.findFirstOrThrow({ where: { cancellationId: active.id, refundId: preparedRefund.id } });
    await expect(db.primaryRefund.update({ where: { id: preparedRefund.id }, data: { status: "PROVIDER_PENDING" } })).resolves.toMatchObject({ status: "PROVIDER_PENDING" });
    await expect(db.primaryRefund.update({ where: { id: preparedRefund.id }, data: { status: "SUCCEEDED" } })).rejects.toThrow("Successful refund requires exact successful attempt evidence");
    await expect(db.primaryRefundObligation.update({ where: { id: preparedObligation.id }, data: { status: "REFUND_LINKED" } })).resolves.toMatchObject({ status: "REFUND_LINKED" });
    await expect(db.primaryRefundObligation.update({ where: { id: preparedObligation.id }, data: { status: "SATISFIED" } })).rejects.toThrow("Satisfied obligation requires exact successful refund evidence");
    await expect(runPrimaryStagingRefundAction(db, organizer, "completeCancellation", {})).rejects.toEqual(expect.objectContaining({ code: "CANCELLATION_WAIVER_REQUIRED" }));
    await expect(db.primaryEventCancellation.update({ where: { id: active.id }, data: { status: "RESOLVED" } })).rejects.toThrow("Cancellation");
    await runPrimaryStagingRefundAction(db, admin, "approveCancellationWaiver", { reason: "Checked-in attendee waiver", evidence: "waiver-case-001" });
    const resolved = await runPrimaryStagingRefundAction(db, organizer, "completeCancellation", {});
    expect(resolved).toMatchObject({ status: "RESOLVED", processedTicketCount: 2, processedAmountMinor: 4200 });
    const state = await getPrimaryStagingRefundState(db); const cancellation = state?.events.find((event) => event.id.includes("-cancellation-"))?.cancellations[0];
    expect(cancellation).toMatchObject({ status: "RESOLVED", refundLinks: [{ refundId: expect.any(String) }], batches: [{ processedTicketCount: 2, processedAmountMinor: 4200 }] });
    expect(cancellation?.obligations.map((item) => item.status).sort()).toEqual(["SATISFIED", "WAIVED_WITH_APPROVAL"]);
    expect(cancellation?.snapshotTickets).toHaveLength(2);
    await expect(db.primaryCancellationSnapshotTicket.update({ where: { cancellationId_admissionTicketId: { cancellationId: active.id, admissionTicketId: cancellation!.snapshotTickets[0].admissionTicketId } }, data: { amountMinor: 1 } })).rejects.toThrow("Cancellation snapshot evidence is immutable");
  });

  it("returns stable workflow-order and replay rejections with scenario-scoped audit evidence", async () => {
    const seeded = await reseedPrimaryStagingRefundScenario(db, admin);
    const approval = { reason: "Scoped approval", evidence: "case-002", fraudReview: "No indicators", costBearer: "ORGANIZER" };
    const waiverApproval = { reason: approval.reason, evidence: approval.evidence };

    await expect(runPrimaryStagingRefundAction(db, admin, "approveCheckedRefund", approval)).rejects.toMatchObject({ code: "CHECKED_REFUND_REQUEST_REQUIRED" });
    await expect(runPrimaryStagingRefundAction(db, organizer, "completeCheckedRefund", {})).rejects.toMatchObject({ code: "CHECKED_REFUND_REQUEST_REQUIRED" });
    await runPrimaryStagingRefundAction(db, organizer, "requestCheckedRefund", {});
    await expect(runPrimaryStagingRefundAction(db, organizer, "completeCheckedRefund", {})).rejects.toMatchObject({ code: "CHECKED_REFUND_APPROVAL_REQUIRED" });
    await runPrimaryStagingRefundAction(db, admin, "approveCheckedRefund", approval);
    await expect(runPrimaryStagingRefundAction(db, admin, "approveCheckedRefund", approval)).rejects.toMatchObject({ code: "CHECKED_REFUND_ALREADY_APPROVED" });
    await runPrimaryStagingRefundAction(db, organizer, "completeCheckedRefund", {});
    await expect(runPrimaryStagingRefundAction(db, organizer, "completeCheckedRefund", {})).rejects.toMatchObject({ code: "CHECKED_REFUND_ALREADY_COMPLETED" });

    await expect(runPrimaryStagingRefundAction(db, organizer, "prepareCancellation", {})).rejects.toMatchObject({ code: "CANCELLATION_ACTIVATION_REQUIRED" });
    await expect(runPrimaryStagingRefundAction(db, organizer, "completeCancellation", {})).rejects.toMatchObject({ code: "CANCELLATION_ACTIVATION_REQUIRED" });
    await runPrimaryStagingRefundAction(db, organizer, "activateCancellation", {});
    await expect(runPrimaryStagingRefundAction(db, organizer, "activateCancellation", {})).rejects.toMatchObject({ code: "CANCELLATION_ALREADY_ACTIVATED" });
    await expect(runPrimaryStagingRefundAction(db, admin, "approveCancellationWaiver", waiverApproval)).rejects.toMatchObject({ code: "CANCELLATION_PREPARATION_REQUIRED" });
    await expect(runPrimaryStagingRefundAction(db, organizer, "completeCancellation", {})).rejects.toMatchObject({ code: "CANCELLATION_PREPARATION_REQUIRED" });
    await runPrimaryStagingRefundAction(db, organizer, "prepareCancellation", {});
    await expect(runPrimaryStagingRefundAction(db, organizer, "prepareCancellation", {})).rejects.toMatchObject({ code: "CANCELLATION_ALREADY_PREPARED" });
    await expect(runPrimaryStagingRefundAction(db, organizer, "completeCancellation", {})).rejects.toMatchObject({ code: "CANCELLATION_WAIVER_REQUIRED" });
    await runPrimaryStagingRefundAction(db, admin, "approveCancellationWaiver", waiverApproval);
    await expect(runPrimaryStagingRefundAction(db, admin, "approveCancellationWaiver", waiverApproval)).rejects.toMatchObject({ code: "CANCELLATION_WAIVER_ALREADY_APPROVED" });
    await runPrimaryStagingRefundAction(db, organizer, "completeCancellation", {});
    await expect(runPrimaryStagingRefundAction(db, organizer, "completeCancellation", {})).rejects.toMatchObject({ code: "CANCELLATION_ALREADY_RESOLVED" });

    await recordPrimaryStagingRefundRejection(db, admin, "approveCheckedRefund", "CHECKED_REFUND_ALREADY_APPROVED");
    await expect(db.primaryAuditEvent.findFirstOrThrow({
      where: { action: "STAGING_REFUND_ACTION_REJECTED", targetId: "approveCheckedRefund", reason: "CHECKED_REFUND_ALREADY_APPROVED" },
      orderBy: { createdAt: "desc" },
      include: { actor: { select: { email: true } } },
    })).resolves.toMatchObject({
      eventId: `staging-refund-g${seeded.generation}-checked-event`,
      afterJson: { status: "REJECTED", code: "CHECKED_REFUND_ALREADY_APPROVED", scenario: "checked", generation: seeded.generation },
      actor: { email: admin.email },
    });
  });

  it("serializes cancellation activation ahead of a concurrent admission transition", async () => {
    const seeded = await reseedPrimaryStagingRefundScenario(db, admin);
    const event = await db.primaryEvent.findUniqueOrThrow({ where: { id: `staging-refund-g${seeded.generation}-cancellation-event` } });
    const ticket = await db.primaryAdmissionTicket.findFirstOrThrow({ where: { eventId: event.id, status: "ISSUED" } });
    const cancellation = await db.primaryEventCancellation.create({ data: {
      organizerId: event.organizerId,
      eventId: event.id,
      generation: 1,
      policyVersionId: "primary-refund-policy-v1",
      requestedByUserId: organizer.id,
      requestKey: `concurrent-cancellation:${seeded.generation}`,
      commandDigest: "c".repeat(64),
      reason: "Synthetic cancellation concurrency proof.",
      snapshotMaxTicketId: "derived-on-activation",
      expectedTicketCount: 0,
      expectedAmountMinor: 0,
    } });
    const activationClient = await pool.connect();
    const admissionClient = await pool.connect();
    let activationCommitted = false;
    try {
      await activationClient.query("BEGIN");
      await activationClient.query('UPDATE "PrimaryEventCancellation" SET status=\'ACTIVE\', "activatedAt"=now(), "updatedAt"=now() WHERE id=$1', [cancellation.id]);
      const admissionAttempt = admissionClient.query('UPDATE "PrimaryAdmissionTicket" SET status=\'CHECKED_IN\', "updatedAt"=now() WHERE id=$1', [ticket.id]);
      const stateBeforeCommit = await Promise.race([
        admissionAttempt.then(() => "completed"),
        new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 100)),
      ]);
      expect(stateBeforeCommit).toBe("blocked");
      await activationClient.query("COMMIT");
      activationCommitted = true;
      await expect(admissionAttempt).rejects.toThrow("Admission is blocked by event cancellation");
    } finally {
      if (!activationCommitted) await activationClient.query("ROLLBACK").catch(() => undefined);
      activationClient.release();
      admissionClient.release();
    }
    await expect(db.primaryAdmissionTicket.findUniqueOrThrow({ where: { id: ticket.id } })).resolves.toMatchObject({ status: "ISSUED" });
  });

  it("serializes concurrent repeatable reseeds into distinct immutable generations", async () => {
    const before = await getPrimaryStagingRefundState(db);
    const outcomes = await Promise.all([
      reseedPrimaryStagingRefundScenario(db, admin),
      reseedPrimaryStagingRefundScenario(db, admin),
    ]);
    expect(outcomes.map((item) => item.generation).sort()).toEqual([before!.generation + 1, before!.generation + 2]);
    await expect(getPrimaryStagingRefundState(db)).resolves.toMatchObject({ generation: before!.generation + 2 });
  });

  it("derives reseed generations only from the reserved synthetic organizer", async () => {
    const before = await getPrimaryStagingRefundState(db);
    await db.primaryOrganizer.create({ data: {
      id: "unrelated-staging-refund-organizer", legalName: "Unrelated Synthetic Tenant Inc.", displayName: "Unrelated Synthetic Tenant",
      addressLine1: "2 Synthetic Way", city: "Toronto", region: "ON", postalCode: "M5V 0A2", country: "CA",
      supportEmail: "unrelated@primary-staging.example.invalid", status: "APPROVED", submittedAt: now, approvedAt: now,
      approvedByUserId: admin.id, createdByUserId: outsider.id,
    } });
    await db.primaryEvent.create({ data: {
      id: "staging-refund-g999999-ordinary-event", organizerId: "unrelated-staging-refund-organizer", title: "Unrelated matching identifier",
      description: "Adversarial tenant-scope fixture.", category: "SYNTHETIC", venueName: "Unrelated Hall",
      venueAddressLine1: "2 Synthetic Way", venueCity: "Toronto", venueRegion: "ON", venuePostalCode: "M5V 0A2", venueCountry: "CA",
      startsAtLocal: new Date("2038-06-15T19:00:00Z"), endsAtLocal: new Date("2038-06-15T22:00:00Z"), timezone: "America/Toronto",
      contactEmail: "unrelated@primary-staging.example.invalid", draftPolicyText: "Unrelated synthetic policy.", totalCapacity: 1,
      status: "APPROVED", submittedAt: now, approvedAt: now, approvedByUserId: admin.id,
    } });

    await expect(reseedPrimaryStagingRefundScenario(db, admin)).resolves.toEqual({ generation: before!.generation + 1 });
    await expect(getPrimaryStagingRefundState(db)).resolves.toMatchObject({ generation: before!.generation + 1 });
  });

  it("keeps delayed rejection evidence attached to the attempted generation", async () => {
    const attempted = await reseedPrimaryStagingRefundScenario(db, admin);
    const rejection = await runPrimaryStagingRefundAction(db, organizer, "completeCheckedRefund", {}).catch((error: unknown) => error);
    expect(rejection).toMatchObject({ code: "CHECKED_REFUND_REQUEST_REQUIRED", generation: attempted.generation });

    const latest = await reseedPrimaryStagingRefundScenario(db, admin);
    expect(latest.generation).toBe(attempted.generation + 1);
    const typedRejection = rejection as PrimaryStagingRefundError;
    await recordPrimaryStagingRefundRejection(db, organizer, "completeCheckedRefund", typedRejection.code, typedRejection.generation);

    await expect(db.primaryAuditEvent.findFirstOrThrow({
      where: { action: "STAGING_REFUND_ACTION_REJECTED", targetId: "completeCheckedRefund", reason: typedRejection.code },
      orderBy: { createdAt: "desc" },
    })).resolves.toMatchObject({ eventId: `staging-refund-g${attempted.generation}-checked-event` });
  });

  it("rejects every unexpected command field before synthetic state can change", async () => {
    const seeded = await reseedPrimaryStagingRefundScenario(db, admin);
    const forbiddenInputs: Array<Record<string, unknown>> = [
      { organizerId: "another-organizer" },
      { eventId: "another-event", orderId: "another-order", admissionTicketId: "another-ticket" },
      { requestedAmountMinor: 1, currency: "USD" },
      { status: "SUCCEEDED" },
      { providerRefundId: "re_live_forbidden" },
      { providerChargeId: "ch_live_forbidden" },
      { buyerUserId: outsider.id, credentialId: "another-credential", reservationId: "another-reservation" },
      { nested: { eventId: "another-event" } },
      { generation: seeded.generation - 1 },
    ];

    for (const input of forbiddenInputs) {
      await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", input)).rejects.toMatchObject({
        code: "STAGING_REFUND_UNEXPECTED_INPUT",
        generation: seeded.generation,
      });
    }

    await expect(db.primaryRefund.count({
      where: { eventId: `staging-refund-g${seeded.generation}-ordinary-event` },
    })).resolves.toBe(0);
  });

  it("fails closed when deterministic admission state drifts before a command", async () => {
    const ordinarySeed = await reseedPrimaryStagingRefundScenario(db, admin);
    const ordinaryTicketId = `staging-refund-g${ordinarySeed.generation}-ordinary-ticket-1`;
    await db.primaryAdmissionTicket.update({ where: { id: ordinaryTicketId }, data: { status: "CHECKED_IN" } });

    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "ORDINARY_REFUND_REQUIRES_UNSCANNED_TICKET",
      generation: ordinarySeed.generation,
    });
    await expect(db.primaryRefund.count({ where: { eventId: `staging-refund-g${ordinarySeed.generation}-ordinary-event` } })).resolves.toBe(0);

    const cancellationSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    const cancellationTicketId = `staging-refund-g${cancellationSeed.generation}-cancellation-ticket-1`;
    await db.primaryAdmissionTicket.update({
      where: { id: cancellationTicketId },
      data: { status: "VOIDED", voidedAt: now, voidReason: "Adversarial pre-command state drift." },
    });

    await expect(runPrimaryStagingRefundAction(db, organizer, "activateCancellation", {})).rejects.toMatchObject({
      code: "CANCELLATION_SCENARIO_STATE_INVALID",
      generation: cancellationSeed.generation,
    });
    await expect(db.primaryEventCancellation.count({ where: { eventId: `staging-refund-g${cancellationSeed.generation}-cancellation-event` } })).resolves.toBe(0);
  });

  it("revalidates reserved personas inside every synthetic command transaction", async () => {
    const organizerSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    await db.user.update({ where: { id: organizer.id }, data: { isBanned: true } });

    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_ORGANIZER_REQUIRED",
      generation: organizerSeed.generation,
    });
    await expect(db.primaryRefund.count({ where: { eventId: `staging-refund-g${organizerSeed.generation}-ordinary-event` } })).resolves.toBe(0);
    await db.user.update({ where: { id: organizer.id }, data: { isBanned: false } });

    const adminSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    await runPrimaryStagingRefundAction(db, organizer, "requestCheckedRefund", {});
    await db.user.update({ where: { id: admin.id }, data: { phoneVerifiedAt: null } });

    await expect(runPrimaryStagingRefundAction(db, admin, "approveCheckedRefund", {
      reason: "Stale authenticated actor must fail closed",
      evidence: "synthetic-case-stale-admin",
      fraudReview: "No indicators",
      costBearer: "ORGANIZER",
    })).rejects.toMatchObject({ code: "STAGING_ADMIN_REQUIRED", generation: adminSeed.generation });
    await expect(db.primaryCheckedInRefundApproval.count({
      where: { refund: { eventId: `staging-refund-g${adminSeed.generation}-checked-event` } },
    })).resolves.toBe(0);
    await db.user.update({ where: { id: admin.id }, data: { phoneVerifiedAt: now } });
  });

  it("fails closed when the deterministic purchase chain drifts before a command", async () => {
    const eventSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    const eventId = `staging-refund-g${eventSeed.generation}-ordinary-event`;
    await db.primaryEvent.update({ where: { id: eventId }, data: { status: "DRAFT" } });

    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_PURCHASE_STATE_INVALID",
      generation: eventSeed.generation,
    });
    await expect(db.primaryRefund.count({ where: { eventId } })).resolves.toBe(0);
    await db.primaryEvent.update({ where: { id: eventId }, data: { status: "APPROVED" } });

    const ticketTypeSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    const ticketTypeId = `staging-refund-g${ticketTypeSeed.generation}-checked-ticket-type`;
    const checkedEventId = `staging-refund-g${ticketTypeSeed.generation}-checked-event`;
    await db.primaryTicketType.update({ where: { id: ticketTypeId }, data: { status: "INACTIVE" } });

    await expect(runPrimaryStagingRefundAction(db, organizer, "requestCheckedRefund", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_PURCHASE_STATE_INVALID",
      generation: ticketTypeSeed.generation,
    });
    await expect(db.primaryRefund.count({ where: { eventId: checkedEventId } })).resolves.toBe(0);
    await db.primaryTicketType.update({ where: { id: ticketTypeId }, data: { status: "ACTIVE" } });
  });

  it("rejects appended payment reconciliation evidence outside the synthetic fixture", async () => {
    const providerEventSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    const providerEventId = `staging-refund-g${providerEventSeed.generation}-ordinary-event`;
    const providerEventPayment = await db.primaryPaymentAttempt.findFirstOrThrow({ where: { eventId: providerEventId } });
    await db.primaryPaymentProviderEvent.create({ data: {
      providerEventId: `forged-payment-event-${providerEventSeed.generation}`,
      attemptId: providerEventPayment.id,
      orderId: providerEventPayment.orderId,
      organizerId: providerEventPayment.organizerId,
      eventId: providerEventPayment.eventId,
      buyerUserId: providerEventPayment.buyerUserId,
      reservationId: providerEventPayment.reservationId,
      eventType: "payment_intent.succeeded",
      payloadDigest: "e".repeat(64),
      providerCreatedAt: now,
    } });

    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_PURCHASE_STATE_INVALID",
      generation: providerEventSeed.generation,
    });
    await expect(db.primaryRefund.count({ where: { eventId: providerEventId } })).resolves.toBe(0);

    const exceptionSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    const exceptionEventId = `staging-refund-g${exceptionSeed.generation}-checked-event`;
    const exceptionPayment = await db.primaryPaymentAttempt.findFirstOrThrow({ where: { eventId: exceptionEventId } });
    await db.primaryPaymentException.create({ data: {
      attemptId: exceptionPayment.id,
      kind: "PROVIDER_MISMATCH",
      providerEventId: `forged-payment-exception-${exceptionSeed.generation}`,
    } });

    await expect(runPrimaryStagingRefundAction(db, organizer, "requestCheckedRefund", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_PURCHASE_STATE_INVALID",
      generation: exceptionSeed.generation,
    });
    await expect(db.primaryRefund.count({ where: { eventId: exceptionEventId } })).resolves.toBe(0);
  });

  it("revalidates and safely restores the reserved synthetic buyer", async () => {
    const buyerSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    const buyer = await db.user.findUniqueOrThrow({ where: { email: "refund-buyer@primary-staging.example.invalid" } });
    await db.user.update({ where: { id: buyer.id }, data: { canBuy: true } });

    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_PURCHASE_STATE_INVALID",
      generation: buyerSeed.generation,
    });
    await expect(db.primaryRefund.count({
      where: { eventId: `staging-refund-g${buyerSeed.generation}-ordinary-event` },
    })).resolves.toBe(0);

    const restoredSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    expect(restoredSeed.generation).toBe(buyerSeed.generation + 1);
    await expect(db.user.findUniqueOrThrow({ where: { id: buyer.id } })).resolves.toMatchObject({
      email: "refund-buyer@primary-staging.example.invalid",
      phone: "+15550001004",
      role: "USER",
      isBanned: false,
      canBuy: false,
      canSell: false,
      canComment: false,
    });
    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).resolves.toMatchObject({
      status: "SUCCEEDED",
    });
  });

  it("rejects synthetic buyer identity drift before refund mutation", async () => {
    const seeded = await reseedPrimaryStagingRefundScenario(db, admin);
    const buyer = await db.user.findUniqueOrThrow({ where: { email: "refund-buyer@primary-staging.example.invalid" } });
    await db.user.update({
      where: { id: buyer.id },
      data: {
        passwordHash: "$2b$12$externallyChangedSyntheticBuyerIdentity",
        firstName: "Changed",
        streetAddress1: "99 Untrusted Way",
      },
    });

    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_PURCHASE_STATE_INVALID",
      generation: seeded.generation,
    });
    await expect(db.primaryRefund.count({
      where: { eventId: `staging-refund-g${seeded.generation}-ordinary-event` },
    })).resolves.toBe(0);
  });

  it("rejects contaminated synthetic tenant metadata and reseeds it safely", async () => {
    const organizerSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    await db.primaryOrganizer.update({
      where: { id: "primary-staging-refund-organizer" },
      data: {
        supportEmail: "external-merchant@example.com",
        paymentProvider: "stripe",
        paymentAccountRefEncrypted: "synthetic-forbidden-provider-account",
        paymentStatus: "VERIFIED",
      },
    });

    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_PURCHASE_STATE_INVALID",
      generation: organizerSeed.generation,
    });
    await expect(db.primaryRefund.count({
      where: { eventId: `staging-refund-g${organizerSeed.generation}-ordinary-event` },
    })).resolves.toBe(0);

    const restored = await reseedPrimaryStagingRefundScenario(db, admin);
    expect(restored.generation).toBe(organizerSeed.generation + 1);
    await expect(db.primaryOrganizer.findUniqueOrThrow({
      where: { id: "primary-staging-refund-organizer" },
    })).resolves.toMatchObject({
      supportEmail: "refunds@primary-staging.example.invalid",
      paymentProvider: null,
      paymentAccountRefEncrypted: null,
      paymentStatus: "NOT_STARTED",
    });

    const eventId = `staging-refund-g${restored.generation}-ordinary-event`;
    await db.primaryEvent.update({
      where: { id: eventId },
      data: { contactEmail: "external-attendee@example.com" },
    });
    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_PURCHASE_STATE_INVALID",
      generation: restored.generation,
    });
    await expect(db.primaryRefund.count({ where: { eventId } })).resolves.toBe(0);
  });

  it("rejects and clears contaminated synthetic business identity", async () => {
    const seeded = await reseedPrimaryStagingRefundScenario(db, admin);
    await db.primaryOrganizer.update({
      where: { id: "primary-staging-refund-organizer" },
      data: { businessNumberEncrypted: "encrypted-external-business-identity" },
    });

    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_PURCHASE_STATE_INVALID",
      generation: seeded.generation,
    });
    await expect(db.primaryRefund.count({
      where: { eventId: `staging-refund-g${seeded.generation}-ordinary-event` },
    })).resolves.toBe(0);

    await expect(reseedPrimaryStagingRefundScenario(db, admin)).resolves.toEqual({
      generation: seeded.generation + 1,
    });
    await expect(db.primaryOrganizer.findUniqueOrThrow({
      where: { id: "primary-staging-refund-organizer" },
    })).resolves.toMatchObject({ businessNumberEncrypted: null });
  });

  it("rejects contaminated synthetic ownership provenance and reseeds it safely", async () => {
    const seeded = await reseedPrimaryStagingRefundScenario(db, admin);
    const syntheticMembership = await db.primaryOrganizerMembership.findUniqueOrThrow({
      where: { organizerId_userId: { organizerId: "primary-staging-refund-organizer", userId: organizer.id } },
    });
    await db.primaryOrganizerMembership.update({
      where: { id: syntheticMembership.id },
      data: { invitedByUserId: outsider.id },
    });

    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_ACCESS_PROVENANCE_INVALID",
      generation: seeded.generation,
    });
    await expect(db.primaryRefund.count({
      where: { eventId: `staging-refund-g${seeded.generation}-ordinary-event` },
    })).resolves.toBe(0);

    const restored = await reseedPrimaryStagingRefundScenario(db, admin);
    expect(restored.generation).toBe(seeded.generation + 1);
    await expect(db.primaryOrganizerMembership.findUniqueOrThrow({
      where: { id: syntheticMembership.id },
    })).resolves.toMatchObject({
      role: "OWNER",
      status: "ACTIVE",
      userId: organizer.id,
      invitedByUserId: organizer.id,
      revokedAt: null,
    });
  });

  it("rejects unexpected synthetic tenant access grants before refund mutation", async () => {
    const seeded = await reseedPrimaryStagingRefundScenario(db, admin);
    const eventId = `staging-refund-g${seeded.generation}-ordinary-event`;
    const ownerMembership = await db.primaryOrganizerMembership.findUniqueOrThrow({
      where: { organizerId_userId: { organizerId: "primary-staging-refund-organizer", userId: organizer.id } },
    });
    const unexpectedMembership = await db.primaryOrganizerMembership.create({ data: {
      organizerId: "primary-staging-refund-organizer",
      userId: outsider.id,
      role: "READ_ONLY",
      status: "ACTIVE",
      acceptedAt: now,
      invitedByUserId: organizer.id,
    } });

    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_ACCESS_PROVENANCE_INVALID",
      generation: seeded.generation,
    });
    await db.primaryOrganizerMembership.delete({ where: { id: unexpectedMembership.id } });

    const unexpectedInvitation = await db.primaryOrganizerInvitation.create({ data: {
      organizerId: "primary-staging-refund-organizer",
      emailNormalized: outsider.email,
      role: "READ_ONLY",
      tokenHash: "f".repeat(64),
      expiresAt: new Date("2038-01-01T00:00:00Z"),
      invitedByUserId: organizer.id,
    } });
    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_ACCESS_PROVENANCE_INVALID",
      generation: seeded.generation,
    });
    await db.primaryOrganizerInvitation.delete({ where: { id: unexpectedInvitation.id } });

    const unexpectedAssignment = await db.primaryEventStaffAssignment.create({ data: {
      eventId,
      organizerId: "primary-staging-refund-organizer",
      membershipId: ownerMembership.id,
      assignedByUserId: organizer.id,
    } });
    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_ACCESS_PROVENANCE_INVALID",
      generation: seeded.generation,
    });
    await db.primaryEventStaffAssignment.delete({ where: { id: unexpectedAssignment.id } });

    await expect(db.primaryRefund.count({ where: { eventId } })).resolves.toBe(0);
    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).resolves.toMatchObject({
      status: "SUCCEEDED",
    });
  });

  it("rejects synthetic delivery intent before refund mutation or reseed", async () => {
    const seeded = await reseedPrimaryStagingRefundScenario(db, admin);
    const ordinaryBase = `staging-refund-g${seeded.generation}-ordinary`;
    const outbox = await db.primaryOutboxMessage.create({ data: {
      organizerId: "primary-staging-refund-organizer",
      topic: "synthetic.unexpected.delivery",
      aggregateType: "PrimaryEvent",
      aggregateId: `${ordinaryBase}-event`,
      payloadJson: { synthetic: true },
      idempotencyKey: `${ordinaryBase}:unexpected-delivery-intent`,
    } });

    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_DELIVERY_INTENT_INVALID",
      generation: seeded.generation,
    });
    await expect(reseedPrimaryStagingRefundScenario(db, admin)).rejects.toMatchObject({
      code: "STAGING_REFUND_DELIVERY_INTENT_INVALID",
    });
    await expect(db.primaryRefund.count({
      where: { eventId: `${ordinaryBase}-event` },
    })).resolves.toBe(0);

    await db.primaryOutboxMessage.delete({ where: { id: outbox.id } });
    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).resolves.toMatchObject({
      status: "SUCCEEDED",
    });
  });

  it("rejects drift in the synthetic purchase timeline before refund mutation", async () => {
    const reservationSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    const reservationBase = `staging-refund-g${reservationSeed.generation}-ordinary`;
    await db.primaryInventoryReservation.update({
      where: { id: `${reservationBase}-reservation` },
      data: { reconciliationAfter: new Date("2039-01-01T00:00:00Z") },
    });

    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_PURCHASE_STATE_INVALID",
      generation: reservationSeed.generation,
    });
    await expect(db.primaryRefund.count({
      where: { eventId: `${reservationBase}-event` },
    })).resolves.toBe(0);
  });

  it("fails closed when deterministic accepted-scan evidence drifts", async () => {
    const seeded = await reseedPrimaryStagingRefundScenario(db, admin);
    const checkedTicketId = `staging-refund-g${seeded.generation}-checked-ticket-1`;
    const checkedCredentialId = `staging-refund-g${seeded.generation}-checked-credential-1`;
    await db.primaryAdmissionScan.create({ data: {
      requestId: `staging-refund-g${seeded.generation}-checked:adversarial-duplicate`,
      commandDigest: "a".repeat(64),
      organizerId: "primary-staging-refund-organizer",
      eventId: `staging-refund-g${seeded.generation}-checked-event`,
      admissionTicketId: checkedTicketId,
      credentialId: checkedCredentialId,
      operatorUserId: admin.id,
      result: "DUPLICATE",
      deviceId: "synthetic-console",
      scannedAt: now,
    } });

    await expect(runPrimaryStagingRefundAction(db, organizer, "requestCheckedRefund", {})).rejects.toMatchObject({
      code: "CHECKED_REFUND_REQUIRES_CHECKED_IN_TICKET",
      generation: seeded.generation,
    });
    await expect(db.primaryRefund.count({
      where: { eventId: `staging-refund-g${seeded.generation}-checked-event` },
    })).resolves.toBe(0);
  });

  it("rejects forged refund and cancellation command evidence before continuing workflows", async () => {
    const refundSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    const refundBase = `staging-refund-g${refundSeed.generation}-checked`;
    await db.primaryRefund.create({ data: {
      organizerId: "primary-staging-refund-organizer",
      eventId: `${refundBase}-event`,
      orderId: `${refundBase}-order`,
      paymentAttemptId: `${refundBase}-payment`,
      requestedByUserId: organizer.id,
      policyVersionId: "primary-refund-policy-v1",
      requestKey: `${refundBase}:refund:checked`,
      commandDigest: "f".repeat(64),
      reason: "Forged synthetic checked refund command.",
      requestedAmountMinor: 3120,
      currency: "CAD",
    } });

    await expect(runPrimaryStagingRefundAction(db, admin, "approveCheckedRefund", {
      reason: "Must not approve forged workflow evidence",
      evidence: "synthetic-forged-refund",
      fraudReview: "No review because parent is untrusted",
      costBearer: "ORGANIZER",
    })).rejects.toMatchObject({
      code: "STAGING_REFUND_COMMAND_EVIDENCE_INVALID",
      generation: refundSeed.generation,
    });
    await expect(db.primaryCheckedInRefundApproval.count({ where: { refund: { eventId: `${refundBase}-event` } } })).resolves.toBe(0);
    await expect(db.primaryRefundItem.count({ where: { refund: { eventId: `${refundBase}-event` } } })).resolves.toBe(0);

    const cancellationSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    const cancellationBase = `staging-refund-g${cancellationSeed.generation}-cancellation`;
    const forgedCancellation = await db.primaryEventCancellation.create({ data: {
      organizerId: "primary-staging-refund-organizer",
      eventId: `${cancellationBase}-event`,
      generation: 1,
      policyVersionId: "primary-refund-policy-v1",
      requestedByUserId: outsider.id,
      requestKey: `${cancellationBase}:cancellation`,
      commandDigest: "e".repeat(64),
      reason: "Forged synthetic cancellation command.",
      snapshotMaxTicketId: "derived-on-activation",
      expectedTicketCount: 0,
      expectedAmountMinor: 0,
    } });
    await db.primaryEventCancellation.update({
      where: { id: forgedCancellation.id },
      data: { status: "ACTIVE", activatedAt: now },
    });

    await expect(runPrimaryStagingRefundAction(db, organizer, "prepareCancellation", {})).rejects.toMatchObject({
      code: "STAGING_CANCELLATION_COMMAND_EVIDENCE_INVALID",
      generation: cancellationSeed.generation,
    });
    await expect(db.primaryRefund.count({ where: { eventId: `${cancellationBase}-event` } })).resolves.toBe(0);
    await expect(db.primaryRefundObligation.count({ where: { eventId: `${cancellationBase}-event` } })).resolves.toBe(0);
  });

  it("rejects non-console approval and extra cancellation preparation evidence", async () => {
    const checkedSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    const checkedBase = `staging-refund-g${checkedSeed.generation}-checked`;
    await runPrimaryStagingRefundAction(db, organizer, "requestCheckedRefund", {});
    const checkedRefund = await db.primaryRefund.findUniqueOrThrow({
      where: { requestKey: `${checkedBase}:refund:checked` },
    });
    await db.primaryCheckedInRefundApproval.create({ data: {
      refundId: checkedRefund.id,
      admissionTicketId: `${checkedBase}-ticket-1`,
      approvedByUserId: organizer.id,
      evidenceDigest: "a".repeat(64),
      reason: "Database-valid organizer approval outside the reserved console flow.",
      fraudReview: "Not reviewed by the reserved staging supervisor.",
      costBearer: "ORGANIZER",
    } });

    await expect(runPrimaryStagingRefundAction(db, admin, "approveCheckedRefund", {
      reason: "Reserved supervisor review",
      evidence: "synthetic-reserved-supervisor-review",
      fraudReview: "No indicators",
      costBearer: "ORGANIZER",
    })).rejects.toMatchObject({
      code: "STAGING_REFUND_APPROVAL_EVIDENCE_INVALID",
      generation: checkedSeed.generation,
    });
    await expect(db.primaryRefundItem.count({ where: { refundId: checkedRefund.id } })).resolves.toBe(0);

    const cancellationSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    const cancellationBase = `staging-refund-g${cancellationSeed.generation}-cancellation`;
    await runPrimaryStagingRefundAction(db, organizer, "activateCancellation", {});
    await runPrimaryStagingRefundAction(db, organizer, "prepareCancellation", {});
    const cancellation = await db.primaryEventCancellation.findUniqueOrThrow({
      where: { requestKey: `${cancellationBase}:cancellation` },
    });
    await db.primaryRefundObligation.create({ data: {
      organizerId: "primary-staging-refund-organizer",
      eventId: `${cancellationBase}-event`,
      orderId: `${cancellationBase}-order`,
      cancellationId: cancellation.id,
      cause: "ADVERSARIAL_EXTRA_OBLIGATION",
      amountMinor: 1,
      currency: "CAD",
      idempotencyKey: `${cancellationBase}:obligation:extra`,
      reason: "Database-valid but non-deterministic preparation evidence.",
    } });

    await expect(runPrimaryStagingRefundAction(db, admin, "approveCancellationWaiver", {
      reason: "Reserved waiver review",
      evidence: "synthetic-reserved-waiver-review",
    })).rejects.toMatchObject({
      code: "STAGING_CANCELLATION_PREPARATION_EVIDENCE_INVALID",
      generation: cancellationSeed.generation,
    });
    await expect(db.primaryObligationWaiverApproval.count({
      where: { obligation: { cancellationId: cancellation.id } },
    })).resolves.toBe(0);
  });

  it("rejects replay when terminal synthetic provider evidence is contaminated", async () => {
    const seeded = await reseedPrimaryStagingRefundScenario(db, admin);
    const ordinaryBase = `staging-refund-g${seeded.generation}-ordinary`;
    await runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {});
    const refund = await db.primaryRefund.findUniqueOrThrow({
      where: { requestKey: `${ordinaryBase}:refund:ordinary` },
      include: { attempts: true },
    });
    await db.primaryRefundProviderEvent.create({ data: {
      attemptId: refund.attempts[0].id,
      providerEventId: `${ordinaryBase}:adversarial-extra-event`,
      payloadDigest: "f".repeat(64),
      eventType: "synthetic.refund.unexpected",
      providerCreatedAt: now,
    } });

    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_COMPLETION_EVIDENCE_INVALID",
      generation: seeded.generation,
    });
    await expect(db.primaryAuditEvent.count({
      where: { eventId: `${ordinaryBase}-event`, action: "STAGING_ORDINARY_REFUND_COMPLETED" },
    })).resolves.toBe(1);
  });

  it("requires exact console audit provenance before advancing or replaying a workflow", async () => {
    const ordinarySeed = await reseedPrimaryStagingRefundScenario(db, admin);
    const ordinaryBase = `staging-refund-g${ordinarySeed.generation}-ordinary`;
    const completed = await runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {});
    await db.primaryAuditEvent.create({ data: {
      organizerId: "primary-staging-refund-organizer",
      eventId: `${ordinaryBase}-event`,
      actorUserId: organizer.id,
      actorType: "USER",
      action: "STAGING_ORDINARY_REFUND_COMPLETED",
      targetType: "PrimaryRefund",
      targetId: completed.id,
      reason: "Forged duplicate completion evidence.",
      requestId: `staging-refund:${"f".repeat(24)}`,
      afterJson: { status: "SUCCEEDED", requestedAmountMinor: 2600, currency: "CAD" },
    } });

    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_AUDIT_EVIDENCE_INVALID",
      generation: ordinarySeed.generation,
    });

    const cancellationSeed = await reseedPrimaryStagingRefundScenario(db, admin);
    const cancellationEventId = `staging-refund-g${cancellationSeed.generation}-cancellation-event`;
    await runPrimaryStagingRefundAction(db, organizer, "activateCancellation", {});
    await db.primaryAuditEvent.deleteMany({
      where: { eventId: cancellationEventId, action: "STAGING_CANCELLATION_ACTIVATED" },
    });

    await expect(runPrimaryStagingRefundAction(db, organizer, "prepareCancellation", {})).rejects.toMatchObject({
      code: "STAGING_REFUND_AUDIT_EVIDENCE_INVALID",
      generation: cancellationSeed.generation,
    });
    await expect(db.primaryRefund.count({ where: { eventId: cancellationEventId } })).resolves.toBe(0);
    await expect(db.primaryRefundObligation.count({ where: { eventId: cancellationEventId } })).resolves.toBe(0);
  });

  it("never adopts an externally materialized ordinary refund parent", async () => {
    const seeded = await reseedPrimaryStagingRefundScenario(db, admin);
    const ordinaryBase = `staging-refund-g${seeded.generation}-ordinary`;
    await db.primaryRefund.create({ data: {
      organizerId: "primary-staging-refund-organizer",
      eventId: `${ordinaryBase}-event`,
      orderId: `${ordinaryBase}-order`,
      paymentAttemptId: `${ordinaryBase}-payment`,
      requestedByUserId: organizer.id,
      policyVersionId: "primary-refund-policy-v1",
      requestKey: `${ordinaryBase}:refund:ordinary`,
      commandDigest: createHash("sha256").update(JSON.stringify([ordinaryBase, "ordinary", [`${ordinaryBase}-ticket-1`]])).digest("hex"),
      reason: "Synthetic ordinary refund; no provider or money movement.",
      requestedAmountMinor: 2600,
      currency: "CAD",
    } });

    await expect(runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {})).rejects.toMatchObject({
      code: "ORDINARY_REFUND_INCOMPLETE_EVIDENCE",
      generation: seeded.generation,
    });
    await expect(db.primaryRefund.findUniqueOrThrow({
      where: { requestKey: `${ordinaryBase}:refund:ordinary` },
      include: { items: true, attempts: true, revocations: true },
    })).resolves.toMatchObject({ status: "REQUESTED", items: [], attempts: [], revocations: [] });
    await expect(db.primaryAuditEvent.count({
      where: { eventId: `${ordinaryBase}-event`, action: "STAGING_ORDINARY_REFUND_COMPLETED" },
    })).resolves.toBe(0);
  });
});
