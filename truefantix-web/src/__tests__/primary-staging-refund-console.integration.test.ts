/** @jest-environment node */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  getPrimaryStagingRefundState,
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

    const outcomes = await Promise.allSettled([
      runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {}),
      runPrimaryStagingRefundAction(db, organizer, "refundOrdinary", {}),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    const state = await getPrimaryStagingRefundState(db);
    const ordinary = state?.events.find((event) => event.id.includes("-ordinary-"));
    expect(ordinary?.orders[0].admissionTickets[0]).toMatchObject({ status: "VOIDED", refundItems: [{ refund: { status: "SUCCEEDED", attempts: [{ status: "SUCCEEDED" }] } }] });
  });

  it("requires complete scoped supervisor evidence for a checked-in refund", async () => {
    await runPrimaryStagingRefundAction(db, organizer, "requestCheckedRefund", {});
    await expect(runPrimaryStagingRefundAction(db, organizer, "requestCheckedRefund", {})).rejects.toEqual(expect.objectContaining({ code: "CHECKED_REFUND_ALREADY_REQUESTED" }));
    await expect(db.primaryAuditEvent.count({ where: { action: "STAGING_CHECKED_REFUND_REQUESTED" } })).resolves.toBe(1);
    const requestedState = await getPrimaryStagingRefundState(db);
    const checkedTicket = requestedState?.events.find((event) => event.id.includes("-checked-"))?.orders[0].admissionTickets[0];
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
    const active = await runPrimaryStagingRefundAction(db, organizer, "activateCancellation", {});
    expect(active).toMatchObject({ status: "ACTIVE", expectedTicketCount: 2, expectedAmountMinor: 4200 });
    await expect(db.primaryEventCancellation.update({ where: { id: active.id }, data: { expectedAmountMinor: 1 } })).rejects.toThrow("Cancellation snapshot is immutable");
    await runPrimaryStagingRefundAction(db, organizer, "prepareCancellation", {});
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

  it("serializes concurrent repeatable reseeds into distinct immutable generations", async () => {
    const outcomes = await Promise.all([
      reseedPrimaryStagingRefundScenario(db, admin),
      reseedPrimaryStagingRefundScenario(db, admin),
    ]);
    expect(outcomes.map((item) => item.generation).sort()).toEqual([2, 3]);
    await expect(getPrimaryStagingRefundState(db)).resolves.toMatchObject({ generation: 3 });
  });
});
