import { createHash } from "node:crypto";
import Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { recordPrimaryAuditAndOutbox } from "./audit-outbox";
import type { PrimaryPreflightCapability } from "./config";
import { assertPrimaryPreflightCapability } from "./config";
import { PrimaryDomainError } from "./organizer-service";
import type { PrimaryOrderInternalCapability } from "./order-service";
import { PrimaryOrderService } from "./order-service";

type Tx = Prisma.TransactionClient;
type Db = { $transaction<T>(fn: (tx: Tx) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> };
type StripeConfig = Readonly<{ secretKey: string; webhookSecret: string }>;
const stripeConfigs = new WeakSet<object>();

export type PrimaryProviderEvent = {
  id: string;
  type: "payment_intent.processing" | "payment_intent.succeeded" | "payment_intent.payment_failed" | "payment_intent.canceled";
  intentId: string;
  amountMinor: number;
  currency: string;
  metadata: Record<string, string>;
  createdAt: Date;
  terminalGuarantee?: boolean;
};

export interface PrimaryStripeAdapter {
  createUnconfirmedIntent(input: { amountMinor: number; currency: string; metadata: Record<string, string>; idempotencyKey: string }): Promise<{ id: string; createdAt: Date }>;
  verifyWebhook(rawBody: string | Buffer, signature: string, webhookSecret: string): PrimaryProviderEvent;
}

export function requirePrimaryStripeTestConfig(capability: PrimaryPreflightCapability, env: NodeJS.ProcessEnv = process.env): StripeConfig {
  assertPrimaryPreflightCapability(capability);
  const secretKey = env.PRIMARY_STRIPE_SECRET_KEY?.trim() ?? "";
  const webhookSecret = env.PRIMARY_STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  if (!secretKey.startsWith("sk_test_") || secretKey.startsWith("sk_live_") || !webhookSecret.startsWith("whsec_")) throw new PrimaryDomainError("STRIPE_TEST_PREFLIGHT_REQUIRED");
  const config = Object.freeze({ secretKey, webhookSecret });
  stripeConfigs.add(config);
  return config;
}

function assertStripeConfig(config: StripeConfig) {
  if (!stripeConfigs.has(config)) throw new PrimaryDomainError("STRIPE_TEST_PREFLIGHT_REQUIRED");
}

export class StripeTestModeAdapter implements PrimaryStripeAdapter {
  private readonly stripe: Stripe;
  constructor(private readonly config: StripeConfig) {
    assertStripeConfig(config);
    this.stripe = new Stripe(config.secretKey);
  }
  async createUnconfirmedIntent(input: { amountMinor: number; currency: string; metadata: Record<string, string>; idempotencyKey: string }) {
    const intent = await this.stripe.paymentIntents.create({ amount: input.amountMinor, currency: input.currency.toLowerCase(), metadata: input.metadata, confirm: false }, { idempotencyKey: input.idempotencyKey });
    return { id: intent.id, createdAt: new Date(intent.created * 1000) };
  }
  verifyWebhook(rawBody: string | Buffer, signature: string, webhookSecret: string): PrimaryProviderEvent {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    const intent = event.data.object as Stripe.PaymentIntent;
    if (!["payment_intent.processing", "payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.canceled"].includes(event.type)) throw new PrimaryDomainError("UNSUPPORTED_PROVIDER_EVENT");
    return { id: event.id, type: event.type as PrimaryProviderEvent["type"], intentId: intent.id, amountMinor: intent.amount, currency: intent.currency.toUpperCase(), metadata: intent.metadata, createdAt: new Date(event.created * 1000), terminalGuarantee: event.type === "payment_intent.canceled" };
  }
}

function cleanKey(value: string) {
  const result = value.trim();
  if (!result) throw new PrimaryDomainError("IDEMPOTENCY_KEY_REQUIRED");
  return result;
}

export class PrimaryPaymentService {
  constructor(private readonly db: Db, private readonly capability: PrimaryPreflightCapability, private readonly stripeConfig: StripeConfig, private readonly adapter: PrimaryStripeAdapter, private readonly orderService: PrimaryOrderService, private readonly clock: () => Date = () => new Date()) {
    assertStripeConfig(stripeConfig);
  }

  async createAttempt(input: { internalCapability: PrimaryOrderInternalCapability; organizerId: string; eventId: string; orderId: string; idempotencyKey: string; reconciliationDelayMs?: number }) {
    const idempotencyKey = cleanKey(input.idempotencyKey);
    const attempt = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PrimaryOrder" WHERE id = ${input.orderId} FOR UPDATE`;
      const existing = await tx.primaryPaymentAttempt.findUnique({ where: { createIdempotencyKey: idempotencyKey } });
      if (existing) {
        if (existing.orderId !== input.orderId || existing.organizerId !== input.organizerId || existing.eventId !== input.eventId) throw new PrimaryDomainError("IDEMPOTENCY_CONFLICT");
        return existing;
      }
      const order = await tx.primaryOrder.findFirst({ where: { id: input.orderId, organizerId: input.organizerId, eventId: input.eventId }, include: { reservation: true } });
      if (!order || !["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(order.status) || !["HELD", "PAYMENT_COMMITTED"].includes(order.reservation.status)) throw new PrimaryDomainError("ORDER_NOT_PAYMENT_PREPARABLE");
      const existingOrderAttempt = await tx.primaryPaymentAttempt.findUnique({ where: { orderId: order.id } });
      if (existingOrderAttempt) throw new PrimaryDomainError("ORDER_ALREADY_HAS_PAYMENT_ATTEMPT");
      const created = await tx.primaryPaymentAttempt.create({ data: { organizerId: order.organizerId, eventId: order.eventId, buyerUserId: order.buyerUserId, reservationId: order.reservationId, orderId: order.id, expectedAmountMinor: order.grossTotalMinor, currency: order.currency, createIdempotencyKey: idempotencyKey } });
      await this.audit(tx, created, "PAYMENT_ATTEMPT_CREATED", idempotencyKey);
      return created;
    }, { isolationLevel: "Serializable" });
    await this.orderService.prepareForPayment({ ...input, idempotencyKey: `payment:${input.orderId}:prepare` });
    if (attempt.providerIntentId) return attempt;
    const metadata = { primaryOrderId: attempt.orderId, organizerId: attempt.organizerId, eventId: attempt.eventId, reservationId: attempt.reservationId };
    try {
      const provider = await this.adapter.createUnconfirmedIntent({ amountMinor: attempt.expectedAmountMinor, currency: attempt.currency, metadata, idempotencyKey: `primary:${attempt.id}` });
      return await this.db.$transaction(async (tx) => {
        const current = await tx.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
        if (current.providerIntentId && current.providerIntentId !== provider.id) throw new PrimaryDomainError("PROVIDER_ID_CONFLICT");
        if (current.providerIntentId) return current;
        const updated = await tx.primaryPaymentAttempt.update({ where: { id: current.id }, data: { providerIntentId: provider.id, providerCreatedAt: provider.createdAt, status: "PROCESSING" } });
        await this.audit(tx, updated, "PAYMENT_PROVIDER_INTENT_ATTACHED", `${idempotencyKey}:provider`);
        return updated;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      await this.db.$transaction(async (tx) => {
        const current = await tx.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
        if (current.status === "PENDING_PROVIDER") {
          const updated = await tx.primaryPaymentAttempt.update({ where: { id: current.id }, data: { status: "RECONCILIATION_REQUIRED" } });
          await this.audit(tx, updated, "PAYMENT_RECONCILIATION_REQUIRED", `${idempotencyKey}:ambiguous`);
        }
      });
      throw error;
    }
  }

  async handleWebhook(rawBody: string | Buffer, signature: string) {
    const event = this.adapter.verifyWebhook(rawBody, signature, this.stripeConfig.webhookSecret);
    const digest = createHash("sha256").update(rawBody).digest("hex");
    return this.db.$transaction(async (tx) => {
      const prior = await tx.primaryPaymentProviderEvent.findUnique({ where: { providerEventId: event.id } });
      if (prior) {
        const priorAttempt = await tx.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: prior.attemptId } });
        const exact = prior.payloadDigest === digest && prior.eventType === event.type && prior.providerCreatedAt.getTime() === event.createdAt.getTime() && priorAttempt.providerIntentId === event.intentId;
        if (!exact) throw new PrimaryDomainError("PROVIDER_EVENT_CONFLICT");
        return prior;
      }
      let attempt = await tx.primaryPaymentAttempt.findUnique({ where: { providerIntentId: event.intentId } });
      if (!attempt) {
        const metadata = event.metadata;
        const candidate = await tx.primaryPaymentAttempt.findFirst({ where: { orderId: metadata.primaryOrderId, organizerId: metadata.organizerId, eventId: metadata.eventId, reservationId: metadata.reservationId, providerIntentId: null } });
        if (candidate && event.amountMinor === candidate.expectedAmountMinor && event.currency === candidate.currency) {
          attempt = await tx.primaryPaymentAttempt.update({ where: { id: candidate.id }, data: { providerIntentId: event.intentId, providerCreatedAt: event.createdAt, status: "PROCESSING" } });
        }
      }
      if (!attempt) throw new PrimaryDomainError("PAYMENT_ATTEMPT_NOT_FOUND");
      await tx.$queryRaw`SELECT id FROM "PrimaryOrder" WHERE id = ${attempt.orderId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "PrimaryInventoryReservation" WHERE id = ${attempt.reservationId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "PrimaryPaymentAttempt" WHERE id = ${attempt.id} FOR UPDATE`;
      const current = await tx.primaryPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      const stored = await tx.primaryPaymentProviderEvent.create({ data: { providerEventId: event.id, attemptId: current.id, orderId: current.orderId, organizerId: current.organizerId, eventId: current.eventId, buyerUserId: current.buyerUserId, reservationId: current.reservationId, eventType: event.type, payloadDigest: digest, providerCreatedAt: event.createdAt } });
      if (current.status === "SUCCEEDED") return stored;
      const metadataMatches = event.metadata.primaryOrderId === current.orderId && event.metadata.organizerId === current.organizerId && event.metadata.eventId === current.eventId && event.metadata.reservationId === current.reservationId;
      const valueMatches = event.amountMinor === current.expectedAmountMinor && event.currency === current.currency;
      if (!metadataMatches || !valueMatches) {
        const updated = await tx.primaryPaymentAttempt.update({ where: { id: current.id }, data: { status: "RECONCILIATION_REQUIRED" } });
        await tx.primaryPaymentException.create({ data: { attemptId: current.id, kind: "PROVIDER_MISMATCH", providerEventId: event.id } });
        await this.audit(tx, updated, "PAYMENT_RECONCILIATION_REQUIRED", event.id);
        return stored;
      }
      const reservation = await tx.primaryInventoryReservation.findUniqueOrThrow({ where: { id: current.reservationId } });
      if (event.type === "payment_intent.succeeded") {
        if (reservation.status !== "PAYMENT_COMMITTED") {
          const updated = await tx.primaryPaymentAttempt.update({ where: { id: current.id }, data: { status: "RECONCILIATION_REQUIRED", terminalAt: this.clock() } });
          await tx.primaryPaymentException.create({ data: { attemptId: current.id, kind: "LATE_SUCCESS_REFUND_REQUIRED", providerEventId: event.id } });
          await this.audit(tx, updated, "PAYMENT_LATE_SUCCESS_REFUND_REQUIRED", event.id);
        } else {
          const updated = await tx.primaryPaymentAttempt.update({ where: { id: current.id }, data: { status: "SUCCEEDED", terminalAt: this.clock() } });
          await tx.primaryOrder.update({ where: { id: current.orderId }, data: { status: "PAID", paidAt: this.clock() } });
          await this.audit(tx, updated, "PAYMENT_SUCCEEDED", event.id);
        }
      } else if ((event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") && event.terminalGuarantee) {
        if (reservation.status === "PAYMENT_COMMITTED") await tx.primaryInventoryReservation.update({ where: { id: reservation.id }, data: { status: "RELEASED", paymentCommittedAt: null, reconciliationAfter: null, releasedAt: this.clock() } });
        const updated = await tx.primaryPaymentAttempt.update({ where: { id: current.id }, data: { status: event.type === "payment_intent.canceled" ? "CANCELLED" : "FAILED", terminalAt: this.clock() } });
        await tx.primaryOrder.update({ where: { id: current.orderId }, data: { status: "PAYMENT_FAILED", paymentFailedAt: this.clock() } });
        await this.audit(tx, updated, "PAYMENT_TERMINAL_FAILURE", event.id);
      }
      return stored;
    }, { isolationLevel: "Serializable" });
  }

  private audit(tx: Tx, attempt: { id: string; organizerId: string; eventId: string; orderId: string; status: string }, action: string, key: string) {
    return recordPrimaryAuditAndOutbox(this.capability, tx, { organizerId: attempt.organizerId, eventId: attempt.eventId, actorType: "SYSTEM", action, targetType: "PrimaryPaymentAttempt", targetId: attempt.id, after: attempt, requestId: key, topic: `primary.payment.${action.toLowerCase()}`, payload: { organizerId: attempt.organizerId, eventId: attempt.eventId, targetId: attempt.id, orderId: attempt.orderId, status: attempt.status }, idempotencyKey: `${key}:${action.toLowerCase()}` });
  }
}
