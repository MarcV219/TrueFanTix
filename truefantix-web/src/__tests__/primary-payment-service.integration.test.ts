/** @jest-environment node */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { requirePrimaryPreflight } from "@/lib/primary/config";
import { createPrimaryOrderInternalCapabilityForTests, PrimaryOrderService } from "@/lib/primary/order-service";
import { PrimaryPaymentService, requirePrimaryStripeTestConfig, type PrimaryProviderEvent, type PrimaryStripeAdapter } from "@/lib/primary/payment-service";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;
if (!databaseUrl) {
  describe.skip("primary payment PostgreSQL integration", () => { it("requires an isolated database", () => undefined); });
} else {
describe("primary payment PostgreSQL integration", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const capability = requirePrimaryPreflight({ NODE_ENV: "test", PRIMARY_TICKETING_ENABLED: "true", PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-test", PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-test", PRIMARY_TICKETING_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl } as NodeJS.ProcessEnv);
  const stripeConfig = requirePrimaryStripeTestConfig(capability, { NODE_ENV: "test", PRIMARY_STRIPE_SECRET_KEY: "sk_test_synthetic", PRIMARY_STRIPE_WEBHOOK_SECRET: "whsec_synthetic" } as NodeJS.ProcessEnv);
  const now = new Date("2037-01-01T12:00:00Z"); let sequence = 0; const runId = `${process.pid}-${Date.now()}`;
  const orderService = new PrimaryOrderService(db, capability, () => new Date(now));
  const internalEnv = process.env;

  class FakeStripe implements PrimaryStripeAdapter {
    creates: Array<{ metadata: Record<string, string>; idempotencyKey: string }> = [];
    async createUnconfirmedIntent(input: { amountMinor: number; currency: string; metadata: Record<string, string>; idempotencyKey: string }) {
      this.creates.push({ metadata: input.metadata, idempotencyKey: input.idempotencyKey });
      const reservation = await db.primaryInventoryReservation.findUniqueOrThrow({ where: { id: input.metadata.reservationId } });
      if (reservation.status !== "PAYMENT_COMMITTED") throw new Error("provider called before local commitment");
      return { id: `pi_test_${input.metadata.primaryOrderId}`, createdAt: new Date(now) };
    }
    verifyWebhook(rawBody: string | Buffer, signature: string) {
      if (signature !== "valid") throw new Error("invalid signature");
      const parsed = JSON.parse(rawBody.toString()) as PrimaryProviderEvent;
      return { ...parsed, createdAt: new Date(parsed.createdAt) };
    }
  }

  const seed = async () => {
    const id = ++sequence;
    const buyer = await db.user.create({ data: { email: `payment-${runId}-${id}@example.test`, passwordHash: "synthetic", emailVerifiedAt: new Date(), firstName: "Payment", lastName: `${id}`, phone: `+1${String(Date.now() + id).slice(-10)}`, phoneVerifiedAt: new Date(), streetAddress1: "1 Test", city: "Toronto", region: "ON", postalCode: "A1A1A1", country: "CA" } });
    const organizer = await db.primaryOrganizer.create({ data: { legalName: `Payment ${id}`, displayName: `Payment ${id}`, addressLine1: "1 Test", city: "Toronto", region: "ON", postalCode: "A1A1A1", country: "CA", supportEmail: `payment-org-${runId}-${id}@example.test`, status: "APPROVED", createdByUserId: buyer.id } });
    const event = await db.primaryEvent.create({ data: { organizerId: organizer.id, title: "Payment Event", description: "Synthetic", category: "CONCERT", venueName: "Hall", venueAddressLine1: "1 Test", venueCity: "Toronto", venueRegion: "ON", venuePostalCode: "A1A1A1", venueCountry: "CA", startsAtLocal: new Date("2038-01-01T19:00:00Z"), endsAtLocal: new Date("2038-01-01T22:00:00Z"), timezone: "America/Toronto", contactEmail: "events@example.test", draftPolicyText: "Synthetic", totalCapacity: 10, status: "APPROVED" } });
    const ticketType = await db.primaryTicketType.create({ data: { organizerId: organizer.id, eventId: event.id, name: "GA", allocatedQuantity: 10, status: "ACTIVE", currency: "CAD", basePriceMinor: 2500 } });
    const reservation = await db.primaryInventoryReservation.create({ data: { organizerId: organizer.id, eventId: event.id, ticketTypeId: ticketType.id, buyerUserId: buyer.id, quantity: 2, expiresAt: new Date(now.getTime() + 60_000), createIdempotencyKey: `payment-reservation-${runId}-${id}` } });
    const internal = createPrimaryOrderInternalCapabilityForTests();
    const order = await orderService.create({ internalCapability: internal, actor: { id: buyer.id, role: buyer.role }, organizerId: organizer.id, eventId: event.id, reservationId: reservation.id, idempotencyKey: `payment-order-${runId}-${id}`, additionalComponents: [] });
    return { buyer, organizer, event, reservation, order, internal };
  };
  const eventFor = (attempt: { providerIntentId: string | null; orderId: string; organizerId: string; eventId: string; reservationId: string; expectedAmountMinor: number; currency: string }, id: string, type: PrimaryProviderEvent["type"], changes: Partial<PrimaryProviderEvent> = {}) => JSON.stringify({ id, type, intentId: attempt.providerIntentId, amountMinor: attempt.expectedAmountMinor, currency: attempt.currency, metadata: { primaryOrderId: attempt.orderId, organizerId: attempt.organizerId, eventId: attempt.eventId, reservationId: attempt.reservationId }, createdAt: now.toISOString(), terminalGuarantee: type === "payment_intent.payment_failed" || type === "payment_intent.canceled", ...changes });

  beforeAll(async () => {
    internalEnv.PRIMARY_TICKETING_ENVIRONMENT_ID = "isolated-test";
    await db.$executeRawUnsafe('TRUNCATE TABLE "PrimaryPaymentException", "PrimaryPaymentProviderEvent", "PrimaryPaymentAttempt", "PrimaryOrderPriceComponent", "PrimaryOrderLine", "PrimaryOrder" CASCADE');
  });
  afterAll(async () => { delete internalEnv.PRIMARY_TICKETING_ENVIRONMENT_ID; await db.$disconnect(); await pool.end(); });

  it("rejects live Stripe configuration", () => {
    expect(() => requirePrimaryStripeTestConfig(capability, { NODE_ENV: "test", PRIMARY_STRIPE_SECRET_KEY: "sk_live_forbidden", PRIMARY_STRIPE_WEBHOOK_SECRET: "whsec_test" } as NodeJS.ProcessEnv)).toThrow(expect.objectContaining({ code: "STRIPE_TEST_PREFLIGHT_REQUIRED" }));
  });

  it("commits locally before creating one unconfirmed provider intent and replays exactly", async () => {
    const scope = await seed(); const adapter = new FakeStripe(); const service = new PrimaryPaymentService(db, capability, stripeConfig, adapter, orderService, () => new Date(now));
    const input = { internalCapability: scope.internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "attempt-exact" };
    const first = await service.createAttempt(input); const replay = await service.createAttempt(input);
    expect(first).toMatchObject({ status: "PROCESSING", expectedAmountMinor: 5000, currency: "CAD", providerIntentId: `pi_test_${scope.order.id}` });
    expect(replay).toEqual(first); expect(adapter.creates).toHaveLength(1);
  });

  it("serializes competing attempt creation and binds idempotency", async () => {
    const scope = await seed(); const adapter = new FakeStripe(); const service = new PrimaryPaymentService(db, capability, stripeConfig, adapter, orderService, () => new Date(now));
    const base = { internalCapability: scope.internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id };
    const results = await Promise.allSettled([service.createAttempt({ ...base, idempotencyKey: "attempt-race-a" }), service.createAttempt({ ...base, idempotencyKey: "attempt-race-b" })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.primaryPaymentAttempt.count({ where: { orderId: scope.order.id } })).toBe(1);
  });

  it("verifies, deduplicates, and strictly reconciles success", async () => {
    const scope = await seed(); const adapter = new FakeStripe(); const service = new PrimaryPaymentService(db, capability, stripeConfig, adapter, orderService, () => new Date(now));
    const attempt = await service.createAttempt({ internalCapability: scope.internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "success-attempt" });
    const body = eventFor(attempt, "evt_success", "payment_intent.succeeded");
    await expect(service.handleWebhook(body, "bad")).rejects.toThrow("invalid signature");
    await service.handleWebhook(body, "valid"); await service.handleWebhook(body, "valid");
    expect(await db.primaryPaymentProviderEvent.count({ where: { providerEventId: "evt_success" } })).toBe(1);
    expect(await db.primaryOrder.findUniqueOrThrow({ where: { id: scope.order.id } })).toMatchObject({ status: "PAID", paidAt: now });
  });

  it("fails closed on amount, currency, or metadata mismatch", async () => {
    for (const [suffix, changes] of [["amount", { amountMinor: 4999 }], ["currency", { currency: "USD" }], ["metadata", { metadata: { primaryOrderId: "wrong" } }]] as const) {
      const scope = await seed(); const adapter = new FakeStripe(); const service = new PrimaryPaymentService(db, capability, stripeConfig, adapter, orderService, () => new Date(now));
      const attempt = await service.createAttempt({ internalCapability: scope.internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: `mismatch-${suffix}` });
      await service.handleWebhook(eventFor(attempt, `evt_${suffix}`, "payment_intent.succeeded", changes), "valid");
      expect(await db.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({ status: "RECONCILIATION_REQUIRED" });
      expect(await db.primaryOrder.findUniqueOrThrow({ where: { id: scope.order.id } })).toMatchObject({ status: "PAYMENT_PROCESSING" });
    }
  });

  it("releases only terminal failures and converts a later success into a refund obligation", async () => {
    const scope = await seed(); const adapter = new FakeStripe(); const service = new PrimaryPaymentService(db, capability, stripeConfig, adapter, orderService, () => new Date(now));
    const attempt = await service.createAttempt({ internalCapability: scope.internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "late-success" });
    await service.handleWebhook(eventFor(attempt, "evt_failed", "payment_intent.canceled"), "valid");
    expect(await db.primaryInventoryReservation.findUniqueOrThrow({ where: { id: scope.reservation.id } })).toMatchObject({ status: "RELEASED" });
    await service.handleWebhook(eventFor(attempt, "evt_late", "payment_intent.succeeded"), "valid");
    expect(await db.primaryPaymentException.findFirst({ where: { attemptId: attempt.id } })).toMatchObject({ kind: "LATE_SUCCESS_REFUND_REQUIRED" });
    expect(await db.primaryOrder.findUniqueOrThrow({ where: { id: scope.order.id } })).toMatchObject({ status: "PAYMENT_FAILED" });
  });

  it("rolls back webhook state and event persistence on outbox conflict", async () => {
    const scope = await seed(); const adapter = new FakeStripe(); const service = new PrimaryPaymentService(db, capability, stripeConfig, adapter, orderService, () => new Date(now));
    const attempt = await service.createAttempt({ internalCapability: scope.internal, organizerId: scope.organizer.id, eventId: scope.event.id, orderId: scope.order.id, idempotencyKey: "webhook-rollback" });
    await db.primaryOutboxMessage.create({ data: { organizerId: scope.organizer.id, topic: "conflict", aggregateType: "Synthetic", aggregateId: attempt.id, payloadJson: {}, idempotencyKey: "evt_rollback:payment_succeeded" } });
    await expect(service.handleWebhook(eventFor(attempt, "evt_rollback", "payment_intent.succeeded"), "valid")).rejects.toBeTruthy();
    expect(await db.primaryPaymentProviderEvent.count({ where: { providerEventId: "evt_rollback" } })).toBe(0);
    expect(await db.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({ status: "PROCESSING" });
  });
});
}
