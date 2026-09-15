/** @jest-environment node */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  claimLegacyDisputeRefundIntent,
  finalizeLegacyDisputeRefund,
  LegacyDisputeRefundAuthorizationChangedError,
  markLegacyDisputeRefundFailed,
  markLegacyDisputeRefundReconciliationRequired,
  stageLegacyDisputeRefundIntent,
  type LegacyDisputeRefundProviderEvidence,
} from "@/lib/orders/legacyDisputeRefund";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) describe.skip("legacy dispute refund PostgreSQL boundary", () => {
  it("requires an isolated database", () => undefined);
}); else describe("legacy dispute refund PostgreSQL boundary", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const runId = `${Date.now()}-${process.pid}`;
  const adminId = `refund-admin-${runId}`;
  const sellerId = `refund-seller-${runId}`;
  const buyerSellerId = `refund-buyer-${runId}`;
  const orderId = `refund-order-${runId}`;
  const paymentId = `refund-payment-${runId}`;
  const ticketId = `refund-ticket-${runId}`;
  const amountCents = 12500;

  const successEvidence: LegacyDisputeRefundProviderEvidence = {
    id: `re_success_${runId}`,
    status: "succeeded",
    paymentIntent: `pi_${runId}`,
    amountCents,
    currency: "cad",
  };

  function authorization() {
    return {
      orderId,
      paymentId,
      authorizedByUserId: adminId,
      providerPaymentRef: `pi_${runId}`,
      expectedAmountCents: amountCents,
      currency: "CAD",
      authorizationReason: "Synthetic disputed-order refund authorization.",
      authorizationIpAddress: "127.0.0.1",
      authorizationUserAgent: "synthetic-refund-integration",
      authorizedAt: new Date(),
    };
  }

  async function stage() {
    return db.$transaction((tx) => stageLegacyDisputeRefundIntent(tx, authorization()), {
      isolationLevel: "Serializable",
    });
  }

  async function forceDeleteIntent() {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.legacyDisputeRefundIntent.deleteMany({ where: { orderId } });
    });
  }

  beforeAll(async () => {
    await db.seller.createMany({ data: [
      { id: sellerId, name: "Refund Seller" },
      { id: buyerSellerId, name: "Refund Buyer" },
    ] });
    await db.user.create({ data: {
      id: adminId,
      email: `refund-admin-${runId}@example.test`,
      passwordHash: "synthetic",
      firstName: "Refund",
      lastName: "Admin",
      phone: `+8${String(Date.now()).slice(-10)}`,
      streetAddress1: "1 Test Street",
      city: "Toronto",
      region: "ON",
      postalCode: "A1A1A1",
      country: "CA",
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      role: "ADMIN",
    } });
    await db.ticket.create({ data: {
      id: ticketId,
      title: "Synthetic Refund Ticket",
      priceCents: 11000,
      image: "synthetic.png",
      venue: "Synthetic Venue",
      date: "2027-01-01",
      status: "SOLD",
      sellerId,
    } });
    await db.order.create({ data: {
      id: orderId,
      sellerId,
      buyerSellerId,
      status: "PAID",
      amountCents: 11000,
      adminFeeCents: 1500,
      totalCents: amountCents,
      currency: "CAD",
      buyerConfirmationStatus: "DISPUTED",
      transferVerificationStatus: "MANUAL_REVIEW",
      transferVerificationReason: JSON.stringify({ type: "BUYER_DISPUTE", ticketIds: [ticketId] }),
      items: { create: { ticketId, priceCents: 11000, currency: "CAD" } },
      payment: { create: {
        id: paymentId,
        amountCents,
        currency: "CAD",
        status: "SUCCEEDED",
        provider: "STRIPE",
        providerRef: `pi_${runId}`,
      } },
    } });
    await db.ticketEscrow.create({ data: {
      ticketId,
      orderId,
      state: "IN_ESCROW",
      provider: "STRIPE",
      providerRef: `pi_${runId}`,
    } });
  });

  beforeEach(async () => {
    await forceDeleteIntent();
    await db.auditLog.deleteMany({ where: { targetType: "Order", targetId: orderId } });
    await db.accessTokenTransaction.deleteMany({ where: { orderId } });
    await db.payout.deleteMany({ where: { sellerId, providerRef: `order:${orderId}` } });
    await db.seller.update({ where: { id: sellerId }, data: { accessTokenBalance: 0 } });
    await db.order.update({ where: { id: orderId }, data: {
      status: "PAID",
      buyerConfirmationStatus: "DISPUTED",
      buyerConfirmationAt: null,
      transferVerificationStatus: "MANUAL_REVIEW",
      transferVerificationReason: JSON.stringify({ type: "BUYER_DISPUTE", ticketIds: [ticketId] }),
    } });
    await db.payment.update({ where: { id: paymentId }, data: {
      status: "SUCCEEDED",
      provider: "STRIPE",
      providerRef: `pi_${runId}`,
      amountCents,
      currency: "CAD",
    } });
    await db.ticket.update({ where: { id: ticketId }, data: {
      status: "SOLD",
      reservedByOrderId: null,
      reservedUntil: null,
    } });
    await db.ticketEscrow.update({ where: { ticketId }, data: {
      orderId,
      state: "IN_ESCROW",
      releasedTo: null,
      releasedAt: null,
      failureReason: null,
    } });
    await db.payout.create({ data: {
      sellerId,
      amountCents: 11000,
      netCents: 11000,
      status: "PENDING",
      provider: "ESCROW_INTERNAL",
      providerRef: `order:${orderId}`,
    } });
    await db.accessTokenTransaction.create({ data: {
      sellerId,
      type: "SPENT",
      source: "SOLD_OUT_PURCHASE",
      amountAccessTokens: 1,
      orderId,
      ticketId,
    } });
  });

  afterAll(async () => {
    await forceDeleteIntent();
    await db.auditLog.deleteMany({ where: { targetType: "Order", targetId: orderId } });
    await db.accessTokenTransaction.deleteMany({ where: { orderId } });
    await db.payout.deleteMany({ where: { sellerId } });
    await db.ticketEscrow.deleteMany({ where: { orderId } });
    await db.orderItem.deleteMany({ where: { orderId } });
    await db.payment.deleteMany({ where: { orderId } });
    await db.order.delete({ where: { id: orderId } });
    await db.ticket.delete({ where: { id: ticketId } });
    await db.user.delete({ where: { id: adminId } });
    await db.seller.deleteMany({ where: { id: { in: [sellerId, buyerSellerId] } } });
    await db.$disconnect();
    await pool.end();
  });

  it("rolls back authorization before any provider claimant can exist", async () => {
    await expect(db.$transaction(async (tx) => {
      await stageLegacyDisputeRefundIntent(tx, authorization());
      throw new Error("force authorization rollback");
    }, { isolationLevel: "Serializable" })).rejects.toThrow("force authorization rollback");

    await expect(db.legacyDisputeRefundIntent.count({ where: { orderId } })).resolves.toBe(0);
  });

  it("reuses only an exact persisted authorization snapshot", async () => {
    const intent = await stage();
    const replay = await db.$transaction((tx) => stageLegacyDisputeRefundIntent(tx, {
      ...authorization(),
      authorizedAt: new Date(intent.authorizedAt.getTime() + 60_000),
    }));

    expect(replay).toMatchObject({
      id: intent.id,
      authorizedByUserId: adminId,
      authorizationReason: "Synthetic disputed-order refund authorization.",
      authorizationIpAddress: "127.0.0.1",
      authorizationUserAgent: "synthetic-refund-integration",
      authorizedAt: intent.authorizedAt,
      commandDigest: intent.commandDigest,
    });

    await expect(db.$transaction((tx) => stageLegacyDisputeRefundIntent(tx, {
      ...authorization(),
      authorizedByUserId: `other-admin-${runId}`,
      authorizationReason: "Different authorization.",
    }))).rejects.toBeInstanceOf(LegacyDisputeRefundAuthorizationChangedError);
    await expect(db.legacyDisputeRefundIntent.findUniqueOrThrow({ where: { id: intent.id } }))
      .resolves.toMatchObject({ status: "NOT_SENT", authorizedByUserId: adminId });
  });

  it("refuses a shape-valid but snapshot-invalid digest before dispatch claim", async () => {
    const intent = await stage();
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.legacyDisputeRefundIntent.update({
        where: { id: intent.id },
        data: { commandDigest: "b".repeat(64) },
      });
    });

    await expect(db.$transaction((tx) => claimLegacyDisputeRefundIntent(tx, intent.id)))
      .rejects.toBeInstanceOf(LegacyDisputeRefundAuthorizationChangedError);
    await expect(db.legacyDisputeRefundIntent.findUniqueOrThrow({ where: { id: intent.id } }))
      .resolves.toMatchObject({ status: "NOT_SENT", dispatchStartedAt: null });
  });

  it("lets two concurrent callers produce one provider dispatch claim", async () => {
    const intent = await stage();
    let providerCalls = 0;
    const call = async () => {
      const claimed = await db.$transaction((tx) => claimLegacyDisputeRefundIntent(tx, intent.id));
      if (claimed) providerCalls += 1;
      return claimed;
    };

    const claims = await Promise.all([call(), call()]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(providerCalls).toBe(1);
    await expect(db.legacyDisputeRefundIntent.findUniqueOrThrow({ where: { id: intent.id } }))
      .resolves.toMatchObject({ status: "ATTEMPTING", providerRefundId: null });
  });

  it("keeps a crash-after-claim attempt durable and non-resendable", async () => {
    const intent = await stage();
    await db.$transaction((tx) => claimLegacyDisputeRefundIntent(tx, intent.id));

    await expect(db.$transaction((tx) => claimLegacyDisputeRefundIntent(tx, intent.id)))
      .resolves.toBeNull();
    await expect(db.legacyDisputeRefundIntent.findUniqueOrThrow({ where: { id: intent.id } }))
      .resolves.toMatchObject({ status: "ATTEMPTING", dispatchStartedAt: expect.any(Date) });
  });

  it("records an unknown provider outcome as terminal reconciliation work", async () => {
    const intent = await stage();
    await db.$transaction((tx) => claimLegacyDisputeRefundIntent(tx, intent.id));
    await db.$transaction((tx) => markLegacyDisputeRefundReconciliationRequired(
      tx,
      intent.id,
      "PROVIDER_OUTCOME_UNKNOWN: synthetic timeout",
    ));

    await expect(db.$transaction((tx) => claimLegacyDisputeRefundIntent(tx, intent.id)))
      .resolves.toBeNull();
    await expect(db.legacyDisputeRefundIntent.findUniqueOrThrow({ where: { id: intent.id } }))
      .resolves.toMatchObject({ status: "RECONCILIATION_REQUIRED", providerRefundId: null });
  });

  it("rolls back every local success mutation when finalization aborts", async () => {
    const intent = await stage();
    await db.$transaction((tx) => claimLegacyDisputeRefundIntent(tx, intent.id));

    await expect(db.$transaction(async (tx) => {
      await finalizeLegacyDisputeRefund(tx, {
        intentId: intent.id,
        authorizedByUserId: adminId,
        evidence: successEvidence,
      });
      throw new Error("force Tx2 rollback");
    }, { isolationLevel: "Serializable" })).rejects.toThrow("force Tx2 rollback");

    await expect(db.legacyDisputeRefundIntent.findUniqueOrThrow({ where: { id: intent.id } }))
      .resolves.toMatchObject({ status: "ATTEMPTING", providerRefundId: null });
    await expect(db.order.findUniqueOrThrow({ where: { id: orderId } }))
      .resolves.toMatchObject({ status: "PAID", buyerConfirmationStatus: "DISPUTED" });
    await expect(db.payment.findUniqueOrThrow({ where: { id: paymentId } }))
      .resolves.toMatchObject({ status: "SUCCEEDED" });
    await expect(db.ticket.findUniqueOrThrow({ where: { id: ticketId } }))
      .resolves.toMatchObject({ status: "SOLD" });
    await expect(db.auditLog.count({ where: { targetType: "Order", targetId: orderId } }))
      .resolves.toBe(0);
    await db.$transaction((tx) => markLegacyDisputeRefundReconciliationRequired(
      tx,
      intent.id,
      "PROVIDER_SUCCEEDED_LOCAL_FINALIZE_FAILED: force Tx2 rollback",
      successEvidence,
    ));
    await expect(db.legacyDisputeRefundIntent.findUniqueOrThrow({ where: { id: intent.id } }))
      .resolves.toMatchObject({
        status: "RECONCILIATION_REQUIRED",
        providerRefundId: successEvidence.id,
        providerStatus: "succeeded",
      });
  });

  it("atomically finalizes one exact provider success and refuses replay", async () => {
    const intent = await stage();
    await db.$transaction((tx) => claimLegacyDisputeRefundIntent(tx, intent.id));
    await db.$transaction((tx) => finalizeLegacyDisputeRefund(tx, {
      intentId: intent.id,
      authorizedByUserId: adminId,
      evidence: successEvidence,
    }), { isolationLevel: "Serializable" });

    await expect(db.legacyDisputeRefundIntent.findUniqueOrThrow({ where: { id: intent.id } }))
      .resolves.toMatchObject({ status: "SUCCEEDED", providerRefundId: successEvidence.id });
    await expect(db.order.findUniqueOrThrow({ where: { id: orderId } }))
      .resolves.toMatchObject({ status: "REFUNDED", buyerConfirmationStatus: "REFUNDED" });
    await expect(db.payment.findUniqueOrThrow({ where: { id: paymentId } }))
      .resolves.toMatchObject({ status: "REFUNDED" });
    await expect(db.ticket.findUniqueOrThrow({ where: { id: ticketId } }))
      .resolves.toMatchObject({ status: "WITHDRAWN" });
    await expect(db.ticketEscrow.findUniqueOrThrow({ where: { ticketId } }))
      .resolves.toMatchObject({ state: "RELEASED_BACK_TO_SELLER", releasedTo: sellerId });
    await expect(db.payout.findFirstOrThrow({ where: { sellerId, providerRef: `order:${orderId}` } }))
      .resolves.toMatchObject({ status: "CANCELED" });
    await expect(db.accessTokenTransaction.count({ where: { orderId, type: "REVERSAL", source: "REFUND" } }))
      .resolves.toBe(1);
    await expect(db.auditLog.count({ where: { targetType: "Order", targetId: orderId, action: "DISPUTE_RESOLVE" } }))
      .resolves.toBe(1);
    await expect(db.$transaction((tx) => finalizeLegacyDisputeRefund(tx, {
      intentId: intent.id,
      authorizedByUserId: adminId,
      evidence: successEvidence,
    }))).rejects.toThrow("LEGACY_DISPUTE_REFUND_NOT_OWNED");
  });

  it("rejects mismatched provider evidence without changing local state", async () => {
    const intent = await stage();
    await db.$transaction((tx) => claimLegacyDisputeRefundIntent(tx, intent.id));

    await expect(db.$transaction((tx) => finalizeLegacyDisputeRefund(tx, {
      intentId: intent.id,
      authorizedByUserId: adminId,
      evidence: { ...successEvidence, amountCents: amountCents - 1 },
    }))).rejects.toThrow("LEGACY_DISPUTE_REFUND_PROVIDER_EVIDENCE_MISMATCH");
    await expect(db.order.findUniqueOrThrow({ where: { id: orderId } }))
      .resolves.toMatchObject({ status: "PAID", buyerConfirmationStatus: "DISPUTED" });
    await expect(db.legacyDisputeRefundIntent.findUniqueOrThrow({ where: { id: intent.id } }))
      .resolves.toMatchObject({ status: "ATTEMPTING", providerRefundId: null });
  });

  it("enforces immutable authorization and exact terminal failure transitions in PostgreSQL", async () => {
    const intent = await stage();
    await expect(db.legacyDisputeRefundIntent.update({
      where: { id: intent.id },
      data: { authorizationReason: "forged reason" },
    })).rejects.toThrow("authorization evidence is immutable");
    await expect(db.legacyDisputeRefundIntent.delete({ where: { id: intent.id } }))
      .rejects.toThrow("evidence cannot be deleted");

    await db.$transaction((tx) => claimLegacyDisputeRefundIntent(tx, intent.id));
    const failedEvidence = {
      ...successEvidence,
      id: `re_failed_${runId}`,
      status: "failed",
    };
    await db.$transaction((tx) => markLegacyDisputeRefundFailed(
      tx,
      intent.id,
      failedEvidence,
      "Provider returned terminal failed evidence.",
    ));
    await expect(db.legacyDisputeRefundIntent.findUniqueOrThrow({ where: { id: intent.id } }))
      .resolves.toMatchObject({ status: "FAILED", providerRefundId: failedEvidence.id });
    await expect(db.legacyDisputeRefundIntent.update({
      where: { id: intent.id },
      data: { status: "NOT_SENT" },
    })).rejects.toThrow("Invalid legacy dispute refund state transition");
  });
});
