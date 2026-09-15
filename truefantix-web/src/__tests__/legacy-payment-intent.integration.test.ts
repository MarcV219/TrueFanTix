/** @jest-environment node */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  claimLegacyPaymentIntentCommand,
  finalizeLegacyPaymentIntentCommand,
  LegacyPaymentIntentAuthorizationChangedError,
  markLegacyPaymentIntentReconciliationRequired,
  stageLegacyPaymentIntentCommand,
  type LegacyPaymentIntentProviderEvidence,
} from "@/lib/payments/legacyPaymentIntent";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) describe.skip("legacy payment-intent PostgreSQL boundary", () => {
  it("requires an isolated database", () => undefined);
}); else describe("legacy payment-intent PostgreSQL boundary", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const runId = `${Date.now()}-${process.pid}`;
  const sellerId = `payment-seller-${runId}`;
  const buyerSellerId = `payment-buyer-${runId}`;
  const buyerUserId = `payment-user-${runId}`;
  const orderId = `payment-order-${runId}`;
  const ticketId = `payment-ticket-${runId}`;
  const amountCents = 5495;
  const reservedUntil = new Date("2099-01-01T00:00:00.000Z");

  const successEvidence: LegacyPaymentIntentProviderEvidence = {
    id: `pi_success_${runId}`,
    status: "requires_payment_method",
    amountCents,
    currency: "cad",
    clientSecret: `pi_success_${runId}_secret_synthetic`,
  };

  function authorization() {
    return {
      orderId,
      buyerUserId,
      buyerSellerId,
      sellerId,
      expectedAmountCents: amountCents,
      currency: "CAD",
      priorPayment: null,
      ticketSnapshot: [{
        id: ticketId,
        status: "RESERVED",
        reservedByOrderId: orderId,
        reservedUntil: reservedUntil.toISOString(),
      }],
      authorizedAt: new Date(),
    };
  }

  async function stage() {
    return db.$transaction((tx) => stageLegacyPaymentIntentCommand(tx, authorization()), {
      isolationLevel: "Serializable",
    });
  }

  async function forceDeleteCommand() {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.legacyPaymentIntentCommand.deleteMany({ where: { orderId } });
    });
  }

  beforeAll(async () => {
    await db.seller.createMany({ data: [
      { id: sellerId, name: "Payment Seller" },
      { id: buyerSellerId, name: "Payment Buyer" },
    ] });
    await db.ticket.create({ data: {
      id: ticketId,
      title: "Synthetic Payment Ticket",
      priceCents: 5000,
      image: "synthetic.png",
      venue: "Synthetic Venue",
      date: "2098-12-31",
      status: "RESERVED",
      sellerId,
      reservedByOrderId: orderId,
      reservedUntil,
    } });
    await db.order.create({ data: {
      id: orderId,
      sellerId,
      buyerSellerId,
      status: "PENDING",
      amountCents: 5000,
      adminFeeCents: 495,
      totalCents: amountCents,
      currency: "CAD",
      items: { create: { ticketId, priceCents: 5000, currency: "CAD" } },
    } });
  });

  beforeEach(async () => {
    await forceDeleteCommand();
    await db.payment.deleteMany({ where: { orderId } });
    await db.order.update({ where: { id: orderId }, data: {
      status: "PENDING",
      buyerSellerId,
      sellerId,
      totalCents: amountCents,
      currency: "CAD",
    } });
    await db.ticket.update({ where: { id: ticketId }, data: {
      status: "RESERVED",
      reservedByOrderId: orderId,
      reservedUntil,
    } });
  });

  afterAll(async () => {
    await forceDeleteCommand();
    await db.payment.deleteMany({ where: { orderId } });
    await db.orderItem.deleteMany({ where: { orderId } });
    await db.order.delete({ where: { id: orderId } });
    await db.ticket.delete({ where: { id: ticketId } });
    await db.seller.deleteMany({ where: { id: { in: [sellerId, buyerSellerId] } } });
    await db.$disconnect();
    await pool.end();
  });

  it("rolls back authorization before a provider claim can exist", async () => {
    await expect(db.$transaction(async (tx) => {
      await stageLegacyPaymentIntentCommand(tx, authorization());
      throw new Error("force authorization rollback");
    }, { isolationLevel: "Serializable" })).rejects.toThrow("force authorization rollback");
    await expect(db.legacyPaymentIntentCommand.count({ where: { orderId } })).resolves.toBe(0);
  });

  it("reuses only the exact static checkout snapshot", async () => {
    const command = await stage();
    const replay = await db.$transaction((tx) => stageLegacyPaymentIntentCommand(tx, {
      ...authorization(),
      authorizedAt: new Date(command.authorizedAt.getTime() + 1_000),
    }));
    expect(replay.id).toBe(command.id);
    await expect(db.$transaction((tx) => stageLegacyPaymentIntentCommand(tx, {
      ...authorization(),
      expectedAmountCents: amountCents + 1,
    }))).rejects.toBeInstanceOf(LegacyPaymentIntentAuthorizationChangedError);
  });

  it("lets concurrent callers produce one provider dispatch owner", async () => {
    const command = await stage();
    const claims = await Promise.all([
      db.$transaction((tx) => claimLegacyPaymentIntentCommand(tx, command.id)),
      db.$transaction((tx) => claimLegacyPaymentIntentCommand(tx, command.id)),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await expect(db.legacyPaymentIntentCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({ status: "ATTEMPTING", providerIntentId: null });
  });

  it("keeps crash-after-claim evidence durable and non-resendable", async () => {
    const command = await stage();
    await db.$transaction((tx) => claimLegacyPaymentIntentCommand(tx, command.id));
    await expect(db.$transaction((tx) => claimLegacyPaymentIntentCommand(tx, command.id)))
      .resolves.toBeNull();
  });

  it("rejects mismatched provider amount and currency before Payment mutation", async () => {
    const command = await stage();
    await db.$transaction((tx) => claimLegacyPaymentIntentCommand(tx, command.id));
    await expect(db.$transaction((tx) => finalizeLegacyPaymentIntentCommand(tx, {
      commandId: command.id,
      buyerUserId,
      evidence: { ...successEvidence, amountCents: amountCents - 1, currency: "usd" },
    }))).rejects.toThrow("LEGACY_PAYMENT_INTENT_PROVIDER_EVIDENCE_MISMATCH");
    await expect(db.payment.count({ where: { orderId } })).resolves.toBe(0);
  });

  it("rolls back Payment on Tx2 failure and records provider reconciliation evidence", async () => {
    const command = await stage();
    await db.$transaction((tx) => claimLegacyPaymentIntentCommand(tx, command.id));
    await expect(db.$transaction(async (tx) => {
      await finalizeLegacyPaymentIntentCommand(tx, { commandId: command.id, buyerUserId, evidence: successEvidence });
      throw new Error("force Tx2 rollback");
    }, { isolationLevel: "Serializable" })).rejects.toThrow("force Tx2 rollback");
    await expect(db.payment.count({ where: { orderId } })).resolves.toBe(0);
    await db.$transaction((tx) => markLegacyPaymentIntentReconciliationRequired(
      tx,
      command.id,
      "PROVIDER_SUCCEEDED_LOCAL_FINALIZE_FAILED: force Tx2 rollback",
      { ...successEvidence, currency: "CAD" },
    ));
    await expect(db.legacyPaymentIntentCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({
        status: "RECONCILIATION_REQUIRED",
        providerIntentId: successEvidence.id,
        providerAmountCents: amountCents,
        providerCurrency: "CAD",
      });
  });

  it("atomically finalizes exact provider evidence and replays stored success", async () => {
    const command = await stage();
    await db.$transaction((tx) => claimLegacyPaymentIntentCommand(tx, command.id));
    await db.$transaction((tx) => finalizeLegacyPaymentIntentCommand(tx, {
      commandId: command.id,
      buyerUserId,
      evidence: successEvidence,
    }), { isolationLevel: "Serializable" });
    await expect(db.payment.findUniqueOrThrow({ where: { orderId } })).resolves.toMatchObject({
      provider: "STRIPE",
      providerRef: successEvidence.id,
      amountCents,
      currency: "CAD",
      status: "REQUIRES_PAYMENT",
    });
    const replay = await db.$transaction((tx) => stageLegacyPaymentIntentCommand(tx, {
      ...authorization(),
      priorPayment: {
        id: `unused-by-finalized-replay`,
        provider: "STRIPE",
        providerRef: successEvidence.id,
        amountCents,
        currency: "CAD",
      },
    }));
    expect(replay).toMatchObject({
      id: command.id,
      status: "SUCCEEDED",
      providerIntentId: successEvidence.id,
    });
    const [stored] = await db.$queryRaw<Array<{ evidence: Record<string, unknown> }>>`
      SELECT TO_JSONB(command) AS evidence
      FROM "LegacyPaymentIntentCommand" command
      WHERE command.id = ${command.id}
    `;
    expect(stored?.evidence).not.toHaveProperty("providerClientSecret");
    expect(JSON.stringify(stored?.evidence)).not.toContain(successEvidence.clientSecret);
    await expect(db.$transaction((tx) => claimLegacyPaymentIntentCommand(tx, command.id)))
      .resolves.toBeNull();
  });

  it("enforces immutable, append-only command history in PostgreSQL", async () => {
    const command = await stage();
    await expect(db.legacyPaymentIntentCommand.update({
      where: { id: command.id },
      data: { expectedAmountCents: amountCents + 1 },
    })).rejects.toThrow("authorization evidence is immutable");
    await expect(db.legacyPaymentIntentCommand.delete({ where: { id: command.id } }))
      .rejects.toThrow("evidence cannot be deleted");
    await expect(db.$executeRawUnsafe('TRUNCATE TABLE "LegacyPaymentIntentCommand"'))
      .rejects.toThrow("evidence cannot be truncated");
  });
});
