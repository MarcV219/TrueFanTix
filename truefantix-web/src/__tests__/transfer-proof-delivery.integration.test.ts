/** @jest-environment node */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { sendEmail } from "@/lib/email";
import { sendAdminActivityEmail } from "@/lib/adminActivityEmail";
import {
  drainTransferProofDeliveryIntents,
  stageTransferProofAdminDecisionDeliveryIntent,
  stageTransferProofDeliveryIntent,
} from "@/lib/orders/transferProofDelivery";

jest.mock("@/lib/email", () => ({
  generateBuyerTransferConfirmationRequiredEmail: jest.fn(() => ({ subject: "subject", text: "text" })),
  sendEmail: jest.fn(),
}));
jest.mock("@/lib/adminActivityEmail", () => ({
  ADMIN_ACTIVITY_EMAIL: "admin@truefantix.com",
  sendAdminActivityEmail: jest.fn(),
}));

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;
const mockedSendAdmin = sendAdminActivityEmail as jest.MockedFunction<typeof sendAdminActivityEmail>;
const NativeDate = globalThis.Date;
const shiftedDateOffset = NativeDate.now()
  - NativeDate.parse("2026-12-03T01:00:00.000Z");
// Keep the suite's historical deterministic timeline behind the database
// clock. Clock-boundary cases use NativeDate explicitly.
const Date = new Proxy(NativeDate, {
  construct(target, args) {
    if (args.length === 1 && typeof args[0] === "string" && args[0].startsWith("2026-12-")) {
      return new target(target.parse(args[0]) + shiftedDateOffset);
    }
    return Reflect.construct(target, args);
  },
}) as DateConstructor;

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Synthetic envelope is not JSON-serializable");
  return encoded;
}

function envelopeDigest(envelope: Record<string, unknown>) {
  return createHash("sha256").update(canonicalJson(envelope)).digest("hex");
}

function authoritativeCompletedAt(deadline: Date) {
  return new NativeDate(deadline.getTime() - 24 * 60 * 60 * 1000);
}

function normalizedWindowStart(clock: Date) {
  return new NativeDate(
    Math.floor(clock.getTime() / (6 * 60 * 60 * 1000)) * 6 * 60 * 60 * 1000,
  );
}

function authoritativeWindowStart(deadline: Date) {
  return normalizedWindowStart(authoritativeCompletedAt(deadline));
}

function buyerNotificationKey(targetOrderId: string, targetBuyerUserId: string, windowStart: Date) {
  const identity = [
    "transfer-proof-confirmation",
    targetOrderId,
    targetBuyerUserId,
    windowStart.toISOString(),
  ].join(":");
  return `tft-notification-${createHash("sha256").update(identity).digest("hex")}`;
}

if (!databaseUrl) describe.skip("transfer-proof delivery PostgreSQL boundary", () => {
  it("requires an isolated database", () => undefined);
}); else describe("transfer-proof delivery PostgreSQL boundary", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const runId = `${Date.now()}-${process.pid}`;
  const orderId = `transfer-proof-${runId}`;
  const sellerId = `transfer-proof-seller-${runId}`;
  const sellerUserId = `transfer-proof-seller-user-${runId}`;
  const buyerSellerId = `transfer-proof-buyer-seller-${runId}`;
  const buyerEmail = `transfer-proof-${runId}@example.test`;
  let buyerUserId = "";
  let previousResendKey: string | undefined;

  async function useHistoricalClaimClock() {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION transfer_proof_delivery_claim_clock(TIMESTAMP(3))
      RETURNS TIMESTAMP(3) AS $$
        SELECT LEAST($1, statement_timestamp() AT TIME ZONE 'UTC');
      $$ LANGUAGE SQL STABLE
    `);
  }

  async function useDatabaseClaimClock() {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION transfer_proof_delivery_claim_clock(TIMESTAMP(3))
      RETURNS TIMESTAMP(3) AS $$
        SELECT statement_timestamp() AT TIME ZONE 'UTC';
      $$ LANGUAGE SQL STABLE
    `);
  }

  async function useHistoricalOriginClock() {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION transfer_proof_delivery_origin_clock(TIMESTAMP(3))
      RETURNS TIMESTAMP(3) AS $$
        SELECT LEAST($1, clock_timestamp() AT TIME ZONE 'UTC');
      $$ LANGUAGE SQL VOLATILE
    `);
  }

  async function useDatabaseOriginClock() {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION transfer_proof_delivery_origin_clock(TIMESTAMP(3))
      RETURNS TIMESTAMP(3) AS $$
        SELECT clock_timestamp() AT TIME ZONE 'UTC';
      $$ LANGUAGE SQL VOLATILE
    `);
  }

  beforeAll(async () => {
    previousResendKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    // Most cases exercise a deterministic multi-attempt timeline without
    // waiting for real leases. Dedicated clock-boundary cases restore the
    // deployed database clock implementation explicitly.
    await useHistoricalClaimClock();
    await useHistoricalOriginClock();
    const buyer = await prisma.user.create({ data: {
      email: buyerEmail,
      passwordHash: "synthetic",
      firstName: "Buyer",
      lastName: "Boundary",
      phone: `+1${String(Date.now()).slice(-10)}`,
      streetAddress1: "1 Test Street",
      city: "Toronto",
      region: "ON",
      postalCode: "A1A1A1",
      country: "CA",
    } });
    buyerUserId = buyer.id;
    await prisma.seller.createMany({ data: [
      { id: sellerId, name: "Transfer Proof Seller" },
      { id: buyerSellerId, name: "Transfer Proof Buyer" },
    ] });
    await prisma.user.update({
      where: { id: buyerUserId },
      data: { sellerId: buyerSellerId },
    });
    await prisma.user.create({ data: {
      id: sellerUserId,
      email: "seller@example.test",
      passwordHash: "synthetic",
      firstName: "Seller",
      lastName: "Boundary",
      phone: `+3${String(Date.now()).slice(-10)}`,
      streetAddress1: "3 Test Street",
      city: "Toronto",
      region: "ON",
      postalCode: "A1A1A1",
      country: "CA",
      sellerId,
    } });
    await ensureSyntheticOrder(orderId);
  });

  beforeEach(async () => {
    await useHistoricalClaimClock();
    await useHistoricalOriginClock();
    await prisma.notification.deleteMany({ where: { userId: { in: [buyerUserId, sellerUserId] } } });
    await forceDeleteDeliveryIntents({ orderId });
    await prisma.reminderDelivery.deleteMany({ where: { orderId } });
    await prisma.emailDelivery.deleteMany({ where: { orderId } });
    await prisma.emailDelivery.deleteMany({ where: { orderId: { startsWith: `batch-order-${runId}-` } } });
    await forceDeleteDeliveryIntents({ orderId: { startsWith: `batch-order-${runId}-` } });
    await prisma.order.deleteMany({ where: { id: { startsWith: `batch-order-${runId}-` } } });
    await prisma.order.deleteMany({ where: { id: { startsWith: `${orderId}-` } } });
    jest.clearAllMocks();
    mockedSendEmail.mockResolvedValue({ ok: true, provider: "RESEND", providerResult: "ACCEPTED" });
    mockedSendAdmin.mockResolvedValue({ ok: true, provider: "RESEND" });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: [buyerUserId, sellerUserId] } } });
    await forceDeleteDeliveryIntents({ orderId });
    await prisma.reminderDelivery.deleteMany({ where: { orderId } });
    await prisma.emailDelivery.deleteMany({ where: { orderId } });
    await prisma.emailDelivery.deleteMany({ where: { orderId: { startsWith: `batch-order-${runId}-` } } });
    await forceDeleteDeliveryIntents({ orderId: { startsWith: `batch-order-${runId}-` } });
    await prisma.order.deleteMany({ where: { id: { startsWith: `batch-order-${runId}-` } } });
    await prisma.order.deleteMany({ where: { id: { startsWith: `${orderId}-` } } });
    await prisma.order.delete({ where: { id: orderId } });
    await prisma.user.deleteMany({ where: { id: { in: [buyerUserId, sellerUserId] } } });
    await prisma.seller.deleteMany({ where: { id: { in: [sellerId, buyerSellerId] } } });
    await useDatabaseClaimClock();
    await useDatabaseOriginClock();
    await prisma.$disconnect();
    await pool.end();
    if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResendKey;
  });

  function params(suffix: string) {
    const now = new Date(`2026-12-01T${suffix}:00:00.000Z`);
    return {
      orderId,
      buyerUserId,
      buyerEmail,
      buyerFirstName: "Buyer",
      sellerEmail: "seller@example.test",
      ticketCount: 1,
      transferProofType: "EMAIL",
      deadline: new Date("2026-12-03T00:00:00.000Z"),
      now,
    };
  }

  async function prepareAdminDecision(
    action: "APPROVE" | "REJECT" | "REQUEST_INFORMATION",
    decisionId: string,
    note = "Synthetic review decision.",
    decidedAt = new Date("2026-12-01T00:30:00.000Z"),
  ) {
    const decision = {
      id: decisionId,
      action,
      note,
      decidedAt: decidedAt.toISOString(),
      decidedByUserId: "synthetic-admin-user",
    };
    await prisma.order.update({
      where: { id: orderId },
      data: {
        transferVerificationStatus: action === "APPROVE" ? "PENDING" : action === "REJECT" ? "MISMATCHED" : "MANUAL_REVIEW",
        transferVerificationReason: JSON.stringify({ type: "TRANSFER_PROOF_ADMIN_REVIEW", ...decision }),
        transferProofData: JSON.stringify({ proofUpload: "synthetic", adminReviews: [decision] }),
        transferProofType: action === "APPROVE" ? "EMAIL" : null,
        disputeWindowEndsAt: action === "APPROVE" ? new Date(decidedAt.getTime() + 24 * 60 * 60 * 1000) : null,
      },
    });
    return { decidedAt, decision, note };
  }

  async function ensureSyntheticOrder(id: string) {
    await prisma.order.upsert({
      where: { id },
      update: {
        status: "PAID",
        buyerConfirmationStatus: "PENDING",
        transferProofType: "EMAIL",
        transferProofData: "synthetic-transfer-proof",
        transferVerificationStatus: "PENDING",
        disputeWindowEndsAt: new Date("2026-12-03T00:00:00.000Z"),
      },
      create: {
        id,
        sellerId,
        buyerSellerId,
        status: "PAID",
        amountCents: 100,
        adminFeeCents: 10,
        totalCents: 110,
        transferProofType: "EMAIL",
        transferProofData: "synthetic-transfer-proof",
        transferVerificationStatus: "PENDING",
        disputeWindowEndsAt: new Date("2026-12-03T00:00:00.000Z"),
      },
    });
    const ticketId = `${id}-ticket`;
    await prisma.ticket.upsert({
      where: { id: ticketId },
      update: {},
      create: {
        id: ticketId,
        title: "Synthetic Transfer Ticket",
        priceCents: 100,
        image: "/default.jpg",
        venue: "Synthetic Venue",
        date: "2026-12-10T00:00:00.000Z",
        sellerId,
      },
    });
    const item = await prisma.orderItem.findFirst({
      where: { orderId: id, ticketId },
      select: { id: true },
    });
    if (!item) await prisma.orderItem.create({ data: {
      orderId: id,
      ticketId,
      priceCents: 100,
    } });
  }

  async function seedAdminBatch(scope: string, count = 4) {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const batchOrderId = `batch-order-${runId}-${scope}-${index}`;
      const availableAt = new Date(`2026-12-01T00:0${index}:00.000Z`);
      await ensureSyntheticOrder(batchOrderId);
      await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, {
        orderId: batchOrderId,
        buyerUserId: null,
        buyerEmail,
        buyerFirstName: "Buyer",
        sellerEmail: "seller@example.test",
        ticketCount: 1,
        transferProofType: "EMAIL",
        deadline: new Date("2026-12-03T00:00:00.000Z"),
        now: availableAt,
      }));
      await forceDeleteDeliveryIntents({
        orderId: batchOrderId,
        kind: "BUYER_CONFIRMATION_EMAIL",
      });
      const row = await prisma.transferProofDeliveryIntent.findFirstOrThrow({
        where: { orderId: batchOrderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" },
      });
      ids.push(row.id);
    }
    return ids;
  }

  async function forceLegacyIntentState(
    where: Prisma.TransferProofDeliveryIntentWhereInput,
    data: Prisma.TransferProofDeliveryIntentUpdateManyMutationInput,
  ) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.transferProofDeliveryIntent.updateMany({ where, data });
    });
  }

  async function forceCreateDeliveryIntents(
    data: Prisma.TransferProofDeliveryIntentCreateManyInput[],
  ) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.transferProofDeliveryIntent.createMany({ data });
    });
  }

  async function forceDeleteDeliveryIntents(where: Prisma.TransferProofDeliveryIntentWhereInput) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.transferProofDeliveryIntent.deleteMany({ where });
    });
  }

  async function forceUpdateUser(
    where: Prisma.UserWhereUniqueInput,
    data: Prisma.UserUpdateInput,
  ) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.user.update({ where, data });
    });
  }

  async function databaseUtcNow() {
    const [row] = await prisma.$queryRaw<Array<{ now: Date }>>`
      SELECT statement_timestamp() AT TIME ZONE 'UTC' AS now
    `;
    return row.now;
  }

  it("rolls back all durable intents and performs zero external sends", async () => {
    await expect(prisma.$transaction(async (tx) => {
      await stageTransferProofDeliveryIntent(tx, params("01"));
      throw new Error("force rollback");
    }, { isolationLevel: "Serializable" })).rejects.toThrow("force rollback");

    await expect(prisma.notification.count({ where: { userId: buyerUserId } })).resolves.toBe(0);
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId } })).resolves.toBe(0);
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
  });

  it.each(["APPROVE", "REJECT", "REQUEST_INFORMATION"] as const)(
    "binds and delivers the canonical %s seller review decision",
    async (action) => {
      const decisionId = `decision-${action.toLowerCase()}-${runId}`;
      const { decidedAt, decision, note } = await prepareAdminDecision(action, decisionId);

      await prisma.$transaction((tx) => stageTransferProofAdminDecisionDeliveryIntent(tx, {
        orderId,
        decisionId,
        action,
        note,
        decidedAt,
        decidedByUserId: decision.decidedByUserId,
        sellerUserId,
        sellerEmail: "seller@example.test",
        sellerFirstName: "Seller",
      }));

      const staged = await prisma.transferProofDeliveryIntent.findFirstOrThrow({
        where: { orderId, kind: "SELLER_REVIEW_DECISION_EMAIL" },
      });
      expect(staged).toMatchObject({
        recipient: "seller@example.test",
        status: "PENDING",
        attemptCount: 0,
        identityVersion: 2,
      });
      await expect(prisma.notification.count({ where: { userId: sellerUserId } })).resolves.toBe(1);

      await expect(drainTransferProofDeliveryIntents({
        orderId,
        now: new Date(decidedAt.getTime() + 60_000),
      }, prisma)).resolves.toMatchObject({ delivered: 1, failed: 0 });
      expect(mockedSendEmail).toHaveBeenCalledWith(expect.objectContaining({
        to: "seller@example.test",
        subject: expect.stringContaining(orderId),
        idempotencyKey: expect.stringMatching(/^tft-transfer-proof-/),
        provider: "RESEND",
      }));
      await expect(prisma.emailDelivery.findFirst({
        where: { orderId, emailType: `TRANSFER_PROOF_ADMIN_${action}_${decisionId}` },
      })).resolves.toMatchObject({ status: "SENT", recipient: "seller@example.test" });
      await forceDeleteDeliveryIntents({ orderId, kind: "SELLER_REVIEW_DECISION_EMAIL" });
      await ensureSyntheticOrder(orderId);
    },
  );

  it("rejects a redigested seller decision whose note differs from durable review history", async () => {
    const decisionId = `decision-forged-${runId}`;
    const { decidedAt, decision } = await prepareAdminDecision("REJECT", decisionId, "Canonical note.");
    await expect(prisma.$transaction((tx) => stageTransferProofAdminDecisionDeliveryIntent(tx, {
      orderId,
      decisionId,
      action: "REJECT",
      note: "Forged note.",
      decidedAt,
      decidedByUserId: decision.decidedByUserId,
      sellerUserId,
      sellerEmail: "seller@example.test",
      sellerFirstName: "Seller",
    }))).rejects.toThrow(/latest durable decision/);
    await ensureSyntheticOrder(orderId);
  });

  it("rejects a seller notification user outside the database-authorized envelope and rolls back", async () => {
    const decisionId = `decision-wrong-user-${runId}`;
    const { decidedAt, decision, note } = await prepareAdminDecision("REJECT", decisionId);
    await expect(prisma.$transaction((tx) => stageTransferProofAdminDecisionDeliveryIntent(tx, {
      orderId,
      decisionId,
      action: "REJECT",
      note,
      decidedAt,
      decidedByUserId: decision.decidedByUserId,
      sellerUserId: buyerUserId,
      sellerEmail: "seller@example.test",
      sellerFirstName: "Seller",
    }))).rejects.toThrow(/environment and seller/);

    await expect(prisma.transferProofDeliveryIntent.count({ where: {
      orderId,
      kind: "SELLER_REVIEW_DECISION_EMAIL",
    } })).resolves.toBe(0);
    await expect(prisma.notification.count({ where: {
      userId: { in: [sellerUserId, buyerUserId] },
    } })).resolves.toBe(0);
    await ensureSyntheticOrder(orderId);
  });

  it("freezes the seller first name while a decision is active and releases it after delivery", async () => {
    const decisionId = `decision-name-fence-${runId}`;
    const { decidedAt, decision, note } = await prepareAdminDecision("REJECT", decisionId);
    await prisma.$transaction((tx) => stageTransferProofAdminDecisionDeliveryIntent(tx, {
      orderId,
      decisionId,
      action: "REJECT",
      note,
      decidedAt,
      decidedByUserId: decision.decidedByUserId,
      sellerUserId,
      sellerEmail: "seller@example.test",
      sellerFirstName: "Seller",
    }));

    await expect(prisma.user.update({
      where: { id: sellerUserId },
      data: { firstName: "Changed Seller" },
    })).rejects.toThrow(/name is immutable/);

    await forceLegacyIntentState({
      orderId,
      kind: "SELLER_REVIEW_DECISION_EMAIL",
    }, {
      status: "DELIVERED",
      deliveredAt: decidedAt,
    });
    await expect(prisma.user.update({
      where: { id: sellerUserId },
      data: { firstName: "Changed Seller" },
    })).resolves.toMatchObject({ firstName: "Changed Seller" });
    await prisma.user.update({ where: { id: sellerUserId }, data: { firstName: "Seller" } });
    await ensureSyntheticOrder(orderId);
  });

  it("delivers seller decisions FIFO across an older backoff and a newer eligible decision", async () => {
    const firstId = `decision-fifo-first-${runId}`;
    const firstAt = new Date("2026-12-01T00:30:00.000Z");
    const first = await prepareAdminDecision(
      "REQUEST_INFORMATION",
      firstId,
      "Upload the transfer receipt.",
      firstAt,
    );
    await prisma.$transaction((tx) => stageTransferProofAdminDecisionDeliveryIntent(tx, {
      orderId,
      decisionId: firstId,
      action: "REQUEST_INFORMATION",
      note: first.note,
      decidedAt: first.decidedAt,
      decidedByUserId: first.decision.decidedByUserId,
      sellerUserId,
      sellerEmail: "seller@example.test",
      sellerFirstName: "Seller",
    }));
    mockedSendEmail.mockResolvedValueOnce({
      ok: false,
      provider: "RESEND",
      providerResult: "REJECTED",
      error: "synthetic backoff",
    });
    await expect(drainTransferProofDeliveryIntents({
      orderId,
      now: new Date("2026-12-01T00:31:00.000Z"),
    }, prisma)).resolves.toMatchObject({ claimed: 1, delivered: 0, failed: 1 });

    const secondId = `decision-fifo-second-${runId}`;
    const secondAt = new Date("2026-12-01T00:32:00.000Z");
    const second = await prepareAdminDecision(
      "REJECT",
      secondId,
      "Upload a corrected transfer receipt.",
      secondAt,
    );
    await prisma.$transaction((tx) => stageTransferProofAdminDecisionDeliveryIntent(tx, {
      orderId,
      decisionId: secondId,
      action: "REJECT",
      note: second.note,
      decidedAt: second.decidedAt,
      decidedByUserId: second.decision.decidedByUserId,
      sellerUserId,
      sellerEmail: "seller@example.test",
      sellerFirstName: "Seller",
    }));

    await expect(drainTransferProofDeliveryIntents({
      orderId,
      now: new Date("2026-12-01T00:33:00.000Z"),
    }, prisma)).resolves.toMatchObject({ claimed: 0, delivered: 0 });
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);

    await expect(drainTransferProofDeliveryIntents({
      orderId,
      now: new Date("2026-12-01T00:37:00.000Z"),
    }, prisma)).resolves.toMatchObject({ claimed: 1, delivered: 1 });
    expect(mockedSendEmail).toHaveBeenCalledTimes(2);
    expect(mockedSendEmail.mock.calls[1]?.[0].text).toContain("Upload the transfer receipt.");

    await expect(drainTransferProofDeliveryIntents({
      orderId,
      now: new Date("2026-12-01T00:38:00.000Z"),
    }, prisma)).resolves.toMatchObject({ claimed: 1, delivered: 1 });
    expect(mockedSendEmail).toHaveBeenCalledTimes(3);
    expect(mockedSendEmail.mock.calls[2]?.[0].text).toContain("Upload a corrected transfer receipt.");
    await ensureSyntheticOrder(orderId);
  });

  it("rolls back the decision intent and seller notification without provider work", async () => {
    const decisionId = `decision-rollback-${runId}`;
    const { decidedAt, decision, note } = await prepareAdminDecision("REQUEST_INFORMATION", decisionId);

    await expect(prisma.$transaction(async (tx) => {
      await stageTransferProofAdminDecisionDeliveryIntent(tx, {
        orderId,
        decisionId,
        action: "REQUEST_INFORMATION",
        note,
        decidedAt,
        decidedByUserId: decision.decidedByUserId,
        sellerUserId,
        sellerEmail: "seller@example.test",
        sellerFirstName: "Seller",
      });
      throw new Error("force decision rollback");
    })).rejects.toThrow("force decision rollback");

    await expect(prisma.transferProofDeliveryIntent.count({ where: {
      orderId,
      kind: "SELLER_REVIEW_DECISION_EMAIL",
    } })).resolves.toBe(0);
    await expect(prisma.notification.count({ where: { userId: sellerUserId } })).resolves.toBe(0);
    expect(mockedSendEmail).not.toHaveBeenCalled();
    await ensureSyntheticOrder(orderId);
  });

  it.each([
    ["an extra field", (source: Prisma.JsonObject) => ({ ...source, injected: true })],
    ["a missing sellerFirstName field", (source: Prisma.JsonObject) => {
      const missing = { ...source };
      delete missing.sellerFirstName;
      return missing;
    }],
  ])("quarantines a seller decision with %s in its runtime payload shape", async (_label, poison) => {
    const decisionId = `decision-runtime-shape-${_label.replaceAll(" ", "-")}-${runId}`;
    const { decidedAt, decision, note } = await prepareAdminDecision("REJECT", decisionId);
    await prisma.$transaction((tx) => stageTransferProofAdminDecisionDeliveryIntent(tx, {
      orderId,
      decisionId,
      action: "REJECT",
      note,
      decidedAt,
      decidedByUserId: decision.decidedByUserId,
      sellerUserId,
      sellerEmail: "seller@example.test",
      sellerFirstName: "Seller",
    }));
    const row = await prisma.transferProofDeliveryIntent.findFirstOrThrow({
      where: { orderId, kind: "SELLER_REVIEW_DECISION_EMAIL", idempotencyKey: { contains: decisionId } },
    });
    const payloadJson = poison(row.payloadJson as Prisma.JsonObject);
    const envelope = { orderId, kind: row.kind, recipient: row.recipient, payloadJson };
    await forceLegacyIntentState({ id: row.id }, {
      payloadJson,
      envelopeDigest: envelopeDigest(envelope),
    });

    await expect(drainTransferProofDeliveryIntents({ orderId, now: decidedAt }, prisma))
      .resolves.toMatchObject({ claimed: 1, delivered: 0, failed: 1, reconciliationRequired: 1 });
    expect(mockedSendEmail).not.toHaveBeenCalled();
    await expect(prisma.transferProofDeliveryIntent.findUniqueOrThrow({
      where: { id: row.id },
      select: { status: true, attemptCount: true, lastError: true },
    })).resolves.toEqual({
      status: "RECONCILIATION_REQUIRED",
      attemptCount: 0,
      lastError: "Pre-dispatch delivery failure: Transfer-proof review-decision payload must have the canonical shape",
    });
    await forceDeleteDeliveryIntents({ id: row.id });
    await ensureSyntheticOrder(orderId);
  });

  it("does not let a caller clock reclaim or quarantine a live seller-decision claim", async () => {
    await useDatabaseClaimClock();
    const decisionId = `decision-live-clock-${runId}`;
    const { decidedAt, decision, note } = await prepareAdminDecision("REJECT", decisionId);
    await prisma.$transaction((tx) => stageTransferProofAdminDecisionDeliveryIntent(tx, {
      orderId,
      decisionId,
      action: "REJECT",
      note,
      decidedAt,
      decidedByUserId: decision.decidedByUserId,
      sellerUserId,
      sellerEmail: "seller@example.test",
      sellerFirstName: "Seller",
    }));
    const row = await prisma.transferProofDeliveryIntent.findFirstOrThrow({
      where: { orderId, kind: "SELLER_REVIEW_DECISION_EMAIL", idempotencyKey: { contains: decisionId } },
    });
    const databaseNow = await databaseUtcNow();
    const liveLeaseExpiresAt = new NativeDate(databaseNow.getTime() + 60 * 60 * 1000);
    await forceLegacyIntentState({ id: row.id }, {
      status: "PROCESSING",
      provider: "RESEND",
      attemptCount: 3,
      firstAttemptAt: databaseNow,
      processingAt: databaseNow,
      leaseExpiresAt: liveLeaseExpiresAt,
      claimToken: `live-seller-decision-${decisionId}`,
      dispatchStartedAt: databaseNow,
    });

    await expect(drainTransferProofDeliveryIntents({
      orderId,
      now: new NativeDate(liveLeaseExpiresAt.getTime() + 60 * 60 * 1000),
    }, prisma)).resolves.toMatchObject({ scanned: 0, claimed: 0, delivered: 0, reconciliationRequired: 0 });
    expect(mockedSendEmail).not.toHaveBeenCalled();
    await expect(prisma.transferProofDeliveryIntent.findUniqueOrThrow({ where: { id: row.id } }))
      .resolves.toMatchObject({
        status: "PROCESSING",
        provider: "RESEND",
        attemptCount: 3,
        leaseExpiresAt: liveLeaseExpiresAt,
        claimToken: `live-seller-decision-${decisionId}`,
        dispatchStartedAt: databaseNow,
      });
    await forceDeleteDeliveryIntents({ id: row.id });
    await ensureSyntheticOrder(orderId);
  });

  it("terminalizes an expired final seller-decision claim exactly once without another send", async () => {
    await useDatabaseClaimClock();
    const decisionId = `decision-expired-final-${runId}`;
    const { decidedAt, decision, note } = await prepareAdminDecision("REJECT", decisionId);
    await prisma.$transaction((tx) => stageTransferProofAdminDecisionDeliveryIntent(tx, {
      orderId,
      decisionId,
      action: "REJECT",
      note,
      decidedAt,
      decidedByUserId: decision.decidedByUserId,
      sellerUserId,
      sellerEmail: "seller@example.test",
      sellerFirstName: "Seller",
    }));
    const row = await prisma.transferProofDeliveryIntent.findFirstOrThrow({
      where: { orderId, kind: "SELLER_REVIEW_DECISION_EMAIL", idempotencyKey: { contains: decisionId } },
    });
    const databaseNow = await databaseUtcNow();
    const firstAttemptAt = new NativeDate(databaseNow.getTime() - 30 * 60 * 1000);
    const processingAt = new NativeDate(databaseNow.getTime() - 16 * 60 * 1000);
    const expiredLeaseExpiresAt = new NativeDate(databaseNow.getTime() - 60 * 1000);
    await forceLegacyIntentState({ id: row.id }, {
      status: "PROCESSING",
      provider: "RESEND",
      attemptCount: 3,
      firstAttemptAt,
      processingAt,
      leaseExpiresAt: expiredLeaseExpiresAt,
      claimToken: `expired-final-${decisionId}`,
      dispatchStartedAt: processingAt,
    });

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: row.id },
      data: {
        status: "RECONCILIATION_REQUIRED",
        lastError: "synthetic uncleared terminal",
      },
    })).rejects.toThrow("Invalid transfer-proof delivery lifecycle state");

    const forgedFuture = new NativeDate(databaseNow.getTime() + 365 * 24 * 60 * 60 * 1000);
    await expect(drainTransferProofDeliveryIntents({ orderId, now: forgedFuture }, prisma))
      .resolves.toMatchObject({ scanned: 0, claimed: 0, delivered: 0, reconciliationRequired: 1 });
    await expect(drainTransferProofDeliveryIntents({ orderId, now: forgedFuture }, prisma))
      .resolves.toMatchObject({ scanned: 0, claimed: 0, delivered: 0, reconciliationRequired: 0 });
    expect(mockedSendEmail).not.toHaveBeenCalled();
    await expect(prisma.transferProofDeliveryIntent.findUniqueOrThrow({ where: { id: row.id } }))
      .resolves.toMatchObject({
        status: "RECONCILIATION_REQUIRED",
        provider: "RESEND",
        attemptCount: 3,
        firstAttemptAt,
        processingAt: null,
        leaseExpiresAt: null,
        claimToken: null,
        dispatchStartedAt: null,
        lastError: "Expired final transfer-proof delivery claim requires provider reconciliation",
      });
    await forceDeleteDeliveryIntents({ id: row.id });
    await ensureSyntheticOrder(orderId);
  });

  it("records seller-decision lifecycle evidence at the database clock", async () => {
    await useDatabaseClaimClock();
    const decisionId = `decision-evidence-clock-${runId}`;
    const { decidedAt, decision, note } = await prepareAdminDecision("REJECT", decisionId);
    await prisma.$transaction((tx) => stageTransferProofAdminDecisionDeliveryIntent(tx, {
      orderId,
      decisionId,
      action: "REJECT",
      note,
      decidedAt,
      decidedByUserId: decision.decidedByUserId,
      sellerUserId,
      sellerEmail: "seller@example.test",
      sellerFirstName: "Seller",
    }));
    const beforeDrain = await databaseUtcNow();
    const forgedFuture = new NativeDate(beforeDrain.getTime() + 365 * 24 * 60 * 60 * 1000);

    await expect(drainTransferProofDeliveryIntents({ orderId, now: forgedFuture }, prisma))
      .resolves.toMatchObject({ claimed: 1, delivered: 1, failed: 0 });
    const afterDrain = await databaseUtcNow();
    const delivered = await prisma.transferProofDeliveryIntent.findFirstOrThrow({
      where: { orderId, kind: "SELLER_REVIEW_DECISION_EMAIL", idempotencyKey: { contains: decisionId } },
    });
    const email = await prisma.emailDelivery.findFirstOrThrow({
      where: { orderId, emailType: `TRANSFER_PROOF_ADMIN_REJECT_${decisionId}` },
    });
    for (const timestamp of [delivered.firstAttemptAt, delivered.deliveredAt, email.sentAt]) {
      expect(timestamp).not.toBeNull();
      expect(timestamp!.getTime()).toBeGreaterThanOrEqual(beforeDrain.getTime());
      expect(timestamp!.getTime()).toBeLessThanOrEqual(afterDrain.getTime());
      expect(timestamp).not.toEqual(forgedFuture);
    }
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    await forceDeleteDeliveryIntents({ id: delivered.id });
    await ensureSyntheticOrder(orderId);
  });

  it("rolls back accepted proof state, delivery intents, and notification together", async () => {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        transferProofType: null,
        transferProofData: null,
        transferVerificationStatus: null,
        transferVerificationReason: null,
        disputeWindowEndsAt: null,
      },
    });
    const accepted = params("01");

    await expect(prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      await tx.order.update({
        where: { id: orderId },
        data: {
          transferProofType: accepted.transferProofType,
          transferProofData: "synthetic-accepted-proof",
          transferVerificationStatus: "PENDING",
          transferVerificationReason: "synthetic-accepted-review",
          disputeWindowEndsAt: accepted.deadline,
        },
      });
      await stageTransferProofDeliveryIntent(tx, accepted);
      throw new Error("force accepted-proof rollback");
    }, { isolationLevel: "Serializable" })).rejects.toThrow("force accepted-proof rollback");

    await expect(prisma.order.findUniqueOrThrow({ where: { id: orderId } }))
      .resolves.toMatchObject({
        transferProofType: null,
        transferProofData: null,
        transferVerificationStatus: null,
        transferVerificationReason: null,
        disputeWindowEndsAt: null,
      });
    await expect(prisma.notification.count({ where: { userId: buyerUserId } })).resolves.toBe(0);
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId } })).resolves.toBe(0);
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
  });

  it("makes a waiting human-review boundary observe and refuse committed acceptance", async () => {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        transferProofType: null,
        transferProofData: null,
        transferVerificationStatus: null,
        transferVerificationReason: null,
        disputeWindowEndsAt: null,
      },
    });
    const accepted = params("01");
    let releaseAcceptance: () => void = () => undefined;
    const acceptanceHeld = new Promise<void>((resolve) => { releaseAcceptance = resolve; });
    let acceptanceLocked: () => void = () => undefined;
    const acceptanceReady = new Promise<void>((resolve) => { acceptanceLocked = resolve; });
    const acceptance = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
      await tx.order.update({
        where: { id: orderId },
        data: {
          transferProofType: accepted.transferProofType,
          transferProofData: "synthetic-accepted-proof",
          transferVerificationStatus: "PENDING",
          transferVerificationReason: "synthetic-accepted-review",
          disputeWindowEndsAt: accepted.deadline,
        },
      });
      await stageTransferProofDeliveryIntent(tx, accepted);
      acceptanceLocked();
      await acceptanceHeld;
    }, { isolationLevel: "Serializable" });

    await acceptanceReady;
    const humanReviewClient = await pool.connect();
    try {
      await humanReviewClient.query("BEGIN");
      let humanReviewSettled = false;
      const humanReviewRead = humanReviewClient.query<{
        transferProofData: string | null;
        acceptedProof: boolean;
      }>(`
        SELECT "transferProofData", "disputeWindowEndsAt" IS NOT NULL AS "acceptedProof"
        FROM "Order"
        WHERE id = $1
        FOR UPDATE
      `, [orderId]).finally(() => { humanReviewSettled = true; });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(humanReviewSettled).toBe(false);
      releaseAcceptance();
      await acceptance;

      const lockedOrder = (await humanReviewRead).rows[0];
      expect(lockedOrder.transferProofData).toBe("synthetic-accepted-proof");
      expect(lockedOrder.acceptedProof).toBe(true);
      // The route's locked-state branch returns its 409 here, before any
      // review mutation or delivery. Roll back the synthetic reader exactly
      // as that refusal leaves the database unchanged.
      await humanReviewClient.query("ROLLBACK");

      await expect(prisma.order.findUniqueOrThrow({ where: { id: orderId } }))
        .resolves.toMatchObject({
          transferProofData: "synthetic-accepted-proof",
          disputeWindowEndsAt: accepted.deadline,
          transferVerificationStatus: "PENDING",
        });
      await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId } })).resolves.toBe(2);
      await expect(prisma.notification.count({ where: { userId: buyerUserId } })).resolves.toBe(1);
      await expect(prisma.emailDelivery.count({ where: { orderId } })).resolves.toBe(0);
      expect(mockedSendEmail).not.toHaveBeenCalled();
      expect(mockedSendAdmin).not.toHaveBeenCalled();
    } finally {
      releaseAcceptance();
      await acceptance.catch(() => undefined);
      await humanReviewClient.query("ROLLBACK").catch(() => undefined);
      humanReviewClient.release();
    }
  });

  it("preserves transfer-proof delivery identity and history", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("01")));
    const intent = await prisma.transferProofDeliveryIntent.findFirstOrThrow({
      where: { orderId },
      select: { id: true },
    });
    const replacementId = `${intent.id}-replacement`;

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: intent.id },
      data: { id: replacementId },
    })).rejects.toThrow("Transfer-proof delivery row identity is immutable");
    await expect(prisma.transferProofDeliveryIntent.deleteMany({ where: { orderId } }))
      .rejects.toThrow("Transfer-proof delivery intents are append-only");
    await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "TransferProofDeliveryIntent"'))
      .rejects.toThrow("Transfer-proof delivery intents are append-only");
    await expect(prisma.transferProofDeliveryIntent.findUnique({ where: { id: intent.id } }))
      .resolves.toBeTruthy();
    await expect(prisma.transferProofDeliveryIntent.findUnique({ where: { id: replacementId } }))
      .resolves.toBeNull();
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId } }))
      .resolves.toBe(2);
  });

  it("anchors transfer-proof delivery history to its immutable parent order", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("01")));

    await expect(prisma.order.delete({ where: { id: orderId } }))
      .rejects.toThrow(/foreign key constraint|violates foreign key|order item membership is immutable/i);
    await expect(prisma.order.update({
      where: { id: orderId },
      data: { id: `${orderId}-rekeyed` },
    })).rejects.toThrow(/foreign key constraint|violates foreign key/i);
    await expect(prisma.order.findUnique({ where: { id: orderId } }))
      .resolves.toBeTruthy();
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId } }))
      .resolves.toBe(2);
  });

  it("prevents parent snapshot and item-membership drift after version-2 delivery staging", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("01")));

    await expect(prisma.order.update({
      where: { id: orderId },
      data: { sellerId: buyerSellerId },
    })).rejects.toThrow("Transfer-proof delivery order snapshot is immutable");
    await expect(prisma.order.update({
      where: { id: orderId },
      data: { buyerSellerId: sellerId },
    })).rejects.toThrow("Transfer-proof delivery order snapshot is immutable");
    await expect(prisma.order.update({
      where: { id: orderId },
      data: { transferProofType: "OTHER" },
    })).rejects.toThrow("Transfer-proof delivery order snapshot is immutable");
    await expect(prisma.order.update({
      where: { id: orderId },
      data: { disputeWindowEndsAt: new Date("2026-12-03T01:00:00.000Z") },
    })).rejects.toThrow("Transfer-proof delivery order snapshot is immutable");
    await expect(prisma.user.update({
      where: { id: sellerUserId },
      data: { email: "changed-seller@example.test" },
    })).rejects.toThrow("Active transfer-proof delivery participant email is immutable");
    await expect(prisma.user.update({
      where: { id: buyerUserId },
      data: { email: `changed-${buyerEmail}` },
    })).rejects.toThrow("Active transfer-proof delivery participant email is immutable");
    await expect(prisma.user.update({
      where: { id: buyerUserId },
      data: { firstName: "Changed Buyer" },
    })).rejects.toThrow("Active transfer-proof delivery buyer name is immutable");
    await expect(prisma.user.update({
      where: { id: buyerUserId },
      data: { sellerId: null },
    })).rejects.toThrow("Active transfer-proof delivery participant identity is immutable");

    const existingItem = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    await expect(prisma.orderItem.create({ data: {
      id: `${orderId}-forged-second-item`,
      orderId,
      ticketId: existingItem.ticketId,
      priceCents: existingItem.priceCents,
    } })).rejects.toThrow("Transfer-proof delivery order item membership is immutable");
    await expect(prisma.orderItem.delete({ where: { id: existingItem.id } }))
      .rejects.toThrow("Transfer-proof delivery order item membership is immutable");

    // Lifecycle fields and non-membership item evidence remain outside this
    // narrow reverse guard.
    await expect(prisma.order.update({
      where: { id: orderId },
      data: { transferVerificationStatus: "MATCHED" },
    })).resolves.toMatchObject({ transferVerificationStatus: "MATCHED" });
    await expect(prisma.orderItem.update({
      where: { id: existingItem.id },
      data: { priceCents: existingItem.priceCents },
    })).resolves.toMatchObject({ id: existingItem.id });
    await expect(prisma.user.update({
      where: { id: buyerUserId },
      data: { lastName: "Lifecycle Change" },
    })).resolves.toMatchObject({ lastName: "Lifecycle Change" });
    await prisma.order.update({
      where: { id: orderId },
      data: { transferVerificationStatus: "PENDING" },
    });
    await prisma.user.update({
      where: { id: buyerUserId },
      data: { lastName: "Boundary" },
    });
  });

  it("binds new transfer-proof deliveries to the locked order state and buyer", async () => {
    const otherSellerId = `${buyerSellerId}-other`;
    const otherUserId = `${buyerUserId}-other`;
    const otherOrderId = `${orderId}-other-buyer`;
    const otherEmail = `other-${buyerEmail}`;
    const sameBuyerOrderId = `${orderId}-same-buyer`;
    const sameBuyerSecondTicketId = `${sameBuyerOrderId}-second-ticket`;
    await prisma.seller.create({ data: { id: otherSellerId, name: "Other Transfer Buyer" } });
    await prisma.user.create({ data: {
      id: otherUserId,
      email: otherEmail,
      passwordHash: "synthetic",
      firstName: "Other",
      lastName: "Buyer",
      phone: `+2${String(Date.now()).slice(-10)}`,
      streetAddress1: "2 Test Street",
      city: "Toronto",
      region: "ON",
      postalCode: "A1A1A1",
      country: "CA",
      sellerId: otherSellerId,
    } });
    await prisma.order.create({ data: {
      id: otherOrderId,
      sellerId,
      buyerSellerId: otherSellerId,
      status: "PAID",
      amountCents: 100,
      adminFeeCents: 10,
      totalCents: 110,
      transferProofType: "EMAIL",
      transferProofData: "synthetic-transfer-proof",
      transferVerificationStatus: "PENDING",
      disputeWindowEndsAt: new Date("2026-12-03T00:00:00.000Z"),
    } });
    await ensureSyntheticOrder(sameBuyerOrderId);
    await prisma.order.update({
      where: { id: sameBuyerOrderId },
      data: { disputeWindowEndsAt: new Date("2026-12-04T00:00:00.000Z") },
    });
    await prisma.ticket.create({ data: {
      id: sameBuyerSecondTicketId,
      title: "Second Same-Buyer Transfer Ticket",
      priceCents: 100,
      image: "/default.jpg",
      venue: "Synthetic Venue",
      date: "2026-12-10T00:00:00.000Z",
      sellerId,
    } });
    await prisma.orderItem.create({ data: {
      orderId: sameBuyerOrderId,
      ticketId: sameBuyerSecondTicketId,
      priceCents: 100,
    } });

    try {
      await expect(prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, {
        ...params("02"), buyerEmail: otherEmail,
      }))).rejects.toThrow(
        "Transfer-proof buyer delivery recipient must match the order buyer",
      );
      await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId } }))
        .resolves.toBe(0);

      await expect(prisma.transferProofDeliveryIntent.create({ data: {
        orderId,
        kind: "BUYER_CONFIRMATION_EMAIL",
        recipient: buyerEmail,
        payloadJson: {
          buyerFirstName: "Buyer",
          ticketCount: 2,
          deadline: params("02").deadline.toISOString(),
          windowStart: authoritativeWindowStart(params("02").deadline).toISOString(),
        },
        idempotencyKey: `${orderId}-wrong-ticket-count`,
        identityVersion: 2,
        envelopeDigest: "0".repeat(64),
      } })).rejects.toThrow(
        "Transfer-proof delivery payload must match the order ticket count and deadline",
      );
      await expect(prisma.transferProofDeliveryIntent.create({ data: {
        orderId: sameBuyerOrderId,
        kind: "BUYER_CONFIRMATION_EMAIL",
        recipient: buyerEmail,
        payloadJson: {
          buyerFirstName: "Buyer",
          ticketCount: 1,
          deadline: params("02").deadline.toISOString(),
          windowStart: "2026-12-01T00:00:00.000Z",
        },
        idempotencyKey: `${sameBuyerOrderId}-copied-order-payload`,
        identityVersion: 2,
        envelopeDigest: "0".repeat(64),
      } })).rejects.toThrow(
        "Transfer-proof delivery payload must match the order ticket count and deadline",
      );
      await expect(prisma.transferProofDeliveryIntent.create({ data: {
        orderId,
        kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL",
        recipient: "admin@truefantix.com",
        payloadJson: {
          sellerEmail: "unrelated-seller@example.test",
          buyerEmail,
          ticketCount: 1,
          transferProofType: "EMAIL",
          deadline: params("02").deadline.toISOString(),
          completedAt: authoritativeCompletedAt(params("02").deadline).toISOString(),
        },
        idempotencyKey: `${orderId}-wrong-admin-subject`,
        identityVersion: 2,
        envelopeDigest: "0".repeat(64),
      } })).rejects.toThrow(
        "Transfer-proof administrator delivery payload must match the order participants and proof",
      );
      await expect(prisma.transferProofDeliveryIntent.create({ data: {
        orderId,
        kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL",
        recipient: "admin@truefantix.com",
        payloadJson: {
          sellerEmail: "seller@example.test",
          buyerEmail: otherEmail,
          ticketCount: 1,
          transferProofType: "EMAIL",
          deadline: params("02").deadline.toISOString(),
          completedAt: authoritativeCompletedAt(params("02").deadline).toISOString(),
        },
        idempotencyKey: `${orderId}-wrong-admin-buyer`,
        identityVersion: 2,
        envelopeDigest: "0".repeat(64),
      } })).rejects.toThrow(
        "Transfer-proof administrator delivery payload must match the order participants and proof",
      );
      await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId } }))
        .resolves.toBe(0);

      await prisma.order.update({ where: { id: orderId }, data: { status: "PENDING" } });
      await expect(prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("02"))))
        .rejects.toThrow("Transfer-proof delivery requires an eligible paid transfer-proof order");
      await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId } }))
        .resolves.toBe(0);
    } finally {
      await ensureSyntheticOrder(orderId);
      await prisma.orderItem.deleteMany({ where: { orderId: sameBuyerOrderId } });
      await prisma.order.delete({ where: { id: sameBuyerOrderId } });
      await prisma.ticket.deleteMany({ where: {
        id: { in: [`${sameBuyerOrderId}-ticket`, sameBuyerSecondTicketId] },
      } });
      await prisma.order.delete({ where: { id: otherOrderId } });
      await prisma.user.delete({ where: { id: otherUserId } });
      await prisma.seller.delete({ where: { id: otherSellerId } });
    }
  });

  it("binds the canonical delivery key and digest before a forged row can reserve them", async () => {
    const input = params("02");
    const windowStart = authoritativeWindowStart(input.deadline).toISOString();
    const payloadJson = {
      buyerFirstName: "Buyer",
      ticketCount: 1,
      deadline: input.deadline.toISOString(),
      windowStart,
    };
    const envelope = {
      orderId,
      kind: "BUYER_CONFIRMATION_EMAIL",
      recipient: buyerEmail,
      payloadJson,
    };
    const idempotencyKey = `${orderId}:${windowStart}:BUYER_CONFIRMATION_EMAIL:${buyerEmail}`;

    await expect(prisma.transferProofDeliveryIntent.create({ data: {
      ...envelope,
      idempotencyKey,
      identityVersion: 2,
      envelopeDigest: "0".repeat(64),
    } })).rejects.toThrow(
      "Transfer-proof delivery digest must match its canonical envelope",
    );
    await expect(prisma.transferProofDeliveryIntent.create({ data: {
      ...envelope,
      idempotencyKey: `${idempotencyKey}:forged`,
      identityVersion: 2,
      envelopeDigest: envelopeDigest(envelope),
    } })).rejects.toThrow(
      "Transfer-proof delivery idempotency key must match its canonical envelope",
    );
    await expect(prisma.transferProofDeliveryIntent.create({ data: {
      ...envelope,
      payloadJson: { ...payloadJson, injected: true },
      idempotencyKey,
      identityVersion: 2,
      envelopeDigest: envelopeDigest({ ...envelope, payloadJson: { ...payloadJson, injected: true } }),
    } })).rejects.toThrow(
      "Transfer-proof buyer delivery payload must have the canonical shape",
    );
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId } }))
      .resolves.toBe(0);

    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, input));
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId } }))
      .resolves.toBe(2);
  });

  it("rejects self-consistent delivery identities with caller-selected clocks", async () => {
    const input = params("02");
    const forgedWindow = new NativeDate(
      authoritativeWindowStart(input.deadline).getTime() + 6 * 60 * 60 * 1000,
    ).toISOString();
    const buyerPayload = {
      buyerFirstName: "Buyer",
      ticketCount: 1,
      deadline: input.deadline.toISOString(),
      windowStart: forgedWindow,
    };
    const buyerEnvelope = {
      orderId,
      kind: "BUYER_CONFIRMATION_EMAIL",
      recipient: buyerEmail,
      payloadJson: buyerPayload,
    };
    await expect(prisma.transferProofDeliveryIntent.create({ data: {
      ...buyerEnvelope,
      idempotencyKey: `${orderId}:${forgedWindow}:BUYER_CONFIRMATION_EMAIL:${buyerEmail}`,
      identityVersion: 2,
      envelopeDigest: envelopeDigest(buyerEnvelope),
    } })).rejects.toThrow(
      "Transfer-proof buyer delivery window must match the order transfer clock",
    );

    const forgedCompletedAt = new NativeDate(
      authoritativeCompletedAt(input.deadline).getTime() + 60 * 60 * 1000,
    ).toISOString();
    const adminPayload = {
      sellerEmail: "seller@example.test",
      buyerEmail,
      ticketCount: 1,
      transferProofType: "EMAIL",
      deadline: input.deadline.toISOString(),
      completedAt: forgedCompletedAt,
    };
    const adminEnvelope = {
      orderId,
      kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL",
      recipient: "admin@truefantix.com",
      payloadJson: adminPayload,
    };
    await expect(prisma.transferProofDeliveryIntent.create({ data: {
      ...adminEnvelope,
      idempotencyKey: `${orderId}:${normalizedWindowStart(new NativeDate(forgedCompletedAt)).toISOString()}:ADMIN_TRANSFER_ACTIVITY_EMAIL:admin@truefantix.com`,
      identityVersion: 2,
      envelopeDigest: envelopeDigest(adminEnvelope),
    } })).rejects.toThrow(
      "Transfer-proof administrator delivery completion must match the order transfer clock",
    );
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId } }))
      .resolves.toBe(0);
  });

  it("fails loudly when surviving legacy history owns a canonical key with another envelope", async () => {
    const input = params("02");
    const windowStart = authoritativeWindowStart(input.deadline).toISOString();
    const poisonedPayload = {
      buyerFirstName: "Buyer",
      ticketCount: 1,
      deadline: input.deadline.toISOString(),
      windowStart,
    };
    const idempotencyKey = `${orderId}:${windowStart}:BUYER_CONFIRMATION_EMAIL:${buyerEmail}`;
    await forceCreateDeliveryIntents([{
      orderId,
      kind: "BUYER_CONFIRMATION_EMAIL",
      recipient: buyerEmail,
      payloadJson: poisonedPayload,
      idempotencyKey,
      identityVersion: 1,
      envelopeDigest: null,
    }]);

    await expect(prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, input)))
      .rejects.toThrow(
        "Transfer-proof delivery idempotency collision does not match the canonical envelope",
      );
    await expect(prisma.notification.count({ where: { userId: buyerUserId } }))
      .resolves.toBe(0);
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId } }))
      .resolves.toBe(1);
  });

  it("collapses caller clocks and idempotently retries concurrent staging", async () => {
    const deadline = params("02").deadline;
    const windowStartMs = Math.floor(NativeDate.now() / (6 * 60 * 60 * 1000)) * 6 * 60 * 60 * 1000;
    const first = { ...params("02"), deadline, now: new NativeDate(windowStartMs + 60 * 60 * 1000) };
    const second = { ...params("02"), deadline, now: new NativeDate(windowStartMs + 2 * 60 * 60 * 1000) };

    const results = await Promise.allSettled([
      prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, first)),
      prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, second)),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(String(rejected?.reason?.message)).toMatch(/unique constraint|write conflict|deadlock|serialize|P2034/i);
    await expect(prisma.$transaction(
      (tx) => stageTransferProofDeliveryIntent(tx, second),
    )).resolves.toBeUndefined();
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId } }))
      .resolves.toBe(2);
    await expect(prisma.notification.count({ where: { userId: buyerUserId } }))
      .resolves.toBe(1);
    const rows = await prisma.transferProofDeliveryIntent.findMany({
      where: { orderId },
      orderBy: { kind: "asc" },
      select: { kind: true, payloadJson: true },
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.kind === "BUYER_CONFIRMATION_EMAIL")?.payloadJson)
      .toMatchObject({ windowStart: authoritativeWindowStart(deadline).toISOString() });
    expect(rows.find((row) => row.kind === "ADMIN_TRANSFER_ACTIVITY_EMAIL")?.payloadJson)
      .toMatchObject({ completedAt: authoritativeCompletedAt(deadline).toISOString() });
  });

  it("creates distinct buyer notifications for two orders in the same authoritative window", async () => {
    const secondOrderId = `${orderId}-same-window-notification`;
    await ensureSyntheticOrder(secondOrderId);
    try {
      await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("02")));
      await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, {
        ...params("03"), orderId: secondOrderId,
      }));

      const notifications = await prisma.notification.findMany({
        where: { userId: buyerUserId, type: "TRANSFER_CONFIRMATION_REQUIRED" },
        select: { idempotencyKey: true },
      });
      expect(notifications).toHaveLength(2);
      expect(new Set(notifications.map((row) => row.idempotencyKey)).size).toBe(2);
    } finally {
      await forceDeleteDeliveryIntents({ orderId: secondOrderId });
      await prisma.orderItem.deleteMany({ where: { orderId: secondOrderId } });
      await prisma.order.delete({ where: { id: secondOrderId } });
      await prisma.ticket.deleteMany({ where: { id: `${secondOrderId}-ticket` } });
    }
  });

  it("fails atomically when a canonical notification key owns different content", async () => {
    const input = params("02");
    const idempotencyKey = buyerNotificationKey(
      input.orderId,
      buyerUserId,
      authoritativeWindowStart(input.deadline),
    );
    await prisma.notification.create({ data: {
      userId: buyerUserId,
      type: "TRANSFER_CONFIRMATION_REQUIRED",
      message: "poisoned legacy content",
      link: "/account/tickets/holding",
      idempotencyKey,
    } });

    await expect(prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, input)))
      .rejects.toThrow(
        "Transfer-proof notification idempotency collision does not match the canonical content",
      );
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId } }))
      .resolves.toBe(0);
    await expect(prisma.notification.findUnique({ where: { idempotencyKey } }))
      .resolves.toMatchObject({ message: "poisoned legacy content" });
  });

  it("matches the database digest for canonical JSON escaping and Unicode", async () => {
    const unusualName = "Quoted \\\"buyer\\\" \\\\ line\nemoji 😀";
    try {
      await prisma.user.update({
        where: { id: buyerUserId },
        data: { firstName: unusualName },
      });
      await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, {
        ...params("02"),
        buyerFirstName: unusualName,
      }));
      const buyerIntent = await prisma.transferProofDeliveryIntent.findFirstOrThrow({
        where: { orderId, kind: "BUYER_CONFIRMATION_EMAIL" },
      });
      const envelope = {
        orderId,
        kind: buyerIntent.kind,
        recipient: buyerIntent.recipient,
        payloadJson: buyerIntent.payloadJson,
      };
      expect(buyerIntent.envelopeDigest).toBe(envelopeDigest(envelope));
    } finally {
      await forceUpdateUser({ id: buyerUserId }, { firstName: "Buyer" });
    }
  });

  it("serializes buyer-recipient authorization with participant changes", async () => {
    const client = await pool.connect();
    const changedEmail = `changed-${buyerEmail}`;
    try {
      await client.query("BEGIN");
      await client.query('UPDATE "User" SET email = $1 WHERE id = $2', [changedEmail, buyerUserId]);
      let insertSettled = false;
      const insert = prisma.$executeRaw`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "idempotencyKey",
          "identityVersion", "envelopeDigest"
        ) VALUES (
          ${`${orderId}-concurrent-subject`}, ${orderId}, 'BUYER_CONFIRMATION_EMAIL',
          ${buyerEmail}, ${JSON.stringify({
            buyerFirstName: "Buyer",
            ticketCount: 1,
            deadline: params("02").deadline.toISOString(),
            windowStart: authoritativeWindowStart(params("02").deadline).toISOString(),
          })}::jsonb, ${`${orderId}-concurrent-subject-key`},
          2, ${"0".repeat(64)}
        )
      `.finally(() => { insertSettled = true; });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(insertSettled).toBe(false);
      await client.query("COMMIT");
      await expect(insert).rejects.toThrow(
        "Transfer-proof buyer delivery recipient must match the order buyer",
      );
      await expect(prisma.transferProofDeliveryIntent.count({
        where: { id: `${orderId}-concurrent-subject` },
      })).resolves.toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      await prisma.user.update({ where: { id: buyerUserId }, data: { email: buyerEmail } });
    }
  });

  it("makes a concurrent parent drift wait for and lose to version-2 staging", async () => {
    const client = await pool.connect();
    const input = params("02");
    const windowStart = authoritativeWindowStart(input.deadline).toISOString();
    const payloadJson = {
      buyerFirstName: "Buyer",
      ticketCount: 1,
      deadline: input.deadline.toISOString(),
      windowStart,
    };
    const envelope = {
      orderId,
      kind: "BUYER_CONFIRMATION_EMAIL",
      recipient: buyerEmail,
      payloadJson,
    };
    try {
      await client.query("BEGIN");
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "idempotencyKey",
          "identityVersion", "envelopeDigest"
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 2, $7)
      `, [
        `${orderId}-concurrent-parent-snapshot`,
        orderId,
        envelope.kind,
        buyerEmail,
        JSON.stringify(payloadJson),
        `${orderId}:${windowStart}:BUYER_CONFIRMATION_EMAIL:${buyerEmail}`,
        envelopeDigest(envelope),
      ]);

      let updateSettled = false;
      const update = prisma.order.update({
        where: { id: orderId },
        data: { disputeWindowEndsAt: new Date("2026-12-03T01:00:00.000Z") },
      }).finally(() => { updateSettled = true; });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(updateSettled).toBe(false);
      await client.query("COMMIT");
      await expect(update).rejects.toThrow("Transfer-proof delivery order snapshot is immutable");
      await expect(prisma.order.findUniqueOrThrow({ where: { id: orderId } }))
        .resolves.toMatchObject({ disputeWindowEndsAt: input.deadline });
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("makes a concurrent participant drift wait for and lose to version-2 staging", async () => {
    const client = await pool.connect();
    const input = params("02");
    const windowStart = authoritativeWindowStart(input.deadline).toISOString();
    const payloadJson = {
      buyerFirstName: "Buyer",
      ticketCount: 1,
      deadline: input.deadline.toISOString(),
      windowStart,
    };
    const envelope = {
      orderId,
      kind: "BUYER_CONFIRMATION_EMAIL",
      recipient: buyerEmail,
      payloadJson,
    };
    try {
      await client.query("BEGIN");
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "idempotencyKey",
          "identityVersion", "envelopeDigest"
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 2, $7)
      `, [
        `${orderId}-concurrent-participant-snapshot`,
        orderId,
        envelope.kind,
        buyerEmail,
        JSON.stringify(payloadJson),
        `${orderId}:${windowStart}:BUYER_CONFIRMATION_EMAIL:${buyerEmail}`,
        envelopeDigest(envelope),
      ]);

      let updateSettled = false;
      const update = prisma.user.update({
        where: { id: buyerUserId },
        data: { email: `concurrent-${buyerEmail}` },
      }).finally(() => { updateSettled = true; });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(updateSettled).toBe(false);
      await client.query("COMMIT");
      await expect(update).rejects.toThrow(
        "Active transfer-proof delivery participant email is immutable",
      );
      await expect(prisma.user.findUniqueOrThrow({ where: { id: buyerUserId } }))
        .resolves.toMatchObject({ email: buyerEmail });
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("serializes ticket-count authorization with concurrent item inserts and deletes", async () => {
    const client = await pool.connect();
    const secondTicketId = `${orderId}-concurrent-second-ticket`;
    const secondItemId = `${orderId}-concurrent-second-item`;
    const payloadJson = JSON.stringify({
      buyerFirstName: "Buyer",
      ticketCount: 1,
      deadline: params("03").deadline.toISOString(),
      windowStart: authoritativeWindowStart(params("03").deadline).toISOString(),
    });
    let transactionOpen = false;
    try {
      await prisma.ticket.create({ data: {
        id: secondTicketId,
        title: "Concurrent Transfer Ticket",
        priceCents: 100,
        image: "/default.jpg",
        venue: "Synthetic Venue",
        date: "2026-12-10T00:00:00.000Z",
        sellerId,
      } });
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(`
        INSERT INTO "OrderItem" (id, "orderId", "ticketId", "priceCents")
        VALUES ($1, $2, $3, 100)
      `, [secondItemId, orderId, secondTicketId]);
      let insertCheckSettled = false;
      const insertCheck = prisma.$executeRaw`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "idempotencyKey",
          "identityVersion", "envelopeDigest"
        ) VALUES (
          ${`${orderId}-item-insert-race`}, ${orderId}, 'BUYER_CONFIRMATION_EMAIL',
          ${buyerEmail}, ${payloadJson}::jsonb, ${`${orderId}-item-insert-race-key`},
          2, ${"0".repeat(64)}
        )
      `.finally(() => { insertCheckSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(insertCheckSettled).toBe(false);
      await client.query("COMMIT");
      transactionOpen = false;
      await expect(insertCheck).rejects.toThrow(
        "Transfer-proof delivery payload must match the order ticket count and deadline",
      );
      await prisma.orderItem.delete({ where: { id: secondItemId } });
      await prisma.ticket.delete({ where: { id: secondTicketId } });

      const existingItem = await prisma.orderItem.findFirstOrThrow({
        where: { orderId },
        select: { id: true },
      });
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query('DELETE FROM "OrderItem" WHERE id = $1', [existingItem.id]);
      let deleteCheckSettled = false;
      const deleteCheck = prisma.$executeRaw`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "idempotencyKey",
          "identityVersion", "envelopeDigest"
        ) VALUES (
          ${`${orderId}-item-delete-race`}, ${orderId}, 'BUYER_CONFIRMATION_EMAIL',
          ${buyerEmail}, ${payloadJson}::jsonb, ${`${orderId}-item-delete-race-key`},
          2, ${"0".repeat(64)}
        )
      `.finally(() => { deleteCheckSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(deleteCheckSettled).toBe(false);
      await client.query("COMMIT");
      transactionOpen = false;
      await expect(deleteCheck).rejects.toThrow(
        "Transfer-proof delivery requires at least one order ticket",
      );
      await expect(prisma.transferProofDeliveryIntent.count({
        where: { id: { in: [
          `${orderId}-item-insert-race`,
          `${orderId}-item-delete-race`,
        ] } },
      })).resolves.toBe(0);
    } finally {
      if (transactionOpen) await client.query("ROLLBACK");
      client.release();
      await prisma.orderItem.deleteMany({ where: { id: secondItemId } });
      await prisma.ticket.deleteMany({ where: { id: secondTicketId } });
      await ensureSyntheticOrder(orderId);
    }
  });

  it("rejects canonical delivery history for a nonexistent order", async () => {
    const nonexistentOrderId = `${orderId}-missing-parent`;
    await expect(prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, {
      ...params("01"),
      orderId: nonexistentOrderId,
      buyerUserId: null,
    }))).rejects.toThrow("Transfer-proof delivery requires an eligible paid transfer-proof order");

    await expect(prisma.transferProofDeliveryIntent.count({
      where: { orderId: nonexistentOrderId },
    })).resolves.toBe(0);
  });

  it("owns transfer-proof delivery history timestamps at the database clock", async () => {
    await useDatabaseOriginClock();
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("01")));
    const source = await prisma.transferProofDeliveryIntent.findFirstOrThrow({
      where: { orderId, kind: "BUYER_CONFIRMATION_EMAIL" },
    });
    const forgedId = `${source.id}-forged-clock`;
    const forgedTimestamp = new Date("2001-01-01T00:00:00.000Z");
    const payloadJson = source.payloadJson as Prisma.InputJsonObject;
    const envelope = {
      orderId,
      kind: source.kind,
      recipient: source.recipient,
      payloadJson,
    };
    await forceDeleteDeliveryIntents({ orderId });
    const beforeInsert = await databaseUtcNow();
    const inserted = await prisma.transferProofDeliveryIntent.create({
      data: {
        id: forgedId,
        ...envelope,
        idempotencyKey: source.idempotencyKey,
        identityVersion: 2,
        envelopeDigest: envelopeDigest(envelope),
        availableAt: forgedTimestamp,
        createdAt: forgedTimestamp,
        updatedAt: forgedTimestamp,
      },
      select: { createdAt: true, updatedAt: true },
    });
    const afterInsert = await databaseUtcNow();

    expect(inserted.createdAt.getTime()).toBeGreaterThanOrEqual(beforeInsert.getTime());
    expect(inserted.createdAt.getTime()).toBeLessThanOrEqual(afterInsert.getTime());
    expect(inserted.updatedAt).toEqual(inserted.createdAt);

    const beforeUpdate = await databaseUtcNow();
    const [updated] = await prisma.$queryRaw<Array<{ createdAt: Date; updatedAt: Date }>>`
      UPDATE "TransferProofDeliveryIntent"
      SET "updatedAt" = ${forgedTimestamp}
      WHERE id = ${forgedId}
      RETURNING "createdAt", "updatedAt"
    `;
    const afterUpdate = await databaseUtcNow();

    expect(updated.createdAt).toEqual(inserted.createdAt);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(inserted.updatedAt.getTime());
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
    expect(updated.updatedAt.getTime()).toBeLessThanOrEqual(afterUpdate.getTime() + 1);
  });

  it("requires every new delivery history row to originate pending", async () => {
    const terminalClock = await databaseUtcNow();
    const originId = `fabricated-origin-${runId}`;
    const origin = {
      orderId,
      kind: "BUYER_CONFIRMATION_EMAIL",
      recipient: buyerEmail,
      payloadJson: {},
      availableAt: terminalClock,
      identityVersion: 2,
      envelopeDigest: "0".repeat(64),
    };
    const forgedOrigins: Prisma.TransferProofDeliveryIntentUncheckedCreateInput[] = [
      {
        ...origin,
        id: `${originId}-pending-evidence`,
        idempotencyKey: `${originId}-pending-evidence`,
        status: "PENDING",
        lastError: "fabricated pending evidence",
      },
      {
        ...origin,
        id: `${originId}-processing`,
        idempotencyKey: `${originId}-processing`,
        provider: "RESEND",
        status: "PROCESSING",
        processingAt: terminalClock,
        leaseExpiresAt: new Date(terminalClock.getTime() + 15 * 60 * 1000),
        claimToken: "fabricated-claim",
      },
      {
        ...origin,
        id: `${originId}-failed`,
        idempotencyKey: `${originId}-failed`,
        provider: "RESEND",
        status: "FAILED",
        attemptCount: 1,
        firstAttemptAt: terminalClock,
        lastError: "fabricated failure",
      },
      {
        ...origin,
        id: `${originId}-delivered`,
        idempotencyKey: `${originId}-delivered`,
        provider: "RESEND",
        status: "DELIVERED",
        attemptCount: 1,
        firstAttemptAt: terminalClock,
        deliveredAt: terminalClock,
      },
      {
        ...origin,
        id: `${originId}-reconciliation`,
        idempotencyKey: `${originId}-reconciliation`,
        status: "RECONCILIATION_REQUIRED",
        lastError: "fabricated reconciliation",
      },
    ];

    for (const data of forgedOrigins) {
      await expect(prisma.transferProofDeliveryIntent.create({ data }))
        .rejects.toThrow("New transfer-proof delivery intents must originate pending");
    }

    await expect(prisma.transferProofDeliveryIntent.count({
      where: { id: { startsWith: originId } },
    })).resolves.toBe(0);
  });

  it("owns the initial pending schedule at the database clock", async () => {
    await useDatabaseOriginClock();
    await useDatabaseClaimClock();
    const futureOrderId = `${orderId}-future-origin`;
    const pastOrderId = `${orderId}-past-origin`;
    try {
      const source = params("01");
      const forgedFuture = new NativeDate("2099-01-01T00:00:00.000Z");
      const forgedPast = new NativeDate("2001-01-01T00:00:00.000Z");
      await ensureSyntheticOrder(futureOrderId);
      await ensureSyntheticOrder(pastOrderId);
      const beforeInsert = await databaseUtcNow();
      await prisma.$transaction(async (tx) => {
        await stageTransferProofDeliveryIntent(tx, {
          ...source,
          orderId: futureOrderId,
          now: forgedFuture,
        });
        await stageTransferProofDeliveryIntent(tx, {
          ...source,
          orderId: pastOrderId,
          now: forgedPast,
        });
      });
      const afterInsert = await databaseUtcNow();
      const rows = await prisma.transferProofDeliveryIntent.findMany({
        where: { orderId: { in: [futureOrderId, pastOrderId] } },
        select: { id: true, availableAt: true, createdAt: true, updatedAt: true },
      });

      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(row.availableAt.getTime()).toBeGreaterThanOrEqual(beforeInsert.getTime());
        expect(row.availableAt.getTime()).toBeLessThanOrEqual(afterInsert.getTime());
        expect(row.availableAt).toEqual(row.createdAt);
        expect(row.availableAt).toEqual(row.updatedAt);
      }

      const claimed = rows[0];
      await expect(prisma.transferProofDeliveryIntent.update({
        where: { id: claimed.id },
        data: {
          status: "PROCESSING",
          provider: "RESEND",
          processingAt: claimed.availableAt,
          leaseExpiresAt: new NativeDate(claimed.availableAt.getTime() + 15 * 60 * 1000),
          claimToken: "database-origin-clock-claim",
        },
      })).resolves.toMatchObject({
        status: "PROCESSING",
        availableAt: claimed.availableAt,
        processingAt: claimed.availableAt,
      });
    } finally {
      await forceDeleteDeliveryIntents({ orderId: { in: [futureOrderId, pastOrderId] } });
      await prisma.order.deleteMany({ where: { id: { in: [futureOrderId, pastOrderId] } } });
      await useHistoricalClaimClock();
      await useHistoricalOriginClock();
    }
  });

  it("advances history time after a concurrent row-lock wait", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("01")));
    const intent = await prisma.transferProofDeliveryIntent.findFirstOrThrow({
      where: { orderId },
      select: { id: true },
    });
    const first = await pool.connect();
    const second = await pool.connect();
    let firstCommitted = false;
    try {
      await first.query("BEGIN");
      await first.query(`
        SELECT id FROM "TransferProofDeliveryIntent" WHERE id = $1 FOR UPDATE
      `, [intent.id]);
      const secondPid = await second.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const waitingUpdate = second.query<{ updatedAt: Date }>(`
        UPDATE "TransferProofDeliveryIntent"
        SET "updatedAt" = TIMESTAMP '2001-01-01 00:00:00'
        WHERE id = $1
        RETURNING "updatedAt"
      `, [intent.id]);

      let waitingOnLock = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await pool.query<{ wait_event_type: string | null }>(`
          SELECT wait_event_type
          FROM pg_stat_activity
          WHERE pid = $1
        `, [secondPid.rows[0].pid]);
        if (activity.rows[0]?.wait_event_type === "Lock") {
          waitingOnLock = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waitingOnLock).toBe(true);

      const firstUpdate = await first.query<{ updatedAt: Date }>(`
        UPDATE "TransferProofDeliveryIntent"
        SET "updatedAt" = TIMESTAMP '2001-01-01 00:00:00'
        WHERE id = $1
        RETURNING "updatedAt"
      `, [intent.id]);
      await first.query("COMMIT");
      firstCommitted = true;
      const secondUpdate = await waitingUpdate;

      expect(secondUpdate.rows[0].updatedAt.getTime())
        .toBeGreaterThanOrEqual(firstUpdate.rows[0].updatedAt.getTime());
    } finally {
      if (!firstCommitted) await first.query("ROLLBACK");
      first.release();
      second.release();
    }
  });

  it("loses a real Serializable race without intent residue or pre-commit sends", async () => {
    let staged!: () => void;
    const stagedPromise = new Promise<void>((resolve) => { staged = resolve; });
    let competingCommitted!: () => void;
    const competingPromise = new Promise<void>((resolve) => { competingCommitted = resolve; });

    const loser = prisma.$transaction(async (tx) => {
      await tx.seller.findUniqueOrThrow({ where: { id: sellerId } });
      await stageTransferProofDeliveryIntent(tx, params("07"));
      staged();
      await competingPromise;
      await tx.seller.update({ where: { id: sellerId }, data: { name: "Losing transaction" } });
    }, { isolationLevel: "Serializable" });

    await stagedPromise;
    await prisma.$transaction(async (tx) => {
      await tx.seller.findUniqueOrThrow({ where: { id: sellerId } });
      await tx.seller.update({ where: { id: sellerId }, data: { name: "Winning transaction" } });
    }, { isolationLevel: "Serializable" });
    competingCommitted();

    await expect(loser).rejects.toMatchObject({ code: "P2034" });
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId } })).resolves.toBe(0);
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
  });

  it("drains persisted intents once after the in-memory commit handoff is gone", async () => {
    await prisma.$transaction(async (tx) => {
      await stageTransferProofDeliveryIntent(tx, params("13"));
      expect(mockedSendEmail).not.toHaveBeenCalled();
      expect(mockedSendAdmin).not.toHaveBeenCalled();
    }, { isolationLevel: "Serializable" });

    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
    await drainTransferProofDeliveryIntents({ orderId }, prisma);
    await drainTransferProofDeliveryIntents({ orderId }, prisma);
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendAdmin).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail.mock.calls[0][0].idempotencyKey).toMatch(/^tft-transfer-proof-[a-f0-9]{64}$/);
    expect(mockedSendEmail.mock.calls[0][0].idempotencyKey!.length).toBeLessThanOrEqual(256);
    expect(mockedSendAdmin.mock.calls[0][0]).toMatchObject({
      idempotencyKey: expect.stringMatching(/^tft-transfer-proof-[a-f0-9]{64}$/),
      completedAt: new Date(params("13").deadline.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    });
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId, status: "DELIVERED" } })).resolves.toBe(2);
    await expect(prisma.reminderDelivery.count({ where: { orderId, status: "SENT" } })).resolves.toBe(1);
    await expect(prisma.emailDelivery.count({ where: { orderId, status: "SENT" } })).resolves.toBe(1);
  });

  it("partitions a bounded batch across overlapping PostgreSQL drainers", async () => {
    const ids = await seedAdminBatch("overlap");
    const seen: string[] = [];
    mockedSendAdmin.mockImplementation(async (input) => {
      seen.push(String(input.summary).split(" ").at(-1)!);
      await new Promise((resolve) => setImmediate(resolve));
      return { ok: true, provider: "RESEND", providerResult: "ACCEPTED" };
    });

    const [first, second] = await Promise.all([
      drainTransferProofDeliveryIntents({ now: new Date("2026-12-01T01:00:00.000Z"), limit: 2 }, prisma),
      drainTransferProofDeliveryIntents({ now: new Date("2026-12-01T01:00:00.000Z"), limit: 2 }, prisma),
    ]);

    expect(first.claimed).toBe(2);
    expect(second.claimed).toBe(2);
    expect(new Set(seen).size).toBe(4);
    await expect(prisma.transferProofDeliveryIntent.count({ where: { id: { in: ids }, status: "DELIVERED" } }))
      .resolves.toBe(4);
    await expect(prisma.transferProofDeliveryIntent.findMany({ where: { id: { in: ids } }, select: { attemptCount: true } }))
      .resolves.toEqual(expect.arrayContaining(Array.from({ length: 4 }, () => ({ attemptCount: 1 }))));
  });

  it("claims the oldest due rows when no earlier row is locked", async () => {
    const ids = await seedAdminBatch("oldest");

    await expect(drainTransferProofDeliveryIntents({
      now: new Date("2026-12-01T01:00:00.000Z"), limit: 2,
    }, prisma)).resolves.toMatchObject({ scanned: 2, claimed: 2, delivered: 2 });

    await expect(prisma.transferProofDeliveryIntent.findMany({
      where: { id: { in: ids } }, orderBy: { availableAt: "asc" }, select: { status: true },
    })).resolves.toEqual([
      { status: "DELIVERED" }, { status: "DELIVERED" }, { status: "PENDING" }, { status: "PENDING" },
    ]);
  });

  it("skips a locked oldest prefix and drains the next due rows", async () => {
    const ids = await seedAdminBatch("locked-prefix");
    const locker = await pool.connect();
    try {
      await locker.query("BEGIN");
      await locker.query(
        `SELECT "id" FROM "TransferProofDeliveryIntent" WHERE "id" = ANY($1::text[]) ORDER BY "availableAt" ASC LIMIT 2 FOR UPDATE`,
        [ids.slice(0, 2)],
      );

      await expect(drainTransferProofDeliveryIntents({
        now: new Date("2026-12-01T01:00:00.000Z"), limit: 2,
      }, prisma)).resolves.toMatchObject({ scanned: 2, claimed: 2, delivered: 2 });
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
    }

    await expect(prisma.transferProofDeliveryIntent.findMany({
      where: { id: { in: ids } }, orderBy: { availableAt: "asc" }, select: { status: true, attemptCount: true },
    })).resolves.toEqual([
      { status: "PENDING", attemptCount: 0 },
      { status: "PENDING", attemptCount: 0 },
      { status: "DELIVERED", attemptCount: 1 },
      { status: "DELIVERED", attemptCount: 1 },
    ]);
  });

  it("skips an unavailable pinned-provider prefix and claims later actionable rows", async () => {
    const ids = await seedAdminBatch("unavailable-prefix");
    await forceLegacyIntentState(
      { id: { in: ids.slice(0, 2) } },
      {
        status: "FAILED", provider: "RESEND", attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T00:00:00.000Z"),
        lastError: "synthetic rejection",
      },
    );
    const savedResendKey = process.env.RESEND_API_KEY;
    const savedSendGridKey = process.env.SENDGRID_API_KEY;
    delete process.env.RESEND_API_KEY;
    process.env.SENDGRID_API_KEY = "synthetic-sendgrid-key";
    mockedSendAdmin.mockResolvedValue({ ok: true, provider: "SENDGRID", providerResult: "ACCEPTED" });
    try {
      await expect(drainTransferProofDeliveryIntents({
        now: new Date("2026-12-01T01:00:00.000Z"), limit: 2,
      }, prisma)).resolves.toMatchObject({ scanned: 2, claimed: 2, delivered: 2 });
    } finally {
      if (savedResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = savedResendKey;
      if (savedSendGridKey === undefined) delete process.env.SENDGRID_API_KEY;
      else process.env.SENDGRID_API_KEY = savedSendGridKey;
    }

    await expect(prisma.transferProofDeliveryIntent.findMany({
      where: { id: { in: ids } }, orderBy: { availableAt: "asc" },
      select: { status: true, provider: true, attemptCount: true },
    })).resolves.toEqual([
      { status: "FAILED", provider: "RESEND", attemptCount: 1 },
      { status: "FAILED", provider: "RESEND", attemptCount: 1 },
      { status: "DELIVERED", provider: "SENDGRID", attemptCount: 1 },
      { status: "DELIVERED", provider: "SENDGRID", attemptCount: 1 },
    ]);
  });

  it("fences a late worker and reclaims a pre-dispatch lease without spending an attempt", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("02")));
    await forceDeleteDeliveryIntents({ orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" });
    let paused!: () => void;
    const pausedPromise = new Promise<void>((resolve) => { paused = resolve; });
    let release!: () => void;
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    let transactionCalls = 0;
    const stalledDb = {
      $transaction: async <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => {
        transactionCalls += 1;
        if (transactionCalls === 2) {
          paused();
          await releasePromise;
        }
        return prisma.$transaction(fn);
      },
      transferProofDeliveryIntent: prisma.transferProofDeliveryIntent,
      reminderDelivery: prisma.reminderDelivery,
      emailDelivery: prisma.emailDelivery,
    } as unknown as NonNullable<Parameters<typeof drainTransferProofDeliveryIntents>[1]>;

    const lateWorker = drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T02:00:00.000Z") },
      stalledDb,
    );
    await pausedPromise;
    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({
        status: "PROCESSING", provider: "RESEND", attemptCount: 0,
        dispatchStartedAt: null, claimToken: expect.any(String),
      });

    await expect(drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T02:16:00.000Z") }, prisma,
    )).resolves.toMatchObject({ claimed: 1, delivered: 1, failed: 0 });
    release();
    await expect(lateWorker).resolves.toMatchObject({ claimed: 1, delivered: 0, failed: 0 });

    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({
        status: "DELIVERED", provider: "RESEND", attemptCount: 1,
        claimToken: null, dispatchStartedAt: null,
      });
    await expect(prisma.reminderDelivery.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({ status: "SENT", providerResult: "ACCEPTED" });
  });

  it("fences a late post-dispatch result from overwriting replacement delivery evidence", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("03")));
    await forceDeleteDeliveryIntents({ orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" });
    let firstCallStarted!: () => void;
    const firstCallStartedPromise = new Promise<void>((resolve) => { firstCallStarted = resolve; });
    let releaseFirstCall!: () => void;
    const releaseFirstCallPromise = new Promise<void>((resolve) => { releaseFirstCall = resolve; });
    mockedSendEmail
      .mockImplementationOnce(async () => {
        firstCallStarted();
        await releaseFirstCallPromise;
        return { ok: false, provider: "RESEND", providerResult: "REJECTED", error: "late rejection" };
      })
      .mockResolvedValueOnce({ ok: true, provider: "RESEND", providerResult: "ACCEPTED" });

    const lateWorker = drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T03:00:00.000Z") }, prisma,
    );
    await firstCallStartedPromise;
    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({
        status: "PROCESSING", provider: "RESEND", attemptCount: 1,
        dispatchStartedAt: new Date("2026-12-01T03:00:00.000Z"), claimToken: expect.any(String),
      });

    await expect(drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T03:16:00.000Z") }, prisma,
    )).resolves.toMatchObject({ claimed: 1, delivered: 1, failed: 0 });
    releaseFirstCall();
    await expect(lateWorker).resolves.toMatchObject({ claimed: 1, delivered: 0, failed: 0 });

    expect(mockedSendEmail).toHaveBeenCalledTimes(2);
    expect(mockedSendEmail.mock.calls[1][0].idempotencyKey)
      .toBe(mockedSendEmail.mock.calls[0][0].idempotencyKey);
    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({ status: "DELIVERED", provider: "RESEND", attemptCount: 2 });
    await expect(prisma.reminderDelivery.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({
        status: "SENT", providerResult: "ACCEPTED", failureReason: null,
        completedAt: new Date("2026-12-01T03:16:00.000Z"),
      });
  });

  it("fences a late administrator result from overwriting replacement delivery evidence", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("04")));
    await forceDeleteDeliveryIntents({ orderId, kind: "BUYER_CONFIRMATION_EMAIL" });
    let firstCallStarted!: () => void;
    const firstCallStartedPromise = new Promise<void>((resolve) => { firstCallStarted = resolve; });
    let releaseFirstCall!: () => void;
    const releaseFirstCallPromise = new Promise<void>((resolve) => { releaseFirstCall = resolve; });
    mockedSendAdmin
      .mockImplementationOnce(async () => {
        firstCallStarted();
        await releaseFirstCallPromise;
        return { ok: false, provider: "RESEND", error: "late administrator rejection" };
      })
      .mockResolvedValueOnce({ ok: true, provider: "RESEND", providerResult: "ACCEPTED" });

    const lateWorker = drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T04:00:00.000Z") }, prisma,
    );
    await firstCallStartedPromise;
    await expect(drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T04:16:00.000Z") }, prisma,
    )).resolves.toMatchObject({ claimed: 1, delivered: 1, failed: 0 });
    releaseFirstCall();
    await expect(lateWorker).resolves.toMatchObject({ claimed: 1, delivered: 0, failed: 0 });

    expect(mockedSendAdmin).toHaveBeenCalledTimes(2);
    expect(mockedSendAdmin.mock.calls[1][0].idempotencyKey)
      .toBe(mockedSendAdmin.mock.calls[0][0].idempotencyKey);
    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({ status: "DELIVERED", provider: "RESEND", attemptCount: 2 });
    await expect(prisma.emailDelivery.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({
        status: "SENT", provider: "RESEND", error: null,
        sentAt: new Date("2026-12-01T04:16:00.000Z"),
      });
  });

  it("stages the buyer notification and Admin intent when buyer email is absent", async () => {
    await prisma.user.update({ where: { id: buyerUserId }, data: { sellerId: null } });
    try {
      await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, {
        ...params("19"), buyerEmail: null,
      }));
    } finally {
      await forceUpdateUser({ id: buyerUserId }, { seller: { connect: { id: buyerSellerId } } });
    }

    await expect(prisma.notification.count({ where: { userId: buyerUserId } })).resolves.toBe(1);
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId, kind: "BUYER_CONFIRMATION_EMAIL" } })).resolves.toBe(0);
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId, recipient: "admin@truefantix.com" } })).resolves.toBe(1);
  });

  it("recovers failed and stale claims through the persisted drainer", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("23")));
    await forceLegacyIntentState(
      { orderId, kind: "BUYER_CONFIRMATION_EMAIL" },
      {
        status: "FAILED", provider: "RESEND", attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T18:00:00.000Z"),
        availableAt: new Date("2026-12-01T18:00:00.000Z"), lastError: "synthetic rejection",
      },
    );
    await forceLegacyIntentState(
      { orderId, recipient: "admin@truefantix.com" },
      {
        status: "PROCESSING", provider: "RESEND", attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T18:00:00.000Z"),
        processingAt: new Date("2026-12-01T18:00:00.000Z"),
        leaseExpiresAt: new Date("2026-12-01T18:00:00.000Z"), claimToken: "synthetic-stale-claim",
      },
    );

    const previousResendKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    try {
      await drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-02T00:00:00.000Z") }, prisma);
    } finally {
      if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResendKey;
    }
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendAdmin).toHaveBeenCalledTimes(1);
    await expect(prisma.transferProofDeliveryIntent.findMany({ where: { orderId }, select: { status: true, attemptCount: true } }))
      .resolves.toEqual(expect.arrayContaining([
        { status: "DELIVERED", attemptCount: 2 },
        { status: "DELIVERED", attemptCount: 2 },
      ]));
  });

  it("records exceptions and retries only after the bounded backoff", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("03")));
    mockedSendEmail.mockResolvedValueOnce({ ok: false, provider: "CONSOLE", error: "buyer rejected" });
    mockedSendAdmin.mockRejectedValueOnce(new Error("admin exception"));
    const firstAttempt = new Date("2026-12-01T03:00:00.000Z");

    await expect(drainTransferProofDeliveryIntents({ orderId, now: firstAttempt }, prisma))
      .resolves.toMatchObject({ claimed: 2, delivered: 0, failed: 2 });
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId, status: "FAILED", attemptCount: 1 } })).resolves.toBe(2);
    await expect(prisma.reminderDelivery.count({ where: { orderId, status: "FAILED" } })).resolves.toBe(1);
    await expect(prisma.emailDelivery.count({ where: { orderId, status: "FAILED", error: "admin exception" } })).resolves.toBe(1);

    jest.clearAllMocks();
    mockedSendEmail.mockResolvedValue({ ok: true, provider: "RESEND", providerResult: "ACCEPTED" });
    mockedSendAdmin.mockResolvedValue({ ok: true, provider: "RESEND" });
    await expect(drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-01T03:04:59.999Z") }, prisma))
      .resolves.toMatchObject({ claimed: 0 });
    await expect(drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-01T03:05:00.000Z") }, prisma))
      .resolves.toMatchObject({ claimed: 2, delivered: 2, failed: 0 });
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendAdmin).toHaveBeenCalledTimes(1);
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId, status: "DELIVERED", attemptCount: 2 } })).resolves.toBe(2);
  });

  it("escalates a failed delivery after its bounded attempt budget is exhausted", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("05")));
    await forceLegacyIntentState(
      { orderId },
      {
        status: "FAILED", attemptCount: 3, availableAt: new Date("2026-12-01T00:00:00.000Z"),
        lastError: "synthetic third rejection",
      },
    );

    await expect(drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-02T00:00:00.000Z") }, prisma))
      .resolves.toMatchObject({ claimed: 0, reconciliationRequired: 2 });
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId, status: "RECONCILIATION_REQUIRED" } }))
      .resolves.toBe(2);
    await expect(drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-02T00:01:00.000Z") }, prisma))
      .resolves.toMatchObject({ claimed: 0, reconciliationRequired: 0 });
  });

  it("escalates the final rejected Resend attempt instead of stranding it as failed", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("06")));
    await forceDeleteDeliveryIntents({ orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" });
    await forceLegacyIntentState(
      { orderId },
      {
        status: "FAILED", provider: "RESEND", attemptCount: 2,
        firstAttemptAt: new Date("2026-12-01T05:00:00.000Z"),
        availableAt: new Date("2026-12-01T06:00:00.000Z"),
        lastError: "synthetic earlier rejection",
      },
    );
    mockedSendEmail.mockResolvedValue({ ok: false, provider: "RESEND", providerResult: "HTTP 429", error: "rate limited" });

    await expect(drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-01T06:10:00.000Z") }, prisma))
      .resolves.toMatchObject({ claimed: 1, delivered: 0, failed: 1, reconciliationRequired: 1 });
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({
        status: "RECONCILIATION_REQUIRED", provider: "RESEND", attemptCount: 3, lastError: "rate limited",
      });
  });

  it("quarantines an ambiguous stale SendGrid acceptance instead of resending", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("09")));
    await forceLegacyIntentState(
      { orderId },
      {
        status: "PROCESSING", provider: "SENDGRID", attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T09:00:00.000Z"),
        processingAt: new Date("2026-12-01T09:00:00.000Z"),
        dispatchStartedAt: new Date("2026-12-01T09:00:00.000Z"),
        claimToken: "synthetic-expired-sendgrid-claim",
        leaseExpiresAt: new Date("2026-12-01T09:00:00.000Z"),
      },
    );
    const previousSendGridKey = process.env.SENDGRID_API_KEY;
    process.env.SENDGRID_API_KEY = "synthetic-sendgrid-key";
    try {
      await expect(drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-02T00:00:00.000Z") }, prisma))
        .resolves.toMatchObject({ claimed: 0, delivered: 0, failed: 0 });
    } finally {
      if (previousSendGridKey === undefined) delete process.env.SENDGRID_API_KEY;
      else process.env.SENDGRID_API_KEY = previousSendGridKey;
    }
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId, status: "RECONCILIATION_REQUIRED" } })).resolves.toBe(2);
  });

  it("quarantines ambiguous Resend recovery after its 24-hour idempotency window", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("11")));
    await forceLegacyIntentState(
      { orderId },
      {
        status: "PROCESSING",
        provider: "RESEND",
        attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T11:00:00.000Z"),
        processingAt: new Date("2026-12-01T11:00:00.000Z"),
        leaseExpiresAt: new Date("2026-12-01T11:15:00.000Z"),
        claimToken: "synthetic-expired-resend-claim",
      },
    );
    const previousResendKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    try {
      await expect(drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-02T11:00:00.000Z") }, prisma))
        .resolves.toMatchObject({ claimed: 0, delivered: 0, failed: 0 });
    } finally {
      if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResendKey;
    }
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId, status: "RECONCILIATION_REQUIRED" } })).resolves.toBe(2);
  });

  it("quarantines failed Resend retries after their idempotency window instead of stranding them", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("12")));
    await forceLegacyIntentState(
      { orderId },
      {
        status: "FAILED",
        provider: "RESEND",
        attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T12:00:00.000Z"),
        availableAt: new Date("2026-12-01T12:05:00.000Z"),
        lastError: "synthetic rejection",
      },
    );

    await expect(drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-02T12:00:00.000Z") }, prisma))
      .resolves.toMatchObject({ claimed: 0, delivered: 0, failed: 0, reconciliationRequired: 2 });
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
    await expect(prisma.transferProofDeliveryIntent.findMany({
      where: { orderId },
      select: { status: true, lastError: true },
    })).resolves.toEqual(expect.arrayContaining([
      {
        status: "RECONCILIATION_REQUIRED",
        lastError: "Resend idempotency window expired; delivery requires reconciliation",
      },
    ]));
  });

  it("quarantines attempted Resend rows whose first-attempt evidence is missing", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("14")));
    await forceLegacyIntentState(
      { orderId },
      {
        status: "FAILED",
        provider: "RESEND",
        attemptCount: 1,
        firstAttemptAt: null,
        availableAt: new Date("2026-12-01T14:05:00.000Z"),
        lastError: "synthetic rejection with missing first-attempt evidence",
      },
    );

    await expect(drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-01T14:10:00.000Z") }, prisma))
      .resolves.toMatchObject({ claimed: 0, delivered: 0, failed: 0, reconciliationRequired: 2 });
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
    await expect(prisma.transferProofDeliveryIntent.findMany({
      where: { orderId },
      select: { status: true, lastError: true },
    })).resolves.toEqual(expect.arrayContaining([
      {
        status: "RECONCILIATION_REQUIRED",
        lastError: "Resend first-attempt time is missing; delivery requires reconciliation",
      },
    ]));
  });

  it("quarantines attempted rows whose provider evidence is missing instead of crossing providers", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("18")));
    await forceLegacyIntentState(
      { orderId },
      {
        status: "FAILED",
        provider: null,
        attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T18:00:00.000Z"),
        availableAt: new Date("2026-12-01T18:05:00.000Z"),
        lastError: "synthetic rejection with missing provider evidence",
      },
    );
    const previousResendKey = process.env.RESEND_API_KEY;
    const previousSendGridKey = process.env.SENDGRID_API_KEY;
    delete process.env.RESEND_API_KEY;
    process.env.SENDGRID_API_KEY = "synthetic-sendgrid-key";
    try {
      await expect(drainTransferProofDeliveryIntents(
        { orderId, now: new Date("2026-12-01T18:10:00.000Z") }, prisma,
      )).resolves.toMatchObject({ claimed: 0, delivered: 0, failed: 0, reconciliationRequired: 2 });
    } finally {
      if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResendKey;
      if (previousSendGridKey === undefined) delete process.env.SENDGRID_API_KEY;
      else process.env.SENDGRID_API_KEY = previousSendGridKey;
    }
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
    await expect(prisma.transferProofDeliveryIntent.findMany({
      where: { orderId },
      select: { status: true, provider: true, attemptCount: true, lastError: true },
    })).resolves.toEqual(expect.arrayContaining([
      {
        status: "RECONCILIATION_REQUIRED",
        provider: null,
        attemptCount: 1,
        lastError: "Attempted delivery has no recorded provider; delivery requires reconciliation",
      },
    ]));
  });

  it("quarantines unsupported recorded providers instead of stranding failed rows", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("20")));
    await forceLegacyIntentState(
      { orderId },
      {
        status: "FAILED",
        provider: "CONSOLE",
        attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T20:00:00.000Z"),
        availableAt: new Date("2026-12-01T20:05:00.000Z"),
        lastError: "synthetic rejection with unsupported provider evidence",
      },
    );

    await expect(drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T20:10:00.000Z") }, prisma,
    )).resolves.toMatchObject({ claimed: 0, delivered: 0, failed: 0, reconciliationRequired: 2 });
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
    await expect(prisma.transferProofDeliveryIntent.findMany({
      where: { orderId },
      select: { status: true, provider: true, attemptCount: true, lastError: true },
    })).resolves.toEqual(expect.arrayContaining([
      {
        status: "RECONCILIATION_REQUIRED",
        provider: "CONSOLE",
        attemptCount: 1,
        lastError: "Unsupported recorded delivery provider CONSOLE; delivery requires reconciliation",
      },
    ]));
  });

  it("quarantines malformed delivery envelopes before any provider dispatch", async () => {
    // Simulate malformed legacy rows created before migration 89. Current
    // writers are rejected at insertion; the worker still fails closed if
    // historical or restored data contains an invalid envelope.
    await forceCreateDeliveryIntents([
      {
        orderId,
        kind: "BUYER_CONFIRMATION_EMAIL",
        recipient: buyerEmail,
        payloadJson: {
          buyerFirstName: "Buyer", ticketCount: 1,
          deadline: params("20").deadline.toISOString(), windowStart: "2026-12-01T18:30:00.000Z",
        },
        idempotencyKey: "synthetic-malformed-buyer-envelope",
        identityVersion: 2,
        envelopeDigest: "0".repeat(64),
        availableAt: new Date("2026-12-01T20:00:00.000Z"),
      },
      {
        orderId,
        kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL",
        recipient: "admin@truefantix.com",
        payloadJson: {
          sellerEmail: "seller@example.test", buyerEmail,
          ticketCount: 1, transferProofType: "EMAIL",
          deadline: params("20").deadline.toISOString(), completedAt: "not-a-date",
        },
        idempotencyKey: "synthetic-malformed-admin-envelope",
        identityVersion: 2,
        envelopeDigest: "0".repeat(64),
        availableAt: new Date("2026-12-01T20:00:00.000Z"),
      },
    ]);

    await expect(drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T20:00:00.000Z") }, prisma,
    )).resolves.toMatchObject({ claimed: 2, delivered: 0, failed: 2, reconciliationRequired: 2 });

    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
    await expect(prisma.transferProofDeliveryIntent.findMany({
      where: { orderId },
      select: { kind: true, status: true, attemptCount: true, lastError: true },
    })).resolves.toEqual(expect.arrayContaining([
      {
        kind: "BUYER_CONFIRMATION_EMAIL",
        status: "RECONCILIATION_REQUIRED",
        attemptCount: 0,
        lastError: "Pre-dispatch delivery failure: Transfer-proof buyer delivery window is not normalized",
      },
      {
        kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL",
        status: "RECONCILIATION_REQUIRED",
        attemptCount: 0,
        lastError: "Pre-dispatch delivery failure: Invalid transfer-proof delivery payload field: completedAt",
      },
    ]));
    await expect(prisma.reminderDelivery.count({ where: { orderId } })).resolves.toBe(0);
    await expect(prisma.emailDelivery.count({ where: { orderId } })).resolves.toBe(0);
  });

  it("rejects changes to a persisted delivery envelope", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("21")));
    const buyerIntent = await prisma.transferProofDeliveryIntent.findFirstOrThrow({
      where: { orderId, kind: "BUYER_CONFIRMATION_EMAIL" },
    });
    const adminIntent = await prisma.transferProofDeliveryIntent.findFirstOrThrow({
      where: { orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" },
    });

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: buyerIntent.id },
      data: {
        payloadJson: {
          ...(buyerIntent.payloadJson as Prisma.JsonObject),
          buyerFirstName: "Changed buyer",
        },
      },
    })).rejects.toThrow("Transfer-proof delivery envelope is immutable");
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: adminIntent.id },
      data: { recipient: "changed-admin@example.test" },
    })).rejects.toThrow("Transfer-proof delivery envelope is immutable");

    await expect(drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T21:00:00.000Z") }, prisma,
    )).resolves.toMatchObject({ claimed: 2, delivered: 2, failed: 0, reconciliationRequired: 0 });

    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendAdmin).toHaveBeenCalledTimes(1);
  });

  it("rejects impossible persisted lifecycle combinations", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("21")));
    const buyerIntent = await prisma.transferProofDeliveryIntent.findFirstOrThrow({
      where: { orderId, kind: "BUYER_CONFIRMATION_EMAIL" },
    });

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: buyerIntent.id },
      data: { status: "PROCESSING", provider: "RESEND" },
    })).rejects.toThrow("Invalid transfer-proof delivery lifecycle state");
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: buyerIntent.id },
      data: { deliveredAt: new Date("2026-12-01T21:00:00.000Z") },
    })).rejects.toThrow("Invalid transfer-proof delivery lifecycle state");

    await expect(prisma.transferProofDeliveryIntent.findUniqueOrThrow({ where: { id: buyerIntent.id } }))
      .resolves.toMatchObject({
        status: "PENDING", provider: null, attemptCount: 0, processingAt: null,
        leaseExpiresAt: null, claimToken: null, dispatchStartedAt: null, deliveredAt: null,
      });
  });

  it("keeps delivered and reconciliation outcomes terminal with immutable evidence", async () => {
    const ids = await seedAdminBatch("terminal-transitions", 2);
    await expect(drainTransferProofDeliveryIntents({
      now: new Date("2026-12-01T01:00:00.000Z"), limit: 1,
    }, prisma)).resolves.toMatchObject({ claimed: 1, delivered: 1 });

    const delivered = await prisma.transferProofDeliveryIntent.findUniqueOrThrow({
      where: { id: ids[0] },
    });
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: delivered.id },
      data: {
        status: "FAILED", deliveredAt: null, lastError: "synthetic resurrection",
      },
    })).rejects.toThrow("Invalid transfer-proof delivery lifecycle transition");
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: delivered.id },
      data: { attemptCount: delivered.attemptCount + 1 },
    })).rejects.toThrow("Terminal transfer-proof delivery evidence is immutable");

    const processingAt = new Date("2026-12-01T01:00:00.000Z");
    const leaseExpiresAt = new Date("2026-12-01T01:15:00.000Z");
    await prisma.transferProofDeliveryIntent.update({
      where: { id: ids[1] },
      data: {
        status: "PROCESSING", provider: "RESEND", processingAt, leaseExpiresAt,
        claimToken: "terminal-transition-claim",
      },
    });
    await prisma.transferProofDeliveryIntent.update({
      where: { id: ids[1] },
      data: {
        status: "RECONCILIATION_REQUIRED", processingAt: null, leaseExpiresAt: null,
        claimToken: null, lastError: "synthetic ambiguous outcome",
      },
    });
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: ids[1] },
      data: {
        status: "PROCESSING", processingAt, leaseExpiresAt,
        claimToken: "resurrected-reconciliation-claim", lastError: null,
      },
    })).rejects.toThrow("Invalid transfer-proof delivery lifecycle transition");
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: ids[1] },
      data: { lastError: "rewritten operator evidence" },
    })).rejects.toThrow("Terminal transfer-proof delivery evidence is immutable");

    await expect(prisma.transferProofDeliveryIntent.findMany({
      where: { id: { in: ids } }, orderBy: { availableAt: "asc" },
      select: { status: true, attemptCount: true, lastError: true },
    })).resolves.toEqual([
      { status: "DELIVERED", attemptCount: 1, lastError: null },
      {
        status: "RECONCILIATION_REQUIRED", attemptCount: 0,
        lastError: "synthetic ambiguous outcome",
      },
    ]);
  });

  it("rejects changing the pinned provider while incrementing an owned dispatch attempt", async () => {
    const [id] = await seedAdminBatch("provider-change-attempt", 1);
    const processingAt = new Date("2026-12-01T02:00:00.000Z");
    const leaseExpiresAt = new Date("2026-12-01T02:15:00.000Z");
    await prisma.transferProofDeliveryIntent.update({
      where: { id },
      data: {
        status: "PROCESSING", provider: "RESEND", processingAt, leaseExpiresAt,
        claimToken: "provider-change-claim",
      },
    });

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id },
      data: {
        provider: "SENDGRID", attemptCount: 1, firstAttemptAt: processingAt,
        dispatchStartedAt: processingAt,
      },
    })).rejects.toThrow("Transfer-proof delivery provider identity is immutable once pinned");

    await expect(prisma.transferProofDeliveryIntent.findUniqueOrThrow({
      where: { id },
      select: { provider: true, attemptCount: true, dispatchStartedAt: true },
    })).resolves.toEqual({ provider: "RESEND", attemptCount: 0, dispatchStartedAt: null });
  });

  it("binds first-attempt evidence to the exact owned dispatch boundary", async () => {
    const [id] = await seedAdminBatch("first-attempt-boundary", 1);
    const processingAt = new Date("2026-12-01T02:00:00.000Z");
    const divergentFirstAttemptAt = new Date("2026-12-01T01:59:59.000Z");
    const leaseExpiresAt = new Date("2026-12-01T02:15:00.000Z");
    await prisma.transferProofDeliveryIntent.update({
      where: { id },
      data: {
        status: "PROCESSING", provider: "RESEND", processingAt, leaseExpiresAt,
        claimToken: "first-attempt-boundary-claim",
      },
    });

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id },
      data: {
        attemptCount: 1, firstAttemptAt: divergentFirstAttemptAt,
        dispatchStartedAt: processingAt,
      },
    })).rejects.toThrow("Transfer-proof delivery attempt increment requires its owned dispatch boundary");

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id },
      data: {
        attemptCount: 1, firstAttemptAt: processingAt, dispatchStartedAt: processingAt,
      },
    })).resolves.toMatchObject({
      attemptCount: 1, firstAttemptAt: processingAt, dispatchStartedAt: processingAt,
    });
  });

  it("requires an expired-lease handoff before active dispatch evidence can be reset", async () => {
    const [id] = await seedAdminBatch("claim-handoff-boundary", 1);
    const processingAt = new Date("2026-12-01T02:00:00.000Z");
    const leaseExpiresAt = new Date("2026-12-01T02:15:00.000Z");
    await prisma.transferProofDeliveryIntent.update({
      where: { id },
      data: {
        status: "PROCESSING", provider: "RESEND", processingAt, leaseExpiresAt,
        claimToken: "claim-handoff-owner",
      },
    });
    await prisma.transferProofDeliveryIntent.update({
      where: { id },
      data: {
        attemptCount: 1, firstAttemptAt: processingAt, dispatchStartedAt: processingAt,
      },
    });

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id },
      data: { dispatchStartedAt: null },
    })).rejects.toThrow("Transfer-proof delivery expired claim is not replay-safe");
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id },
      data: {
        processingAt: new Date("2026-12-01T02:10:00.000Z"),
        leaseExpiresAt: new Date("2026-12-01T02:25:00.000Z"),
        claimToken: "premature-handoff", dispatchStartedAt: null,
      },
    })).rejects.toThrow("Transfer-proof delivery expired claim is not replay-safe");

    const successorProcessingAt = leaseExpiresAt;
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id },
      data: {
        processingAt: successorProcessingAt,
        leaseExpiresAt: new Date("2026-12-01T02:30:00.000Z"),
        claimToken: "expired-lease-successor", dispatchStartedAt: null,
      },
    })).resolves.toMatchObject({
      attemptCount: 1, processingAt: successorProcessingAt,
      claimToken: "expired-lease-successor", dispatchStartedAt: null,
    });
  });

  it("permits expired claim handoff only while the provider identity is replay-safe", async () => {
    const [sendGridId, expiredResendId, activeResendId] = await seedAdminBatch("replay-safe-handoff", 3);
    const processingAt = new Date("2026-12-01T02:00:00.000Z");
    const leaseExpiresAt = new Date("2026-12-01T02:15:00.000Z");

    for (const [id, provider] of [
      [sendGridId, "SENDGRID"], [expiredResendId, "RESEND"], [activeResendId, "RESEND"],
    ] as const) {
      await prisma.transferProofDeliveryIntent.update({
        where: { id },
        data: {
          status: "PROCESSING", provider, processingAt, leaseExpiresAt,
          claimToken: `${provider.toLowerCase()}-${id}`,
        },
      });
      await prisma.transferProofDeliveryIntent.update({
        where: { id },
        data: {
          attemptCount: 1, firstAttemptAt: processingAt, dispatchStartedAt: processingAt,
        },
      });
    }

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: sendGridId },
      data: {
        processingAt: leaseExpiresAt,
        leaseExpiresAt: new Date("2026-12-01T02:30:00.000Z"),
        claimToken: "sendgrid-successor", dispatchStartedAt: null,
      },
    })).rejects.toThrow("Transfer-proof delivery expired claim is not replay-safe");

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: expiredResendId },
      data: {
        processingAt: new Date("2026-12-02T02:00:00.000Z"),
        leaseExpiresAt: new Date("2026-12-02T02:15:00.000Z"),
        claimToken: "expired-resend-successor", dispatchStartedAt: null,
      },
    })).rejects.toThrow("Transfer-proof delivery expired claim is not replay-safe");

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: activeResendId },
      data: {
        processingAt: leaseExpiresAt,
        leaseExpiresAt: new Date("2026-12-01T02:30:00.000Z"),
        claimToken: "active-resend-successor", dispatchStartedAt: null,
      },
    })).resolves.toMatchObject({
      attemptCount: 1, processingAt: leaseExpiresAt,
      claimToken: "active-resend-successor", dispatchStartedAt: null,
    });
  });

  it("installs provider pinning as a forward-only upgrade after the transition migration", async () => {
    const transitionSchema = `transfer_proof_transition_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${transitionSchema}"`);
      await client.query(`SET search_path TO "${transitionSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3),
          "lastError" TEXT,
          "availableAt" TIMESTAMP(3) NOT NULL
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "processingAt", "leaseExpiresAt",
          "claimToken", "availableAt"
        ) VALUES (
          'pre-forward-migration', 'RESEND', 'PROCESSING', 0, NOW(),
          NOW() + INTERVAL '15 minutes', 'owned-upgrade-claim', NOW()
        )
      `);

      const transitionMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260913200000_enforce_transfer_proof_delivery_transitions/migration.sql",
      ), "utf8");
      await client.query(transitionMigration);
      const providerPinMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260913203000_pin_transfer_proof_provider_on_dispatch/migration.sql",
      ), "utf8");
      await client.query(providerPinMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET provider = 'SENDGRID', "attemptCount" = 1,
          "firstAttemptAt" = "processingAt", "dispatchStartedAt" = "processingAt"
        WHERE id = 'pre-forward-migration'
      `)).rejects.toThrow("Transfer-proof delivery attempt increment requires its owned dispatch boundary");
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "attemptCount" = 1, "firstAttemptAt" = "processingAt",
          "dispatchStartedAt" = "processingAt"
        WHERE id = 'pre-forward-migration'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${transitionSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs replay-safe handoff fencing as a forward-only upgrade", async () => {
    const handoffSchema = `transfer_proof_handoff_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${handoffSchema}"`);
      await client.query(`SET search_path TO "${handoffSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3),
          "lastError" TEXT,
          "availableAt" TIMESTAMP(3) NOT NULL
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "firstAttemptAt", "processingAt",
          "leaseExpiresAt", "claimToken", "dispatchStartedAt", "availableAt"
        ) VALUES
          ('permissive-65', 'SENDGRID', 'PROCESSING', 1, NOW(), NOW(),
            NOW() + INTERVAL '15 minutes', 'pre-66-owner', NOW(), NOW()),
          ('strict-66', 'SENDGRID', 'PROCESSING', 1, NOW(), NOW(),
            NOW() + INTERVAL '15 minutes', 'post-66-owner', NOW(), NOW())
      `);

      for (const migration of [
        "20260913200000_enforce_transfer_proof_delivery_transitions",
        "20260913203000_pin_transfer_proof_provider_on_dispatch",
        "20260913210000_bind_first_transfer_proof_attempt_timestamp",
        "20260913213000_fence_transfer_proof_claim_reassignment",
      ]) {
        const sql = await readFile(join(
          process.cwd(), `prisma/migrations/${migration}/migration.sql`,
        ), "utf8");
        await client.query(sql);
      }

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "processingAt" = "leaseExpiresAt",
          "leaseExpiresAt" = "leaseExpiresAt" + INTERVAL '15 minutes',
          "claimToken" = 'pre-66-successor', "dispatchStartedAt" = NULL
        WHERE id = 'permissive-65'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const replayFencingMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260913220000_fence_transfer_proof_replay_handoffs/migration.sql",
      ), "utf8");
      await client.query(replayFencingMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "processingAt" = "leaseExpiresAt",
          "leaseExpiresAt" = "leaseExpiresAt" + INTERVAL '15 minutes',
          "claimToken" = 'post-66-successor', "dispatchStartedAt" = NULL
        WHERE id = 'strict-66'
      `)).rejects.toThrow("Transfer-proof delivery expired claim is not replay-safe");
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${handoffSchema}" CASCADE`);
      client.release();
    }
  });

  it("freezes attempted provider and first-attempt identities before replay handoffs", async () => {
    const identitySchema = `transfer_proof_attempt_identity_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${identitySchema}"`);
      await client.query(`SET search_path TO "${identitySchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3),
          "lastError" TEXT,
          "availableAt" TIMESTAMP(3) NOT NULL
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "firstAttemptAt", "processingAt",
          "leaseExpiresAt", "claimToken", "dispatchStartedAt", "lastError", "availableAt"
        ) VALUES
          ('provider-rewrite', 'SENDGRID', 'PROCESSING', 1,
            TIMESTAMP '2026-12-01 00:00:00', TIMESTAMP '2026-12-02 00:00:00',
            TIMESTAMP '2026-12-02 00:15:00', 'provider-owner',
            TIMESTAMP '2026-12-01 00:00:00', NULL, TIMESTAMP '2026-12-02 00:00:00'),
          ('timestamp-rewrite', 'RESEND', 'FAILED', 1,
            TIMESTAMP '2026-12-01 00:00:00', NULL, NULL, NULL, NULL,
            'temporary rejection', TIMESTAMP '2026-12-02 00:00:00')
      `);

      for (const migration of [
        "20260913200000_enforce_transfer_proof_delivery_transitions",
        "20260913203000_pin_transfer_proof_provider_on_dispatch",
        "20260913210000_bind_first_transfer_proof_attempt_timestamp",
        "20260913213000_fence_transfer_proof_claim_reassignment",
        "20260913220000_fence_transfer_proof_replay_handoffs",
        "20260913223000_freeze_transfer_proof_attempt_identity",
      ]) {
        const sql = await readFile(join(
          process.cwd(), `prisma/migrations/${migration}/migration.sql`,
        ), "utf8");
        await client.query(sql);
      }

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET provider = 'RESEND'
        WHERE id = 'provider-rewrite'
      `)).rejects.toThrow("Transfer-proof delivery attempted provider identity is immutable");
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "firstAttemptAt" = TIMESTAMP '2026-12-02 00:00:00'
        WHERE id = 'timestamp-rewrite'
      `)).rejects.toThrow("Transfer-proof delivery attempted first-attempt identity is immutable");

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "processingAt" = "leaseExpiresAt",
          "leaseExpiresAt" = "leaseExpiresAt" + INTERVAL '15 minutes',
          "claimToken" = 'provider-successor', "dispatchStartedAt" = NULL
        WHERE id = 'provider-rewrite'
      `)).rejects.toThrow("Transfer-proof delivery expired claim is not replay-safe");

      await expect(client.query(`
        SELECT id, provider,
          "firstAttemptAt" = TIMESTAMP '2026-12-01 00:00:00' AS "firstAttemptUnchanged"
        FROM "TransferProofDeliveryIntent" ORDER BY id
      `)).resolves.toMatchObject({ rows: [
        {
          id: "provider-rewrite", provider: "SENDGRID",
          firstAttemptUnchanged: true,
        },
        {
          id: "timestamp-rewrite", provider: "RESEND",
          firstAttemptUnchanged: true,
        },
      ] });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${identitySchema}" CASCADE`);
      client.release();
    }
  });

  it("requires a due pre-dispatch claim before a failed delivery can retry", async () => {
    const [earlyId, combinedId, validId] = await seedAdminBatch("retry-claim-boundary", 3);
    const firstAttemptAt = new Date("2026-12-01T01:00:00.000Z");
    const availableAt = new Date("2026-12-01T03:00:00.000Z");
    await forceLegacyIntentState(
      { id: { in: [earlyId, combinedId, validId] } },
      {
        status: "FAILED", provider: "RESEND", attemptCount: 1, firstAttemptAt,
        availableAt, lastError: "synthetic retryable rejection",
      },
    );

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: earlyId },
      data: {
        status: "PROCESSING", processingAt: new Date("2026-12-01T02:59:00.000Z"),
        leaseExpiresAt: new Date("2026-12-01T03:14:00.000Z"),
        claimToken: "early-retry-claim", lastError: null,
      },
    })).rejects.toThrow("Transfer-proof delivery claim must be due and pre-dispatch");

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: combinedId },
      data: {
        status: "PROCESSING", processingAt: availableAt,
        leaseExpiresAt: new Date("2026-12-01T03:15:00.000Z"),
        claimToken: "combined-retry-dispatch", dispatchStartedAt: availableAt,
        lastError: null,
      },
    })).rejects.toThrow("Transfer-proof delivery claim must be due and pre-dispatch");

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: validId },
      data: {
        status: "PROCESSING", processingAt: availableAt,
        leaseExpiresAt: new Date("2026-12-01T03:15:00.000Z"),
        claimToken: "valid-retry-claim", lastError: null,
      },
    })).resolves.toMatchObject({
      status: "PROCESSING", attemptCount: 1, dispatchStartedAt: null,
    });
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: validId },
      data: { attemptCount: 2, dispatchStartedAt: availableAt },
    })).resolves.toMatchObject({ attemptCount: 2, dispatchStartedAt: availableAt });
  });

  it("requires an owned dispatch boundary before recording delivery", async () => {
    const [undispatchedId, earlyCompletionId, validId] = await seedAdminBatch(
      "delivery-dispatch-boundary", 3,
    );
    const firstAttemptAt = new Date("2026-12-01T01:00:00.000Z");
    const availableAt = new Date("2026-12-01T03:00:00.000Z");
    const leaseExpiresAt = new Date("2026-12-01T03:15:00.000Z");
    await forceLegacyIntentState(
      { id: { in: [undispatchedId, earlyCompletionId, validId] } },
      {
        status: "FAILED", provider: "RESEND", attemptCount: 1, firstAttemptAt,
        availableAt, lastError: "synthetic retryable rejection",
      },
    );
    for (const id of [undispatchedId, earlyCompletionId, validId]) {
      await prisma.transferProofDeliveryIntent.update({
        where: { id },
        data: {
          status: "PROCESSING", processingAt: availableAt, leaseExpiresAt,
          claimToken: `delivery-claim-${id}`, lastError: null,
        },
      });
    }

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: undispatchedId },
      data: {
        status: "DELIVERED", processingAt: null, leaseExpiresAt: null,
        claimToken: null, deliveredAt: new Date("2026-12-01T03:05:00.000Z"),
      },
    })).rejects.toThrow("Transfer-proof delivery completion requires its owned dispatch boundary");

    for (const id of [earlyCompletionId, validId]) {
      await prisma.transferProofDeliveryIntent.update({
        where: { id },
        data: { attemptCount: 2, dispatchStartedAt: availableAt },
      });
    }
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: earlyCompletionId },
      data: {
        status: "DELIVERED", processingAt: null, leaseExpiresAt: null,
        claimToken: null, dispatchStartedAt: null,
        deliveredAt: new Date("2026-12-01T02:59:00.000Z"),
      },
    })).rejects.toThrow("Transfer-proof delivery completion requires its owned dispatch boundary");

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: validId },
      data: {
        status: "DELIVERED", processingAt: null, leaseExpiresAt: null,
        claimToken: null, dispatchStartedAt: null,
        deliveredAt: availableAt,
      },
    })).resolves.toMatchObject({ status: "DELIVERED", attemptCount: 2 });
  });

  it("binds successful delivery evidence to the owned dispatch clock", async () => {
    const [forgedId, validId] = await seedAdminBatch("delivery-clock", 2);

    async function claimAndDispatch(id: string, claimToken: string) {
      const pending = await prisma.transferProofDeliveryIntent.findUniqueOrThrow({
        where: { id }, select: { availableAt: true },
      });
      await prisma.transferProofDeliveryIntent.update({
        where: { id },
        data: {
          status: "PROCESSING", provider: "RESEND", processingAt: pending.availableAt,
          leaseExpiresAt: new Date(pending.availableAt.getTime() + 15 * 60 * 1000),
          claimToken,
        },
      });
      await prisma.transferProofDeliveryIntent.update({
        where: { id },
        data: {
          attemptCount: { increment: 1 }, firstAttemptAt: pending.availableAt,
          dispatchStartedAt: pending.availableAt,
        },
      });
      return pending.availableAt;
    }

    const forgedDispatchAt = await claimAndDispatch(forgedId, "forged-delivery-clock-owner");
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: forgedId },
      data: {
        status: "DELIVERED", processingAt: null, leaseExpiresAt: null,
        claimToken: null, dispatchStartedAt: null,
        deliveredAt: new Date(forgedDispatchAt.getTime() + 60 * 1000),
      },
    })).rejects.toThrow(
      "Transfer-proof delivery completion must use its owned dispatch clock",
    );

    const validDispatchAt = await claimAndDispatch(validId, "valid-delivery-clock-owner");
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: validId },
      data: {
        status: "DELIVERED", processingAt: null, leaseExpiresAt: null,
        claimToken: null, dispatchStartedAt: null, deliveredAt: validDispatchAt,
      },
    })).resolves.toMatchObject({
      status: "DELIVERED", attemptCount: 1, deliveredAt: validDispatchAt,
    });
  });

  it("requires an owned dispatch boundary and deterministic schedule before retry", async () => {
    const [undispatchedId, earlyRetryId, lateRetryId, validId] = await seedAdminBatch(
      "failure-dispatch-boundary", 4,
    );
    const firstAttemptAt = new Date("2026-12-01T01:00:00.000Z");
    const availableAt = new Date("2026-12-01T03:00:00.000Z");
    const leaseExpiresAt = new Date("2026-12-01T03:15:00.000Z");
    await forceLegacyIntentState(
      { id: { in: [undispatchedId, earlyRetryId, lateRetryId, validId] } },
      {
        status: "FAILED", provider: "RESEND", attemptCount: 1, firstAttemptAt,
        availableAt, lastError: "synthetic retryable rejection",
      },
    );
    for (const id of [undispatchedId, earlyRetryId, lateRetryId, validId]) {
      await prisma.transferProofDeliveryIntent.update({
        where: { id },
        data: {
          status: "PROCESSING", processingAt: availableAt, leaseExpiresAt,
          claimToken: `failure-claim-${id}`, lastError: null,
        },
      });
    }

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: undispatchedId },
      data: {
        status: "FAILED", processingAt: null, leaseExpiresAt: null,
        claimToken: null, lastError: "synthetic undispatched rejection",
        availableAt: new Date("2026-12-01T03:05:00.000Z"),
      },
    })).rejects.toThrow("Transfer-proof delivery failure requires its owned dispatch boundary");

    for (const id of [earlyRetryId, lateRetryId, validId]) {
      await prisma.transferProofDeliveryIntent.update({
        where: { id },
        data: { attemptCount: 2, dispatchStartedAt: availableAt },
      });
    }
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: earlyRetryId },
      data: {
        status: "FAILED", processingAt: null, leaseExpiresAt: null,
        claimToken: null, dispatchStartedAt: null,
        lastError: "synthetic rejected delivery",
        availableAt: new Date("2026-12-01T03:05:00.000Z"),
      },
    })).rejects.toThrow(
      "Transfer-proof delivery retry requires its deterministic dispatch schedule",
    );

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: lateRetryId },
      data: {
        status: "FAILED", processingAt: null, leaseExpiresAt: null,
        claimToken: null, dispatchStartedAt: null,
        lastError: "synthetic rejected delivery",
        availableAt: new Date("2026-12-01T03:11:00.000Z"),
      },
    })).rejects.toThrow(
      "Transfer-proof delivery retry requires its deterministic dispatch schedule",
    );

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: validId },
      data: {
        status: "FAILED", processingAt: null, leaseExpiresAt: null,
        claimToken: null, dispatchStartedAt: null,
        lastError: "synthetic rejected delivery",
        availableAt: new Date("2026-12-01T03:10:00.000Z"),
      },
    })).resolves.toMatchObject({
      status: "FAILED", attemptCount: 2,
      availableAt: new Date("2026-12-01T03:10:00.000Z"),
    });
  });

  it("binds accepted-Resend persistence recovery to the deterministic retry schedule", async () => {
    const [forgedId, validId, validRetryId] = await seedAdminBatch(
      "resend-recovery-schedule", 3,
    );

    async function claimAndDispatch(id: string, claimToken: string) {
      const pending = await prisma.transferProofDeliveryIntent.findUniqueOrThrow({ where: { id } });
      const processingAt = pending.availableAt;
      await prisma.transferProofDeliveryIntent.update({
        where: { id },
        data: {
          status: "PROCESSING", provider: "RESEND", processingAt,
          leaseExpiresAt: new Date(processingAt.getTime() + 15 * 60 * 1000),
          claimToken, lastError: null,
        },
      });
      await prisma.transferProofDeliveryIntent.update({
        where: { id },
        data: {
          attemptCount: { increment: 1 }, firstAttemptAt: pending.firstAttemptAt ?? processingAt,
          dispatchStartedAt: processingAt,
        },
      });
      return processingAt;
    }

    const forgedDispatch = await claimAndDispatch(forgedId, "forged-recovery-schedule-owner");
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: forgedId },
      data: {
        leaseExpiresAt: forgedDispatch,
        availableAt: new Date(forgedDispatch.getTime() + 60 * 60 * 1000),
        lastError: "accepted delivery persistence lost ownership",
      },
    })).rejects.toThrow(
      "Transfer-proof delivery retry requires its deterministic dispatch schedule",
    );

    const validDispatch = await claimAndDispatch(validId, "valid-recovery-schedule-owner");
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: validId },
      data: {
        leaseExpiresAt: validDispatch,
        availableAt: new Date(validDispatch.getTime() + 5 * 60 * 1000),
        lastError: "accepted delivery persistence lost ownership",
      },
    })).resolves.toMatchObject({
      status: "PROCESSING", attemptCount: 1,
      availableAt: new Date(validDispatch.getTime() + 5 * 60 * 1000),
    });

    const retryAt = new Date("2026-12-01T04:00:00.000Z");
    await forceLegacyIntentState(
      { id: validRetryId },
      {
        status: "FAILED", provider: "RESEND", attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T03:00:00.000Z"),
        availableAt: retryAt, lastError: "synthetic first rejection",
      },
    );
    const validRetryDispatch = await claimAndDispatch(
      validRetryId,
      "valid-second-recovery-schedule-owner",
    );
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: validRetryId },
      data: {
        leaseExpiresAt: validRetryDispatch,
        availableAt: new Date(validRetryDispatch.getTime() + 10 * 60 * 1000),
        lastError: "second accepted delivery persistence lost ownership",
      },
    })).resolves.toMatchObject({
      status: "PROCESSING", attemptCount: 2,
      availableAt: new Date(validRetryDispatch.getTime() + 10 * 60 * 1000),
    });
  });

  it("freezes retryable failure evidence until a due retry claim is acquired", async () => {
    const [rewrittenId, validId] = await seedAdminBatch("failure-evidence-freeze", 2);
    const firstAttemptAt = new Date("2026-12-01T01:00:00.000Z");
    const availableAt = new Date("2026-12-01T03:00:00.000Z");
    await forceLegacyIntentState(
      { id: { in: [rewrittenId, validId] } },
      {
        status: "FAILED", provider: "RESEND", attemptCount: 1, firstAttemptAt,
        availableAt, lastError: "synthetic retryable rejection",
      },
    );

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: rewrittenId },
      data: {
        lastError: "rewritten rejection",
        availableAt: new Date("2026-12-01T02:00:00.000Z"),
      },
    })).rejects.toThrow(
      "Failed transfer-proof delivery evidence is immutable until retry or reconciliation",
    );

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: validId },
      data: {
        status: "PROCESSING", processingAt: availableAt,
        leaseExpiresAt: new Date("2026-12-01T03:15:00.000Z"),
        claimToken: "valid-frozen-failure-retry", lastError: null,
      },
    })).resolves.toMatchObject({
      status: "PROCESSING", attemptCount: 1, lastError: null,
    });
  });

  it("freezes a pending delivery schedule until its due claim is acquired", async () => {
    const [rewrittenId, validId] = await seedAdminBatch("pending-schedule-freeze", 2);
    const valid = await prisma.transferProofDeliveryIntent.findUniqueOrThrow({
      where: { id: validId },
      select: { availableAt: true },
    });

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: rewrittenId },
      data: { availableAt: new Date("2026-12-01T02:00:00.000Z") },
    })).rejects.toThrow(
      "Pending transfer-proof delivery availability is immutable until claim",
    );

    await expect(prisma.$executeRaw`
      UPDATE "TransferProofDeliveryIntent"
      SET "updatedAt" = "updatedAt" + INTERVAL '1 second'
      WHERE id = ${validId}
    `).resolves.toBe(1);

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: validId },
      data: {
        status: "PROCESSING", provider: "RESEND", processingAt: valid.availableAt,
        leaseExpiresAt: new Date(valid.availableAt.getTime() + 15 * 60 * 1000),
        claimToken: "valid-pending-schedule-claim",
      },
    })).resolves.toMatchObject({
      status: "PROCESSING", availableAt: valid.availableAt,
    });
  });

  it("preserves the source schedule while acquiring pending and retry claims", async () => {
    const [pendingId, failedId, validId] = await seedAdminBatch("claim-schedule", 3);
    const pending = await prisma.transferProofDeliveryIntent.findUniqueOrThrow({
      where: { id: pendingId }, select: { availableAt: true },
    });

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: pendingId },
      data: {
        status: "PROCESSING", provider: "RESEND", processingAt: pending.availableAt,
        leaseExpiresAt: new Date(pending.availableAt.getTime() + 15 * 60 * 1000),
        claimToken: "rewritten-pending-claim",
        availableAt: new Date(pending.availableAt.getTime() + 60 * 60 * 1000),
      },
    })).rejects.toThrow(
      "Transfer-proof delivery claim must preserve its source schedule",
    );

    const retryAt = new Date("2026-12-01T09:00:00.000Z");
    await forceLegacyIntentState(
      { id: { in: [failedId, validId] } },
      {
        status: "FAILED", provider: "RESEND", attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T08:00:00.000Z"),
        availableAt: retryAt, lastError: "synthetic retryable failure",
      },
    );

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: failedId },
      data: {
        status: "PROCESSING", processingAt: retryAt,
        leaseExpiresAt: new Date("2026-12-01T09:15:00.000Z"),
        claimToken: "rewritten-retry-claim", lastError: null,
        availableAt: new Date("2026-12-01T10:00:00.000Z"),
      },
    })).rejects.toThrow(
      "Transfer-proof delivery claim must preserve its source schedule",
    );

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: validId },
      data: {
        status: "PROCESSING", processingAt: retryAt,
        leaseExpiresAt: new Date("2026-12-01T09:15:00.000Z"),
        claimToken: "valid-retry-schedule-claim", lastError: null,
      },
    })).resolves.toMatchObject({
      status: "PROCESSING", availableAt: retryAt,
    });
  });

  it("binds claim acquisition and handoff to the bounded worker lease", async () => {
    const [pendingId, failedId, handoffId, futurePendingId, futureFailedId]
      = await seedAdminBatch("claim-lease", 5);
    const pending = await prisma.transferProofDeliveryIntent.findUniqueOrThrow({
      where: { id: pendingId }, select: { availableAt: true },
    });

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: pendingId },
      data: {
        status: "PROCESSING", provider: "RESEND", processingAt: pending.availableAt,
        leaseExpiresAt: new Date(pending.availableAt.getTime() + 60 * 60 * 1000),
        claimToken: "unbounded-pending-claim",
      },
    })).rejects.toThrow(
      "Transfer-proof delivery claim requires the bounded worker lease",
    );

    const retryAt = new Date("2026-12-01T10:00:00.000Z");
    await forceLegacyIntentState(
      { id: failedId },
      {
        status: "FAILED", provider: "RESEND", attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T09:00:00.000Z"),
        availableAt: retryAt, lastError: "synthetic retryable failure",
      },
    );
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: failedId },
      data: {
        status: "PROCESSING", processingAt: retryAt,
        leaseExpiresAt: new Date("2026-12-01T10:14:00.000Z"),
        claimToken: "short-retry-claim", lastError: null,
      },
    })).rejects.toThrow(
      "Transfer-proof delivery claim requires the bounded worker lease",
    );

    const handoff = await prisma.transferProofDeliveryIntent.findUniqueOrThrow({
      where: { id: handoffId }, select: { availableAt: true },
    });
    const firstLeaseExpiresAt = new Date(handoff.availableAt.getTime() + 15 * 60 * 1000);
    await prisma.transferProofDeliveryIntent.update({
      where: { id: handoffId },
      data: {
        status: "PROCESSING", provider: "RESEND", processingAt: handoff.availableAt,
        leaseExpiresAt: firstLeaseExpiresAt, claimToken: "initial-bounded-owner",
      },
    });
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: handoffId },
      data: {
        processingAt: firstLeaseExpiresAt,
        leaseExpiresAt: new Date(firstLeaseExpiresAt.getTime() + 20 * 60 * 1000),
        claimToken: "unbounded-successor-owner",
      },
    })).rejects.toThrow(
      "Transfer-proof delivery claim requires the bounded worker lease",
    );
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: handoffId },
      data: {
        processingAt: firstLeaseExpiresAt,
        leaseExpiresAt: new Date(firstLeaseExpiresAt.getTime() + 15 * 60 * 1000),
        claimToken: "bounded-successor-owner",
      },
    })).resolves.toMatchObject({
      status: "PROCESSING", claimToken: "bounded-successor-owner",
    });

    const forgedProcessingAt = new NativeDate(NativeDate.now() + 365 * 24 * 60 * 60 * 1000);
    const forgedLeaseExpiresAt = new NativeDate(forgedProcessingAt.getTime() + 15 * 60 * 1000);
    for (const id of [futurePendingId, futureFailedId]) {
      if (id === futureFailedId) {
        await forceLegacyIntentState(
          { id },
          {
            status: "FAILED", provider: "RESEND", attemptCount: 1,
            firstAttemptAt: new NativeDate(),
            availableAt: new NativeDate(), lastError: "synthetic retryable failure",
          },
        );
      }
      await expect(prisma.transferProofDeliveryIntent.update({
        where: { id },
        data: {
          status: "PROCESSING", provider: "RESEND", processingAt: forgedProcessingAt,
          leaseExpiresAt: forgedLeaseExpiresAt,
          claimToken: `future-claim-${id}`, lastError: null,
        },
      })).rejects.toThrow(
        "Transfer-proof delivery claim requires the bounded worker lease",
      );
    }

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: handoffId },
      data: {
        processingAt: forgedProcessingAt, leaseExpiresAt: forgedLeaseExpiresAt,
        claimToken: "future-successor-owner",
      },
    })).rejects.toThrow(
      "Transfer-proof delivery claim requires the bounded worker lease",
    );
  });

  it("rejects stale claim leases and Resend replays at the database clock", async () => {
    const [stalePendingId, expiredResendId, validPendingId, validResendId]
      = await seedAdminBatch("claim-clock", 4);
    const databaseNow = new NativeDate();
    const staleProcessingAt = new NativeDate(databaseNow.getTime() - 20 * 60 * 1000);
    const currentProcessingAt = new NativeDate(databaseNow.getTime());

    await forceLegacyIntentState(
      { id: expiredResendId },
      {
        status: "FAILED", provider: "RESEND", attemptCount: 1,
        firstAttemptAt: new NativeDate(databaseNow.getTime() - 25 * 60 * 60 * 1000),
        availableAt: new NativeDate(databaseNow.getTime() - 60 * 60 * 1000),
        lastError: "synthetic expired Resend rejection",
      },
    );
    await forceLegacyIntentState(
      { id: validResendId },
      {
        status: "FAILED", provider: "RESEND", attemptCount: 1,
        firstAttemptAt: new NativeDate(databaseNow.getTime() - 60 * 60 * 1000),
        availableAt: new NativeDate(databaseNow.getTime() - 60 * 1000),
        lastError: "synthetic current Resend rejection",
      },
    );

    await useDatabaseClaimClock();
    try {
      await expect(prisma.transferProofDeliveryIntent.update({
        where: { id: stalePendingId },
        data: {
          status: "PROCESSING", provider: "RESEND", processingAt: staleProcessingAt,
          leaseExpiresAt: new NativeDate(staleProcessingAt.getTime() + 15 * 60 * 1000),
          claimToken: "stale-pending-owner",
        },
      })).rejects.toThrow(
        "Transfer-proof delivery claim requires a live replay-safe worker lease",
      );

      await expect(prisma.transferProofDeliveryIntent.update({
        where: { id: expiredResendId },
        data: {
          status: "PROCESSING", processingAt: currentProcessingAt,
          leaseExpiresAt: new NativeDate(currentProcessingAt.getTime() + 15 * 60 * 1000),
          claimToken: "expired-resend-owner", lastError: null,
        },
      })).rejects.toThrow(
        "Transfer-proof delivery claim requires a live replay-safe worker lease",
      );

      await expect(prisma.transferProofDeliveryIntent.update({
        where: { id: validPendingId },
        data: {
          status: "PROCESSING", provider: "RESEND", processingAt: currentProcessingAt,
          leaseExpiresAt: new NativeDate(currentProcessingAt.getTime() + 15 * 60 * 1000),
          claimToken: "current-pending-owner",
        },
      })).resolves.toMatchObject({
        status: "PROCESSING", claimToken: "current-pending-owner",
      });

      await expect(prisma.transferProofDeliveryIntent.update({
        where: { id: validResendId },
        data: {
          status: "PROCESSING", processingAt: currentProcessingAt,
          leaseExpiresAt: new NativeDate(currentProcessingAt.getTime() + 15 * 60 * 1000),
          claimToken: "current-resend-owner", lastError: null,
        },
      })).resolves.toMatchObject({
        status: "PROCESSING", claimToken: "current-resend-owner",
      });
    } finally {
      await useHistoricalClaimClock();
    }
  });

  it("binds provider dispatch to the owned claim clock", async () => {
    const [firstId, retryId, validId] = await seedAdminBatch("dispatch-clock", 3);

    async function claim(id: string, token: string) {
      const pending = await prisma.transferProofDeliveryIntent.findUniqueOrThrow({
        where: { id }, select: { availableAt: true },
      });
      await prisma.transferProofDeliveryIntent.update({
        where: { id },
        data: {
          status: "PROCESSING", provider: "RESEND", processingAt: pending.availableAt,
          leaseExpiresAt: new Date(pending.availableAt.getTime() + 15 * 60 * 1000),
          claimToken: token,
        },
      });
      return pending.availableAt;
    }

    const firstProcessingAt = await claim(firstId, "first-dispatch-clock-owner");
    const forgedFirstDispatch = new Date(firstProcessingAt.getTime() + 60 * 1000);
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: firstId },
      data: {
        attemptCount: { increment: 1 }, firstAttemptAt: forgedFirstDispatch,
        dispatchStartedAt: forgedFirstDispatch,
      },
    })).rejects.toThrow(
      "Transfer-proof delivery dispatch must use its owned claim clock",
    );

    const retryAt = new Date("2026-12-01T11:00:00.000Z");
    await forceLegacyIntentState(
      { id: retryId },
      {
        status: "FAILED", provider: "RESEND", attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T10:00:00.000Z"),
        availableAt: retryAt, lastError: "synthetic retryable failure",
      },
    );
    await prisma.transferProofDeliveryIntent.update({
      where: { id: retryId },
      data: {
        status: "PROCESSING", processingAt: retryAt,
        leaseExpiresAt: new Date(retryAt.getTime() + 15 * 60 * 1000),
        claimToken: "retry-dispatch-clock-owner", lastError: null,
      },
    });
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: retryId },
      data: {
        attemptCount: { increment: 1 },
        dispatchStartedAt: new Date(retryAt.getTime() + 60 * 1000),
      },
    })).rejects.toThrow(
      "Transfer-proof delivery dispatch must use its owned claim clock",
    );

    const validProcessingAt = await claim(validId, "valid-dispatch-clock-owner");
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: validId },
      data: {
        attemptCount: { increment: 1 }, firstAttemptAt: validProcessingAt,
        dispatchStartedAt: validProcessingAt,
      },
    })).resolves.toMatchObject({
      status: "PROCESSING", attemptCount: 1,
      dispatchStartedAt: validProcessingAt,
    });
  });

  it("requires a live replay-safe lease when provider dispatch begins", async () => {
    const [staleId, expiredResendId, validId] = await seedAdminBatch("dispatch-window", 3);
    const databaseNow = new NativeDate();
    const staleProcessingAt = new NativeDate(databaseNow.getTime() - 20 * 60 * 1000);
    const currentProcessingAt = new NativeDate(databaseNow.getTime());

    await forceLegacyIntentState(
      { id: staleId },
      {
        status: "PROCESSING", provider: "RESEND", attemptCount: 0,
        processingAt: staleProcessingAt,
        leaseExpiresAt: new NativeDate(staleProcessingAt.getTime() + 15 * 60 * 1000),
        claimToken: "stale-dispatch-owner",
      },
    );
    await forceLegacyIntentState(
      { id: expiredResendId },
      {
        status: "PROCESSING", provider: "RESEND", attemptCount: 1,
        firstAttemptAt: new NativeDate(databaseNow.getTime() - 24 * 60 * 60 * 1000),
        processingAt: currentProcessingAt,
        leaseExpiresAt: new NativeDate(currentProcessingAt.getTime() + 15 * 60 * 1000),
        claimToken: "expired-resend-dispatch-owner",
      },
    );
    await forceLegacyIntentState(
      { id: validId },
      {
        status: "PROCESSING", provider: "RESEND", attemptCount: 1,
        firstAttemptAt: new NativeDate(databaseNow.getTime() - 60 * 60 * 1000),
        processingAt: currentProcessingAt,
        leaseExpiresAt: new NativeDate(currentProcessingAt.getTime() + 15 * 60 * 1000),
        claimToken: "valid-dispatch-window-owner",
      },
    );

    await useDatabaseClaimClock();
    try {
      await expect(prisma.transferProofDeliveryIntent.update({
        where: { id: staleId },
        data: {
          attemptCount: { increment: 1 }, firstAttemptAt: staleProcessingAt,
          dispatchStartedAt: staleProcessingAt,
        },
      })).rejects.toThrow(
        "Transfer-proof delivery dispatch requires a live replay-safe worker lease",
      );

      await expect(prisma.transferProofDeliveryIntent.update({
        where: { id: expiredResendId },
        data: {
          attemptCount: { increment: 1 }, dispatchStartedAt: currentProcessingAt,
        },
      })).rejects.toThrow(
        "Transfer-proof delivery dispatch requires a live replay-safe worker lease",
      );

      await expect(prisma.transferProofDeliveryIntent.update({
        where: { id: validId },
        data: {
          attemptCount: { increment: 1 }, dispatchStartedAt: currentProcessingAt,
        },
      })).resolves.toMatchObject({
        status: "PROCESSING", attemptCount: 2,
        dispatchStartedAt: currentProcessingAt,
      });
    } finally {
      await useHistoricalClaimClock();
    }
  });

  it("requires the dispatching worker lease to remain live when recording a provider result", async () => {
    const [deliveredId, failedId, recoveryId, reconciliationId, validId] = await seedAdminBatch(
      "result-lease", 5,
    );
    const databaseNow = new NativeDate();
    const expiredDispatch = new NativeDate(databaseNow.getTime() - 20 * 60 * 1000);
    const liveDispatch = new NativeDate(databaseNow.getTime());

    for (const [id, dispatch, token] of [
      [deliveredId, expiredDispatch, "expired-delivery-owner"],
      [failedId, expiredDispatch, "expired-failure-owner"],
      [recoveryId, expiredDispatch, "expired-recovery-owner"],
      [reconciliationId, expiredDispatch, "expired-reconciliation-owner"],
      [validId, liveDispatch, "live-delivery-owner"],
    ] as const) {
      await forceLegacyIntentState(
        { id },
        {
          status: "PROCESSING", provider: "RESEND", attemptCount: 1,
          firstAttemptAt: dispatch, processingAt: dispatch,
          leaseExpiresAt: new NativeDate(dispatch.getTime() + 15 * 60 * 1000),
          claimToken: token, dispatchStartedAt: dispatch, availableAt: dispatch,
        },
      );
    }

    await useDatabaseClaimClock();
    try {
      await expect(prisma.transferProofDeliveryIntent.update({
        where: { id: deliveredId },
        data: {
          status: "DELIVERED", deliveredAt: expiredDispatch,
          processingAt: null, leaseExpiresAt: null, claimToken: null,
          dispatchStartedAt: null,
        },
      })).rejects.toThrow(
        "Transfer-proof delivery result requires its live worker lease",
      );

      await expect(prisma.transferProofDeliveryIntent.update({
        where: { id: failedId },
        data: {
          status: "FAILED", processingAt: null, leaseExpiresAt: null,
          claimToken: null, dispatchStartedAt: null,
          lastError: "synthetic provider rejection",
          availableAt: new NativeDate(expiredDispatch.getTime() + 5 * 60 * 1000),
        },
      })).rejects.toThrow(
        "Transfer-proof delivery result requires its live worker lease",
      );

      await expect(prisma.transferProofDeliveryIntent.update({
        where: { id: recoveryId },
        data: {
          leaseExpiresAt: expiredDispatch,
          lastError: "accepted delivery persistence lost ownership",
          availableAt: new NativeDate(expiredDispatch.getTime() + 5 * 60 * 1000),
        },
      })).rejects.toThrow(
        "Transfer-proof delivery result requires its live worker lease",
      );

      await expect(prisma.transferProofDeliveryIntent.update({
        where: { id: reconciliationId },
        data: {
          status: "RECONCILIATION_REQUIRED", processingAt: null,
          leaseExpiresAt: null, claimToken: null, dispatchStartedAt: null,
          lastError: "Ambiguous stale provider dispatch requires reconciliation",
        },
      })).resolves.toMatchObject({
        status: "RECONCILIATION_REQUIRED", provider: "RESEND",
        attemptCount: 1, firstAttemptAt: expiredDispatch,
        deliveredAt: null,
      });

      await expect(prisma.transferProofDeliveryIntent.update({
        where: { id: validId },
        data: {
          status: "DELIVERED", deliveredAt: liveDispatch,
          processingAt: null, leaseExpiresAt: null, claimToken: null,
          dispatchStartedAt: null,
        },
      })).resolves.toMatchObject({
        status: "DELIVERED", deliveredAt: liveDispatch,
      });
    } finally {
      await useHistoricalClaimClock();
    }
  });

  it("preserves active processing evidence outside replay-safe Resend recovery", async () => {
    const [sendGridId, resendId, activeId] = await seedAdminBatch("processing-evidence", 3);

    async function claimAndDispatch(id: string, provider: "RESEND" | "SENDGRID", claimToken: string) {
      const pending = await prisma.transferProofDeliveryIntent.findUniqueOrThrow({ where: { id } });
      const processingAt = pending.availableAt;
      await prisma.transferProofDeliveryIntent.update({
        where: { id },
        data: {
          status: "PROCESSING", provider, processingAt,
          leaseExpiresAt: new Date(processingAt.getTime() + 15 * 60 * 1000),
          claimToken,
        },
      });
      await prisma.transferProofDeliveryIntent.update({
        where: { id },
        data: {
          attemptCount: { increment: 1 }, firstAttemptAt: processingAt,
          dispatchStartedAt: processingAt,
        },
      });
      return processingAt;
    }

    const sendGridDispatch = await claimAndDispatch(sendGridId, "SENDGRID", "sendgrid-processing-owner");
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: sendGridId },
      data: {
        leaseExpiresAt: sendGridDispatch,
        availableAt: new Date(sendGridDispatch.getTime() + 5 * 60 * 1000),
        lastError: "fabricated recovery",
      },
    })).rejects.toThrow(
      "Transfer-proof delivery recovery requires replay-safe Resend evidence",
    );

    const resendDispatch = await claimAndDispatch(resendId, "RESEND", "resend-processing-owner");
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: resendId },
      data: {
        leaseExpiresAt: resendDispatch,
        availableAt: new Date(resendDispatch.getTime() + 5 * 60 * 1000),
        lastError: "accepted delivery persistence lost ownership",
      },
    })).resolves.toMatchObject({
      provider: "RESEND", status: "PROCESSING", attemptCount: 1,
      leaseExpiresAt: resendDispatch,
    });

    await claimAndDispatch(activeId, "RESEND", "active-processing-owner");
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: activeId },
      data: { lastError: "standalone rewrite" },
    })).rejects.toThrow(
      "Active transfer-proof delivery evidence is immutable outside recovery",
    );
  });

  it("preserves source evidence when escalating delivery to reconciliation", async () => {
    const [fabricatedId, processingId, failedId] = await seedAdminBatch(
      "reconciliation-evidence", 3,
    );

    for (const [id, token] of [
      [fabricatedId, "fabricated-reconciliation-owner"],
      [processingId, "valid-reconciliation-owner"],
    ] as const) {
      const pending = await prisma.transferProofDeliveryIntent.findUniqueOrThrow({
        where: { id },
      });
      await prisma.transferProofDeliveryIntent.update({
        where: { id },
        data: {
          status: "PROCESSING", provider: "RESEND", processingAt: pending.availableAt,
          leaseExpiresAt: new Date(pending.availableAt.getTime() + 15 * 60 * 1000),
          claimToken: token,
        },
      });
    }

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: fabricatedId },
      data: {
        status: "RECONCILIATION_REQUIRED", processingAt: null, leaseExpiresAt: null,
        claimToken: null, deliveredAt: new Date("2026-12-01T08:00:00.000Z"),
        lastError: "fabricated terminal delivery evidence",
      },
    })).rejects.toThrow(
      "Transfer-proof reconciliation must preserve source attempt evidence",
    );

    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: processingId },
      data: {
        status: "RECONCILIATION_REQUIRED", processingAt: null, leaseExpiresAt: null,
        claimToken: null, lastError: "synthetic pre-dispatch quarantine",
      },
    })).resolves.toMatchObject({
      status: "RECONCILIATION_REQUIRED", provider: "RESEND",
      attemptCount: 0, deliveredAt: null,
    });

    const failedAvailableAt = new Date("2026-12-01T09:00:00.000Z");
    await forceLegacyIntentState(
      { id: failedId },
      {
        status: "FAILED", provider: "RESEND", attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T08:00:00.000Z"),
        availableAt: failedAvailableAt, lastError: "synthetic retryable failure",
      },
    );
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: failedId },
      data: {
        status: "RECONCILIATION_REQUIRED",
        availableAt: new Date("2026-12-01T08:30:00.000Z"),
      },
    })).rejects.toThrow(
      "Transfer-proof reconciliation must preserve failed retry evidence",
    );
    await expect(prisma.transferProofDeliveryIntent.update({
      where: { id: failedId },
      data: { status: "RECONCILIATION_REQUIRED" },
    })).resolves.toMatchObject({
      status: "RECONCILIATION_REQUIRED", availableAt: failedAvailableAt,
      lastError: "synthetic retryable failure",
    });
  });

  it("installs reconciliation-evidence binding as a forward-only upgrade", async () => {
    const reconciliationSchema = `transfer_proof_reconciliation_evidence_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${reconciliationSchema}"`);
      await client.query(`SET search_path TO "${reconciliationSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3),
          "availableAt" TIMESTAMP(3) NOT NULL,
          "lastError" TEXT
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "processingAt", "leaseExpiresAt",
          "claimToken", "availableAt"
        ) VALUES
          ('permissive-73', 'RESEND', 'PROCESSING', 0,
            TIMESTAMP '2026-12-01 07:00:00', TIMESTAMP '2026-12-01 07:15:00',
            'permissive-owner', TIMESTAMP '2026-12-01 07:00:00'),
          ('strict-74', 'RESEND', 'PROCESSING', 0,
            TIMESTAMP '2026-12-01 08:00:00', TIMESTAMP '2026-12-01 08:15:00',
            'strict-owner', TIMESTAMP '2026-12-01 08:00:00'),
          ('valid-74', 'RESEND', 'PROCESSING', 0,
            TIMESTAMP '2026-12-01 09:00:00', TIMESTAMP '2026-12-01 09:15:00',
            'valid-owner', TIMESTAMP '2026-12-01 09:00:00')
      `);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'RECONCILIATION_REQUIRED', "processingAt" = NULL,
          "leaseExpiresAt" = NULL, "claimToken" = NULL,
          "deliveredAt" = TIMESTAMP '2026-12-01 07:01:00',
          "lastError" = 'fabricated delivery evidence'
        WHERE id = 'permissive-73'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const reconciliationEvidenceMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914020000_bind_transfer_proof_reconciliation_evidence/migration.sql",
      ), "utf8");
      await client.query(reconciliationEvidenceMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'RECONCILIATION_REQUIRED', "processingAt" = NULL,
          "leaseExpiresAt" = NULL, "claimToken" = NULL,
          "deliveredAt" = TIMESTAMP '2026-12-01 08:01:00',
          "lastError" = 'fabricated delivery evidence'
        WHERE id = 'strict-74'
      `)).rejects.toThrow(
        "Transfer-proof reconciliation must preserve source attempt evidence",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'RECONCILIATION_REQUIRED', "processingAt" = NULL,
          "leaseExpiresAt" = NULL, "claimToken" = NULL,
          "lastError" = 'valid pre-dispatch quarantine'
        WHERE id = 'valid-74'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${reconciliationSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs claim-schedule binding as a forward-only upgrade", async () => {
    const claimSchema = `transfer_proof_claim_schedule_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${claimSchema}"`);
      await client.query(`SET search_path TO "${claimSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          "availableAt" TIMESTAMP(3) NOT NULL
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (id, status, "availableAt") VALUES
          ('permissive-74', 'PENDING', TIMESTAMP '2026-12-01 07:00:00'),
          ('strict-75', 'PENDING', TIMESTAMP '2026-12-01 08:00:00'),
          ('valid-75', 'FAILED', TIMESTAMP '2026-12-01 09:00:00')
      `);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING', "availableAt" = TIMESTAMP '2026-12-01 07:30:00'
        WHERE id = 'permissive-74'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const claimScheduleMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914023000_bind_transfer_proof_claim_schedule/migration.sql",
      ), "utf8");
      await client.query(claimScheduleMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING', "availableAt" = TIMESTAMP '2026-12-01 08:30:00'
        WHERE id = 'strict-75'
      `)).rejects.toThrow(
        "Transfer-proof delivery claim must preserve its source schedule",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING'
        WHERE id = 'valid-75'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${claimSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs bounded claim leases as a forward-only upgrade", async () => {
    const claimSchema = `transfer_proof_claim_lease_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${claimSchema}"`);
      await client.query(`SET search_path TO "${claimSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          "availableAt" TIMESTAMP(3) NOT NULL,
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (id, status, "availableAt") VALUES
          ('permissive-75', 'PENDING', NOW() - INTERVAL '1 day'),
          ('strict-76', 'PENDING', NOW() - INTERVAL '1 day'),
          ('valid-76', 'FAILED', NOW() - INTERVAL '1 day')
      `);

      const claimScheduleMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914023000_bind_transfer_proof_claim_schedule/migration.sql",
      ), "utf8");
      await client.query(claimScheduleMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING',
          "processingAt" = NOW() + INTERVAL '1 year',
          "leaseExpiresAt" = NOW() + INTERVAL '1 year 15 minutes',
          "claimToken" = 'permissive-long-lease'
        WHERE id = 'permissive-75'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const claimLeaseMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914030000_bind_transfer_proof_claim_lease/migration.sql",
      ), "utf8");
      await client.query(claimLeaseMigration);
      await client.query("SET TIME ZONE 'Asia/Tokyo'");

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING',
          "processingAt" = (statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '1 year',
          "leaseExpiresAt" = (statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '1 year 15 minutes',
          "claimToken" = 'strict-long-lease'
        WHERE id = 'strict-76'
      `)).rejects.toThrow(
        "Transfer-proof delivery claim requires the bounded worker lease",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING',
          "processingAt" = statement_timestamp() AT TIME ZONE 'UTC',
          "leaseExpiresAt" = (statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '15 minutes',
          "claimToken" = 'valid-bounded-lease'
        WHERE id = 'valid-76'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET TIME ZONE 'UTC'");
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${claimSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs claim-clock-bound dispatch as a forward-only upgrade", async () => {
    const dispatchSchema = `transfer_proof_dispatch_clock_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${dispatchSchema}"`);
      await client.query(`SET search_path TO "${dispatchSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3)
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, status, "attemptCount", "processingAt", "leaseExpiresAt",
          "claimToken", "dispatchStartedAt"
        ) VALUES
          ('permissive-76', 'PROCESSING', 0,
            TIMESTAMP '2026-12-01 07:00:00', TIMESTAMP '2026-12-01 07:15:00',
            'permissive-owner', NULL),
          ('strict-77', 'PROCESSING', 1,
            TIMESTAMP '2026-12-01 08:00:00', TIMESTAMP '2026-12-01 08:15:00',
            'strict-owner', NULL),
          ('valid-77', 'PROCESSING', 2,
            TIMESTAMP '2026-12-01 09:00:00', TIMESTAMP '2026-12-01 09:15:00',
            'valid-owner', NULL)
      `);

      const claimLeaseMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914030000_bind_transfer_proof_claim_lease/migration.sql",
      ), "utf8");
      await client.query(claimLeaseMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "attemptCount" = 1,
          "dispatchStartedAt" = "processingAt" + INTERVAL '1 minute'
        WHERE id = 'permissive-76'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const dispatchClockMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914033000_bind_transfer_proof_dispatch_clock/migration.sql",
      ), "utf8");
      await client.query(dispatchClockMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "attemptCount" = 2,
          "dispatchStartedAt" = "processingAt" + INTERVAL '1 minute'
        WHERE id = 'strict-77'
      `)).rejects.toThrow(
        "Transfer-proof delivery dispatch must use its owned claim clock",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "attemptCount" = 3, "dispatchStartedAt" = "processingAt"
        WHERE id = 'valid-77'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${dispatchSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs deterministic retry scheduling as a forward-only upgrade", async () => {
    const retrySchema = `transfer_proof_retry_schedule_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${retrySchema}"`);
      await client.query(`SET search_path TO "${retrySchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "availableAt" TIMESTAMP(3) NOT NULL,
          "lastError" TEXT
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, status, "attemptCount", "processingAt", "leaseExpiresAt",
          "claimToken", "dispatchStartedAt", "availableAt"
        ) VALUES
          ('permissive-77', 'PROCESSING', 1,
            TIMESTAMP '2026-12-01 07:00:00', TIMESTAMP '2026-12-01 07:15:00',
            'permissive-owner', TIMESTAMP '2026-12-01 07:00:00',
            TIMESTAMP '2026-12-01 07:00:00'),
          ('strict-78', 'PROCESSING', 2,
            TIMESTAMP '2026-12-01 08:00:00', TIMESTAMP '2026-12-01 08:15:00',
            'strict-owner', TIMESTAMP '2026-12-01 08:00:00',
            TIMESTAMP '2026-12-01 08:00:00'),
          ('valid-78', 'PROCESSING', 1,
            TIMESTAMP '2026-12-01 09:00:00', TIMESTAMP '2026-12-01 09:15:00',
            'valid-owner', TIMESTAMP '2026-12-01 09:00:00',
            TIMESTAMP '2026-12-01 09:00:00')
      `);

      const retrySchedulePredecessorMigrations = [
        "20260914030000_bind_transfer_proof_claim_lease",
        "20260914033000_bind_transfer_proof_dispatch_clock",
      ];
      for (const migration of retrySchedulePredecessorMigrations) {
        const migrationSql = await readFile(join(
          process.cwd(),
          `prisma/migrations/${migration}/migration.sql`,
        ), "utf8");
        await client.query(migrationSql);
      }

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'FAILED', "processingAt" = NULL,
          "leaseExpiresAt" = NULL, "claimToken" = NULL,
          "dispatchStartedAt" = NULL,
          "availableAt" = TIMESTAMP '2026-12-01 07:30:00',
          "lastError" = 'permitted before migration 78'
        WHERE id = 'permissive-77'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const retryScheduleMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914040000_bind_transfer_proof_retry_schedule/migration.sql",
      ), "utf8");
      await client.query(retryScheduleMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'FAILED', "processingAt" = NULL,
          "leaseExpiresAt" = NULL, "claimToken" = NULL,
          "dispatchStartedAt" = NULL,
          "availableAt" = TIMESTAMP '2026-12-01 08:05:00',
          "lastError" = 'forged retry schedule'
        WHERE id = 'strict-78'
      `)).rejects.toThrow(
        "Transfer-proof delivery retry requires its deterministic dispatch schedule",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'FAILED', "processingAt" = NULL,
          "leaseExpiresAt" = NULL, "claimToken" = NULL,
          "dispatchStartedAt" = NULL,
          "availableAt" = TIMESTAMP '2026-12-01 09:05:00',
          "lastError" = 'valid deterministic retry schedule'
        WHERE id = 'valid-78'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${retrySchema}" CASCADE`);
      client.release();
    }
  });

  it("installs database-clock-bound claim leases as a forward-only upgrade", async () => {
    const claimClockSchema = `transfer_proof_claim_clock_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${claimClockSchema}"`);
      await client.query(`SET search_path TO "${claimClockSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "availableAt" TIMESTAMP(3) NOT NULL,
          "lastError" TEXT
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "firstAttemptAt", "availableAt"
        ) VALUES
          ('permissive-78', NULL, 'PENDING', 0, NULL,
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 hour'),
          ('strict-79', NULL, 'PENDING', 0, NULL,
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 hour'),
          ('expired-79', 'RESEND', 'FAILED', 1,
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '25 hours',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 hour'),
          ('valid-79', 'RESEND', 'FAILED', 1,
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 hour',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 minutes')
      `);

      const claimClockPredecessorMigrations = [
        "20260914030000_bind_transfer_proof_claim_lease",
        "20260914033000_bind_transfer_proof_dispatch_clock",
        "20260914040000_bind_transfer_proof_retry_schedule",
      ];
      for (const migration of claimClockPredecessorMigrations) {
        const migrationSql = await readFile(join(
          process.cwd(),
          `prisma/migrations/${migration}/migration.sql`,
        ), "utf8");
        await client.query(migrationSql);
      }

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING', provider = 'RESEND',
          "processingAt" = (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
          "leaseExpiresAt" = (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 minutes',
          "claimToken" = 'permissive-stale-owner'
        WHERE id = 'permissive-78'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const claimClockMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914043000_bind_transfer_proof_claim_clock/migration.sql",
      ), "utf8");
      await client.query(claimClockMigration);
      await client.query("SET TIME ZONE 'Asia/Tokyo'");

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING', provider = 'RESEND',
          "processingAt" = (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
          "leaseExpiresAt" = (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 minutes',
          "claimToken" = 'strict-stale-owner'
        WHERE id = 'strict-79'
      `)).rejects.toThrow(
        "Transfer-proof delivery claim requires a live replay-safe worker lease",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING',
          "processingAt" = statement_timestamp() AT TIME ZONE 'UTC',
          "leaseExpiresAt" = (statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '15 minutes',
          "claimToken" = 'expired-resend-owner', "lastError" = NULL
        WHERE id = 'expired-79'
      `)).rejects.toThrow(
        "Transfer-proof delivery claim requires a live replay-safe worker lease",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING',
          "processingAt" = statement_timestamp() AT TIME ZONE 'UTC',
          "leaseExpiresAt" = (statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '15 minutes',
          "claimToken" = 'valid-current-owner', "lastError" = NULL
        WHERE id = 'valid-79'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET TIME ZONE 'UTC'");
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${claimClockSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs database-clock-bound dispatch windows as a forward-only upgrade", async () => {
    const dispatchWindowSchema = `transfer_proof_dispatch_window_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${dispatchWindowSchema}"`);
      await client.query(`SET search_path TO "${dispatchWindowSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "availableAt" TIMESTAMP(3) NOT NULL,
          "lastError" TEXT
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "firstAttemptAt", "processingAt",
          "leaseExpiresAt", "claimToken", "availableAt"
        ) VALUES
          ('permissive-79', 'RESEND', 'PROCESSING', 0, NULL,
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 minutes',
            'permissive-stale-owner', statement_timestamp() AT TIME ZONE 'UTC'),
          ('strict-80', 'RESEND', 'PROCESSING', 0, NULL,
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 minutes',
            'strict-stale-owner', statement_timestamp() AT TIME ZONE 'UTC'),
          ('expired-80', 'RESEND', 'PROCESSING', 1,
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '24 hours',
            statement_timestamp() AT TIME ZONE 'UTC',
            (statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '15 minutes',
            'expired-resend-owner', statement_timestamp() AT TIME ZONE 'UTC'),
          ('valid-80', 'RESEND', 'PROCESSING', 1,
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 hour',
            statement_timestamp() AT TIME ZONE 'UTC',
            (statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '15 minutes',
            'valid-current-owner', statement_timestamp() AT TIME ZONE 'UTC')
      `);

      for (const migration of [
        "20260914030000_bind_transfer_proof_claim_lease",
        "20260914033000_bind_transfer_proof_dispatch_clock",
        "20260914043000_bind_transfer_proof_claim_clock",
      ]) {
        const migrationSql = await readFile(join(
          process.cwd(), `prisma/migrations/${migration}/migration.sql`,
        ), "utf8");
        await client.query(migrationSql);
      }

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "attemptCount" = 1, "firstAttemptAt" = "processingAt",
          "dispatchStartedAt" = "processingAt"
        WHERE id = 'permissive-79'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const dispatchWindowMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914050000_bind_transfer_proof_dispatch_window/migration.sql",
      ), "utf8");
      await client.query(dispatchWindowMigration);
      await client.query("SET TIME ZONE 'America/Los_Angeles'");

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "attemptCount" = 1, "firstAttemptAt" = "processingAt",
          "dispatchStartedAt" = "processingAt"
        WHERE id = 'strict-80'
      `)).rejects.toThrow(
        "Transfer-proof delivery dispatch requires a live replay-safe worker lease",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "attemptCount" = 2, "dispatchStartedAt" = "processingAt"
        WHERE id = 'expired-80'
      `)).rejects.toThrow(
        "Transfer-proof delivery dispatch requires a live replay-safe worker lease",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "attemptCount" = 2, "dispatchStartedAt" = "processingAt"
        WHERE id = 'valid-80'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET TIME ZONE 'UTC'");
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${dispatchWindowSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs dispatch-clock-bound delivery evidence as a forward-only upgrade", async () => {
    const deliveryClockSchema = `transfer_proof_delivery_clock_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${deliveryClockSchema}"`);
      await client.query(`SET search_path TO "${deliveryClockSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3)
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, status, "dispatchStartedAt"
        ) VALUES
          ('permissive-80', 'PROCESSING', TIMESTAMP '2026-12-01 12:00:00'),
          ('strict-81', 'PROCESSING', TIMESTAMP '2026-12-01 12:00:00'),
          ('valid-81', 'PROCESSING', TIMESTAMP '2026-12-01 13:00:00')
      `);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'DELIVERED',
          "deliveredAt" = "dispatchStartedAt" + INTERVAL '1 minute'
        WHERE id = 'permissive-80'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const deliveryClockMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914053000_bind_transfer_proof_delivery_clock/migration.sql",
      ), "utf8");
      await client.query(deliveryClockMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'DELIVERED',
          "deliveredAt" = "dispatchStartedAt" + INTERVAL '1 minute'
        WHERE id = 'strict-81'
      `)).rejects.toThrow(
        "Transfer-proof delivery completion must use its owned dispatch clock",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'DELIVERED', "deliveredAt" = "dispatchStartedAt"
        WHERE id = 'valid-81'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${deliveryClockSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs live result leases as a forward-only upgrade", async () => {
    const resultLeaseSchema = `transfer_proof_result_lease_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${resultLeaseSchema}"`);
      await client.query(`SET search_path TO "${resultLeaseSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3),
          "lastError" TEXT,
          "availableAt" TIMESTAMP(3) NOT NULL
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "firstAttemptAt",
          "processingAt", "leaseExpiresAt", "claimToken",
          "dispatchStartedAt", "availableAt"
        ) VALUES
          ('permissive-81', 'RESEND', 'PROCESSING', 1,
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 minutes',
            'permissive-owner',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            statement_timestamp() AT TIME ZONE 'UTC'),
          ('strict-delivery-82', 'RESEND', 'PROCESSING', 1,
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 minutes',
            'strict-delivery-owner',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            statement_timestamp() AT TIME ZONE 'UTC'),
          ('strict-failure-82', 'RESEND', 'PROCESSING', 1,
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 minutes',
            'strict-failure-owner',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            statement_timestamp() AT TIME ZONE 'UTC'),
          ('strict-recovery-82', 'RESEND', 'PROCESSING', 1,
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 minutes',
            'strict-recovery-owner',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            statement_timestamp() AT TIME ZONE 'UTC'),
          ('reconciliation-82', 'RESEND', 'PROCESSING', 1,
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 minutes',
            'reconciliation-owner',
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '20 minutes',
            statement_timestamp() AT TIME ZONE 'UTC'),
          ('valid-82', 'RESEND', 'PROCESSING', 1,
            statement_timestamp() AT TIME ZONE 'UTC',
            statement_timestamp() AT TIME ZONE 'UTC',
            (statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '15 minutes',
            'valid-owner', statement_timestamp() AT TIME ZONE 'UTC',
            statement_timestamp() AT TIME ZONE 'UTC')
      `);

      for (const migration of [
        "20260914043000_bind_transfer_proof_claim_clock",
        "20260914050000_bind_transfer_proof_dispatch_window",
        "20260914053000_bind_transfer_proof_delivery_clock",
      ]) {
        const migrationSql = await readFile(join(
          process.cwd(), `prisma/migrations/${migration}/migration.sql`,
        ), "utf8");
        await client.query(migrationSql);
      }

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'DELIVERED', "deliveredAt" = "dispatchStartedAt"
        WHERE id = 'permissive-81'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const resultLeaseMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914060000_bind_transfer_proof_result_lease/migration.sql",
      ), "utf8");
      await client.query(resultLeaseMigration);
      await client.query("SET TIME ZONE 'America/Los_Angeles'");

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'DELIVERED', "deliveredAt" = "dispatchStartedAt"
        WHERE id = 'strict-delivery-82'
      `)).rejects.toThrow(
        "Transfer-proof delivery result requires its live worker lease",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'FAILED', "lastError" = 'synthetic provider rejection'
        WHERE id = 'strict-failure-82'
      `)).rejects.toThrow(
        "Transfer-proof delivery result requires its live worker lease",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "leaseExpiresAt" = "processingAt",
          "lastError" = 'accepted delivery persistence recovery'
        WHERE id = 'strict-recovery-82'
      `)).rejects.toThrow(
        "Transfer-proof delivery result requires its live worker lease",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'RECONCILIATION_REQUIRED', "processingAt" = NULL,
          "leaseExpiresAt" = NULL, "claimToken" = NULL,
          "dispatchStartedAt" = NULL,
          "lastError" = 'Ambiguous stale provider dispatch requires reconciliation'
        WHERE id = 'reconciliation-82'
      `)).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'DELIVERED', "deliveredAt" = "dispatchStartedAt"
        WHERE id = 'valid-82'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET TIME ZONE 'UTC'");
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${resultLeaseSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs append-only delivery history as a forward-only upgrade", async () => {
    const appendOnlySchema = `transfer_proof_append_only_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${appendOnlySchema}"`);
      await client.query(`SET search_path TO "${appendOnlySchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3),
          "lastError" TEXT,
          "availableAt" TIMESTAMP(3) NOT NULL
        )
      `);

      for (const migration of [
        "20260914043000_bind_transfer_proof_claim_clock",
        "20260914050000_bind_transfer_proof_dispatch_window",
        "20260914053000_bind_transfer_proof_delivery_clock",
        "20260914060000_bind_transfer_proof_result_lease",
      ]) {
        const migrationSql = await readFile(join(
          process.cwd(), `prisma/migrations/${migration}/migration.sql`,
        ), "utf8");
        await client.query(migrationSql);
      }

      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, status, "attemptCount", "availableAt"
        ) VALUES
          ('permissive-delete-82', 'PENDING', 0, statement_timestamp() AT TIME ZONE 'UTC'),
          ('permissive-truncate-82', 'PENDING', 0, statement_timestamp() AT TIME ZONE 'UTC')
      `);
      await expect(client.query(`
        DELETE FROM "TransferProofDeliveryIntent" WHERE id = 'permissive-delete-82'
      `)).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query('TRUNCATE TABLE "TransferProofDeliveryIntent"'))
        .resolves.toBeDefined();

      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, status, "attemptCount", "availableAt"
        ) VALUES ('strict-83', 'PENDING', 0, statement_timestamp() AT TIME ZONE 'UTC')
      `);
      const appendOnlyMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914063000_protect_transfer_proof_delivery_history/migration.sql",
      ), "utf8");
      await client.query(appendOnlyMigration);

      await expect(client.query(`
        DELETE FROM "TransferProofDeliveryIntent" WHERE id = 'strict-83'
      `)).rejects.toThrow("Transfer-proof delivery intents are append-only");
      await expect(client.query('TRUNCATE TABLE "TransferProofDeliveryIntent"'))
        .rejects.toThrow("Transfer-proof delivery intents are append-only");
      await expect(client.query(`
        SELECT count(*)::int AS count FROM "TransferProofDeliveryIntent" WHERE id = 'strict-83'
      `)).resolves.toMatchObject({ rows: [{ count: 1 }] });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${appendOnlySchema}" CASCADE`);
      client.release();
    }
  });

  it("installs database-owned history metadata after append-only delivery history", async () => {
    const historyMetadataSchema = `transfer_proof_history_metadata_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${historyMetadataSchema}"`);
      await client.query(`SET search_path TO "${historyMetadataSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          "createdAt" TIMESTAMP(3) NOT NULL,
          "updatedAt" TIMESTAMP(3) NOT NULL
        )
      `);

      const appendOnlyMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914063000_protect_transfer_proof_delivery_history/migration.sql",
      ), "utf8");
      await client.query(appendOnlyMigration);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (id, "createdAt", "updatedAt")
        VALUES (
          'permissive-identity-83',
          TIMESTAMP '2099-01-01 00:00:00',
          TIMESTAMP '2001-01-01 00:00:00'
        )
      `);
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET id = 'strict-identity-84'
        WHERE id = 'permissive-identity-83'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const historyMetadataMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914070000_protect_transfer_proof_delivery_history_metadata/migration.sql",
      ), "utf8");
      await client.query(historyMetadataMigration);
      await client.query("SET TIME ZONE 'America/Los_Angeles'");

      await expect(client.query(`
        SELECT
          "createdAt" = TIMESTAMP '2099-01-01 00:00:00' AS created_preserved,
          "updatedAt" = TIMESTAMP '2001-01-01 00:00:00' AS updated_preserved
        FROM "TransferProofDeliveryIntent"
        WHERE id = 'strict-identity-84'
      `)).resolves.toMatchObject({ rows: [{
        created_preserved: true,
        updated_preserved: true,
      }] });

      await client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "updatedAt" = TIMESTAMP '2001-01-01 00:00:00'
        WHERE id = 'strict-identity-84'
      `);
      await expect(client.query(`
        SELECT
          "createdAt" = TIMESTAMP '2099-01-01 00:00:00' AS created_preserved,
          "updatedAt" = TIMESTAMP '2099-01-01 00:00:00' AS updated_monotonic
        FROM "TransferProofDeliveryIntent"
        WHERE id = 'strict-identity-84'
      `)).resolves.toMatchObject({ rows: [{
        created_preserved: true,
        updated_monotonic: true,
      }] });

      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (id, "createdAt", "updatedAt")
        VALUES (
          'strict-clock-84',
          TIMESTAMP '2001-01-01 00:00:00',
          TIMESTAMP '2001-01-01 00:00:00'
        )
      `);
      await expect(client.query(`
        SELECT
          "createdAt" BETWEEN
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 seconds'
            AND statement_timestamp() AT TIME ZONE 'UTC' AS created_owned,
          "updatedAt" = "createdAt" AS timestamps_match
        FROM "TransferProofDeliveryIntent"
        WHERE id = 'strict-clock-84'
      `)).resolves.toMatchObject({ rows: [{ created_owned: true, timestamps_match: true }] });

      await client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "updatedAt" = TIMESTAMP '2001-01-01 00:00:00'
        WHERE id = 'strict-clock-84'
      `);
      await expect(client.query(`
        SELECT
          "createdAt" <= "updatedAt" AS chronology_preserved,
          "updatedAt" BETWEEN
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 seconds'
            AND (statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '1 millisecond'
            AS updated_owned
        FROM "TransferProofDeliveryIntent"
        WHERE id = 'strict-clock-84'
      `)).resolves.toMatchObject({ rows: [{ chronology_preserved: true, updated_owned: true }] });

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET id = 'forged-identity-84'
        WHERE id = 'strict-identity-84'
      `)).rejects.toThrow("Transfer-proof delivery row identity is immutable");
      await expect(client.query(`
        SELECT
          id,
          "createdAt" = TIMESTAMP '2099-01-01 00:00:00' AS created_preserved,
          "updatedAt" = TIMESTAMP '2099-01-01 00:00:00' AS updated_preserved
        FROM "TransferProofDeliveryIntent"
        WHERE id = 'strict-identity-84'
      `)).resolves.toMatchObject({ rows: [{
        id: "strict-identity-84",
        created_preserved: true,
        updated_preserved: true,
      }] });
    } finally {
      await client.query("SET TIME ZONE 'UTC'");
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${historyMetadataSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs canonical pending origin after protected history metadata", async () => {
    const pendingOriginSchema = `transfer_proof_pending_origin_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${pendingOriginSchema}"`);
      await client.query(`SET search_path TO "${pendingOriginSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          "orderId" TEXT NOT NULL,
          kind TEXT NOT NULL,
          recipient TEXT NOT NULL,
          "payloadJson" JSONB NOT NULL,
          provider TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING',
          "attemptCount" INTEGER NOT NULL DEFAULT 0,
          "firstAttemptAt" TIMESTAMP(3),
          "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3),
          "lastError" TEXT,
          "idempotencyKey" TEXT NOT NULL UNIQUE,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL
        )
      `);

      for (const migration of [
        "20260913184000_protect_transfer_proof_delivery_envelopes",
        "20260913190500_enforce_transfer_proof_delivery_lifecycle",
        "20260914063000_protect_transfer_proof_delivery_history",
        "20260914070000_protect_transfer_proof_delivery_history_metadata",
      ]) {
        const migrationSql = await readFile(join(
          process.cwd(), `prisma/migrations/${migration}/migration.sql`,
        ), "utf8");
        await client.query(migrationSql);
      }

      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", provider, status,
          "attemptCount", "firstAttemptAt", "availableAt", "deliveredAt",
          "idempotencyKey", "identityVersion", "envelopeDigest"
        ) VALUES (
          'permissive-terminal-84', 'order-84', 'BUYER_CONFIRMATION_EMAIL',
          'buyer@example.test', '{}'::jsonb, 'RESEND', 'DELIVERED', 1,
          TIMESTAMP '2026-09-14 05:45:00', TIMESTAMP '2026-09-14 05:45:00',
          TIMESTAMP '2026-09-14 05:45:00', 'permissive-terminal-84', 2,
          repeat('0', 64)
        )
      `)).resolves.toMatchObject({ rowCount: 1 });

      const pendingOriginMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914073000_require_transfer_proof_pending_origin/migration.sql",
      ), "utf8");
      await client.query(pendingOriginMigration);

      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", provider, status,
          "attemptCount", "firstAttemptAt", "availableAt", "deliveredAt",
          "idempotencyKey", "identityVersion", "envelopeDigest"
        ) VALUES (
          'strict-terminal-85', 'order-85', 'BUYER_CONFIRMATION_EMAIL',
          'buyer@example.test', '{}'::jsonb, 'RESEND', 'DELIVERED', 1,
          TIMESTAMP '2026-09-14 05:45:00', TIMESTAMP '2026-09-14 05:45:00',
          TIMESTAMP '2026-09-14 05:45:00', 'strict-terminal-85', 2,
          repeat('0', 64)
        )
      `)).rejects.toThrow("New transfer-proof delivery intents must originate pending");

      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", status,
          "attemptCount", "availableAt", "idempotencyKey",
          "identityVersion", "envelopeDigest"
        ) VALUES (
          'strict-pending-85', 'order-85', 'BUYER_CONFIRMATION_EMAIL',
          'buyer@example.test', '{}'::jsonb, 'PENDING', 0,
          TIMESTAMP '2026-09-14 05:45:00', 'strict-pending-85', 2,
          repeat('0', 64)
        )
      `)).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query(`
        SELECT status, provider, "attemptCount", "firstAttemptAt", "processingAt",
          "leaseExpiresAt", "claimToken", "dispatchStartedAt", "deliveredAt", "lastError"
        FROM "TransferProofDeliveryIntent"
        WHERE id = 'strict-pending-85'
      `)).resolves.toMatchObject({ rows: [{
        status: "PENDING",
        provider: null,
        attemptCount: 0,
        firstAttemptAt: null,
        processingAt: null,
        leaseExpiresAt: null,
        claimToken: null,
        dispatchStartedAt: null,
        deliveredAt: null,
        lastError: null,
      }] });
      await expect(client.query(`
        SELECT status FROM "TransferProofDeliveryIntent" WHERE id = 'permissive-terminal-84'
      `)).resolves.toMatchObject({ rows: [{ status: "DELIVERED" }] });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${pendingOriginSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs a database-owned pending origin schedule after canonical origin enforcement", async () => {
    const originClockSchema = `transfer_proof_origin_clock_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${originClockSchema}"`);
      await client.query(`SET search_path TO "${originClockSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          "orderId" TEXT NOT NULL,
          kind TEXT NOT NULL,
          recipient TEXT NOT NULL,
          "payloadJson" JSONB NOT NULL,
          provider TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING',
          "attemptCount" INTEGER NOT NULL DEFAULT 0,
          "firstAttemptAt" TIMESTAMP(3),
          "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3),
          "lastError" TEXT,
          "idempotencyKey" TEXT NOT NULL UNIQUE,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL
        )
      `);

      for (const migration of [
        "20260913184000_protect_transfer_proof_delivery_envelopes",
        "20260913190500_enforce_transfer_proof_delivery_lifecycle",
        "20260914063000_protect_transfer_proof_delivery_history",
        "20260914070000_protect_transfer_proof_delivery_history_metadata",
        "20260914073000_require_transfer_proof_pending_origin",
      ]) {
        const migrationSql = await readFile(join(
          process.cwd(), `prisma/migrations/${migration}/migration.sql`,
        ), "utf8");
        await client.query(migrationSql);
      }

      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "availableAt",
          "idempotencyKey", "identityVersion", "envelopeDigest"
        ) VALUES (
          'permissive-schedule-85', 'order-85', 'BUYER_CONFIRMATION_EMAIL',
          'buyer@example.test', '{}'::jsonb, TIMESTAMP '2099-01-01 00:00:00',
          'permissive-schedule-85', 2, repeat('0', 64)
        )
      `);
      await expect(client.query(`
        SELECT "availableAt" = TIMESTAMP '2099-01-01 00:00:00' AS caller_owned
        FROM "TransferProofDeliveryIntent" WHERE id = 'permissive-schedule-85'
      `)).resolves.toMatchObject({ rows: [{ caller_owned: true }] });
      const legacyBefore = (await client.query<{
        availableAt: Date;
        createdAt: Date;
        updatedAt: Date;
      }>(`
        SELECT "availableAt", "createdAt", "updatedAt"
        FROM "TransferProofDeliveryIntent" WHERE id = 'permissive-schedule-85'
      `)).rows[0];

      const originClockMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914080000_bind_transfer_proof_pending_origin_clock/migration.sql",
      ), "utf8");
      await client.query(originClockMigration);
      await client.query("SET TIME ZONE 'America/Los_Angeles'");
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "availableAt",
          "idempotencyKey", "identityVersion", "envelopeDigest"
        ) VALUES
          (
            'strict-future-schedule-86', 'order-86-future', 'BUYER_CONFIRMATION_EMAIL',
            'buyer@example.test', '{}'::jsonb, TIMESTAMP '2099-01-01 00:00:00',
            'strict-future-schedule-86', 2, repeat('0', 64)
          ),
          (
            'strict-past-schedule-86', 'order-86-past', 'BUYER_CONFIRMATION_EMAIL',
            'buyer@example.test', '{}'::jsonb, TIMESTAMP '2001-01-01 00:00:00',
            'strict-past-schedule-86', 2, repeat('0', 64)
          )
      `);

      await expect(client.query(`
        SELECT
          "availableAt" BETWEEN
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 seconds'
            AND statement_timestamp() AT TIME ZONE 'UTC' AS database_owned,
          "availableAt" = "createdAt" AND "availableAt" = "updatedAt" AS clocks_match
        FROM "TransferProofDeliveryIntent"
        WHERE id IN ('strict-future-schedule-86', 'strict-past-schedule-86')
        ORDER BY id
      `)).resolves.toMatchObject({ rows: [
        { database_owned: true, clocks_match: true },
        { database_owned: true, clocks_match: true },
      ] });
      await expect(client.query(`
        SELECT "availableAt", "createdAt", "updatedAt"
        FROM "TransferProofDeliveryIntent" WHERE id = 'permissive-schedule-85'
      `)).resolves.toMatchObject({ rows: [legacyBefore] });
    } finally {
      await client.query("SET TIME ZONE 'UTC'");
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${originClockSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs order provenance without erasing immutable legacy orphans", async () => {
    const orderBindingSchema = `transfer_proof_order_binding_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${orderBindingSchema}"`);
      await client.query(`SET search_path TO "${orderBindingSchema}"`);
      await client.query(`
        CREATE TABLE "Order" (
          id TEXT PRIMARY KEY
        );
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          "orderId" TEXT NOT NULL
        );
        INSERT INTO "Order" (id) VALUES ('existing-order-86');
        INSERT INTO "TransferProofDeliveryIntent" (id, "orderId") VALUES
          ('legacy-valid-86', 'existing-order-86'),
          ('legacy-orphan-86', 'missing-order-86');
      `);

      const orderBindingMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914083000_bind_transfer_proof_delivery_order/migration.sql",
      ), "utf8");
      await client.query(orderBindingMigration);

      await expect(client.query(`
        SELECT convalidated
        FROM pg_constraint
        WHERE conname = 'TransferProofDeliveryIntent_orderId_fkey'
          AND conrelid = '"TransferProofDeliveryIntent"'::regclass
      `)).resolves.toMatchObject({ rows: [{ convalidated: false }] });
      await expect(client.query(`
        SELECT id, "orderId"
        FROM "TransferProofDeliveryIntent"
        ORDER BY id
      `)).resolves.toMatchObject({ rows: [
        { id: "legacy-orphan-86", orderId: "missing-order-86" },
        { id: "legacy-valid-86", orderId: "existing-order-86" },
      ] });

      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (id, "orderId")
        VALUES ('new-orphan-87', 'missing-order-87')
      `)).rejects.toThrow(/foreign key constraint|violates foreign key/i);
      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (id, "orderId")
        VALUES ('new-valid-87', 'existing-order-86')
      `)).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query(`
        DELETE FROM "Order" WHERE id = 'existing-order-86'
      `)).rejects.toThrow(/foreign key constraint|violates foreign key/i);

      // A reviewed legacy orphan is resolved by restoring its missing parent,
      // never by erasing append-only delivery history. PostgreSQL can then
      // validate the same forward constraint with the evidence row intact.
      await client.query(`
        INSERT INTO "Order" (id) VALUES ('missing-order-86');
        ALTER TABLE "TransferProofDeliveryIntent"
        VALIDATE CONSTRAINT "TransferProofDeliveryIntent_orderId_fkey";
      `);
      await expect(client.query(`
        SELECT convalidated
        FROM pg_constraint
        WHERE conname = 'TransferProofDeliveryIntent_orderId_fkey'
          AND conrelid = '"TransferProofDeliveryIntent"'::regclass
      `)).resolves.toMatchObject({ rows: [{ convalidated: true }] });
      await expect(client.query(`
        SELECT id, "orderId"
        FROM "TransferProofDeliveryIntent"
        WHERE id = 'legacy-orphan-86'
      `)).resolves.toMatchObject({ rows: [{
        id: "legacy-orphan-86",
        orderId: "missing-order-86",
      }] });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${orderBindingSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs order-subject authorization without rewriting legacy delivery history", async () => {
    const subjectSchema = `transfer_proof_order_subject_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${subjectSchema}"`);
      await client.query(`SET search_path TO "${subjectSchema}"`);
      await client.query(`
        CREATE TABLE "Order" (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          "buyerConfirmationStatus" TEXT,
          "transferProofType" TEXT,
          "transferProofData" TEXT,
          "transferVerificationStatus" TEXT,
          "disputeWindowEndsAt" TIMESTAMP(3),
          "sellerId" TEXT NOT NULL,
          "buyerSellerId" TEXT NOT NULL
        );
        CREATE TABLE "User" (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          "firstName" TEXT NOT NULL,
          "sellerId" TEXT UNIQUE
        );
        CREATE TABLE "OrderItem" (
          id TEXT PRIMARY KEY,
          "orderId" TEXT NOT NULL
        );
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          "orderId" TEXT NOT NULL,
          kind TEXT NOT NULL,
          recipient TEXT NOT NULL,
          "payloadJson" JSONB NOT NULL
        );
        INSERT INTO "Order" (
          id, status, "buyerConfirmationStatus", "transferProofType",
          "transferProofData", "transferVerificationStatus",
          "disputeWindowEndsAt", "sellerId", "buyerSellerId"
        ) VALUES
          ('eligible-order-87', 'PAID', 'PENDING', 'EMAIL', 'legacy-proof',
            'PENDING', TIMESTAMP '2026-12-03 00:00:00', 'seller-87', 'buyer-seller-87'),
          ('ineligible-order-87', 'PENDING', 'PENDING', 'EMAIL', 'legacy-proof',
            'PENDING', TIMESTAMP '2026-12-03 00:00:00', 'seller-87', 'buyer-seller-87');
        INSERT INTO "User" (id, email, "firstName", "sellerId") VALUES
          ('seller-87', 'seller@example.test', 'Seller', 'seller-87'),
          ('buyer-87', 'buyer@example.test', 'Buyer', 'buyer-seller-87');
        INSERT INTO "OrderItem" (id, "orderId") VALUES
          ('eligible-ticket-87', 'eligible-order-87'),
          ('ineligible-ticket-87', 'ineligible-order-87');
      `);

      const orderBindingMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914083000_bind_transfer_proof_delivery_order/migration.sql",
      ), "utf8");
      await client.query(orderBindingMigration);

      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson"
        )
        VALUES (
          'permissive-wrong-buyer-87', 'eligible-order-87',
          'BUYER_CONFIRMATION_EMAIL', 'unrelated@example.test',
          '{"buyerFirstName":"Buyer","ticketCount":1,"deadline":"2026-12-03T00:00:00.000Z"}'::jsonb
        )
      `)).resolves.toMatchObject({ rowCount: 1 });

      const subjectMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914090000_bind_transfer_proof_delivery_subject/migration.sql",
      ), "utf8");
      await client.query(subjectMigration);

      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson"
        )
        VALUES (
          'strict-wrong-buyer-88', 'eligible-order-87',
          'BUYER_CONFIRMATION_EMAIL', 'unrelated@example.test',
          '{"buyerFirstName":"Buyer","ticketCount":1,"deadline":"2026-12-03T00:00:00.000Z"}'::jsonb
        )
      `)).rejects.toThrow(
        "Transfer-proof buyer delivery recipient must match the order buyer",
      );
      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson"
        ) VALUES (
          'strict-wrong-payload-88', 'eligible-order-87',
          'BUYER_CONFIRMATION_EMAIL', 'buyer@example.test',
          '{"buyerFirstName":"Buyer","ticketCount":2,"deadline":"2026-12-03T00:00:00.000Z"}'::jsonb
        )
      `)).rejects.toThrow(
        "Transfer-proof delivery payload must match the order ticket count and deadline",
      );
      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson"
        )
        VALUES (
          'strict-ineligible-order-88', 'ineligible-order-87',
          'ADMIN_TRANSFER_ACTIVITY_EMAIL', 'admin@truefantix.com',
          '{"sellerEmail":"seller@example.test","buyerEmail":"buyer@example.test","ticketCount":1,"transferProofType":"EMAIL","deadline":"2026-12-03T00:00:00.000Z"}'::jsonb
        )
      `)).rejects.toThrow(
        "Transfer-proof delivery requires an eligible paid transfer-proof order",
      );
      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson"
        )
        VALUES
          ('valid-buyer-88', 'eligible-order-87',
            'BUYER_CONFIRMATION_EMAIL', 'buyer@example.test',
            '{"buyerFirstName":"Buyer","ticketCount":1,"deadline":"2026-12-03T00:00:00.000Z"}'::jsonb),
          ('valid-admin-88', 'eligible-order-87',
            'ADMIN_TRANSFER_ACTIVITY_EMAIL', 'admin@truefantix.com',
            '{"sellerEmail":"seller@example.test","buyerEmail":"buyer@example.test","ticketCount":1,"transferProofType":"EMAIL","deadline":"2026-12-03T00:00:00.000Z"}'::jsonb)
      `)).resolves.toMatchObject({ rowCount: 2 });
      await expect(client.query(`
        SELECT id, recipient
        FROM "TransferProofDeliveryIntent"
        ORDER BY id
      `)).resolves.toMatchObject({ rows: [
        { id: "permissive-wrong-buyer-87", recipient: "unrelated@example.test" },
        { id: "valid-admin-88", recipient: "admin@truefantix.com" },
        { id: "valid-buyer-88", recipient: "buyer@example.test" },
      ] });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${subjectSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs canonical delivery identity as a forward-only upgrade", async () => {
    const identitySchema = `transfer_proof_subject_identity_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    const payloadJson = {
      buyerFirstName: "Buyer",
      ticketCount: 1,
      deadline: "2026-12-03T00:00:00.000Z",
      windowStart: "2026-12-01T00:00:00.000Z",
    };
    const envelope = {
      orderId: "eligible-order-88",
      kind: "BUYER_CONFIRMATION_EMAIL",
      recipient: "buyer@example.test",
      payloadJson,
    };
    const idempotencyKey = "eligible-order-88:2026-12-01T00:00:00.000Z:BUYER_CONFIRMATION_EMAIL:buyer@example.test";
    try {
      await client.query(`CREATE SCHEMA "${identitySchema}"`);
      await client.query(`SET search_path TO "${identitySchema}"`);
      await client.query(`
        CREATE TABLE "Order" (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          "buyerConfirmationStatus" TEXT,
          "transferProofType" TEXT,
          "transferProofData" TEXT,
          "transferVerificationStatus" TEXT,
          "disputeWindowEndsAt" TIMESTAMP(3),
          "sellerId" TEXT NOT NULL,
          "buyerSellerId" TEXT NOT NULL
        );
        CREATE TABLE "User" (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          "firstName" TEXT,
          "sellerId" TEXT UNIQUE
        );
        CREATE TABLE "OrderItem" (
          id TEXT PRIMARY KEY,
          "orderId" TEXT NOT NULL
        );
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          "orderId" TEXT NOT NULL,
          kind TEXT NOT NULL,
          recipient TEXT NOT NULL,
          "payloadJson" JSONB NOT NULL,
          "idempotencyKey" TEXT NOT NULL UNIQUE,
          "identityVersion" INTEGER NOT NULL,
          "envelopeDigest" TEXT
        );
        INSERT INTO "Order" (
          id, status, "buyerConfirmationStatus", "transferProofType",
          "transferProofData", "transferVerificationStatus",
          "disputeWindowEndsAt", "sellerId", "buyerSellerId"
        ) VALUES (
          'eligible-order-88', 'PAID', 'PENDING', 'EMAIL', 'legacy-proof',
          'PENDING', TIMESTAMP '2026-12-03 00:00:00', 'seller-88', 'buyer-seller-88'
        );
        INSERT INTO "User" (id, email, "firstName", "sellerId") VALUES
          ('seller-user-88', 'seller@example.test', 'Seller', 'seller-88'),
          ('buyer-88', 'buyer@example.test', 'Buyer', 'buyer-seller-88');
        INSERT INTO "OrderItem" (id, "orderId") VALUES
          ('eligible-ticket-88', 'eligible-order-88');
      `);

      const subjectMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914090000_bind_transfer_proof_delivery_subject/migration.sql",
      ), "utf8");
      await client.query(subjectMigration);

      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "idempotencyKey",
          "identityVersion", "envelopeDigest"
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 2, $7)
      `, [
        "permissive-forged-identity-88",
        envelope.orderId,
        envelope.kind,
        envelope.recipient,
        JSON.stringify(payloadJson),
        idempotencyKey,
        "0".repeat(64),
      ])).resolves.toMatchObject({ rowCount: 1 });

      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "idempotencyKey",
          "identityVersion", "envelopeDigest"
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 1, NULL)
      `, [
        "legacy-v1-identity-88",
        envelope.orderId,
        envelope.kind,
        envelope.recipient,
        JSON.stringify({ ...payloadJson, windowStart: "2026-12-01T12:00:00.000Z" }),
        "legacy-provider-key-88",
      ])).resolves.toMatchObject({ rowCount: 1 });

      const identityMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914093000_bind_transfer_proof_delivery_identity/migration.sql",
      ), "utf8");
      await expect(client.query(identityMigration)).rejects.toThrow(
        "Transfer-proof delivery identity preflight failed for row permissive-forged-identity-88",
      );
      await client.query("ROLLBACK");
      await expect(client.query(`
        SELECT "idempotencyKey", "envelopeDigest"
        FROM "TransferProofDeliveryIntent"
        WHERE id = 'permissive-forged-identity-88'
      `)).resolves.toMatchObject({ rows: [{
        idempotencyKey,
        envelopeDigest: "0".repeat(64),
      }] });
      await client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "envelopeDigest" = $1
        WHERE id = 'permissive-forged-identity-88'
      `, [envelopeDigest(envelope)]);
      await client.query(identityMigration);

      const secondPayload = { ...payloadJson, windowStart: "2026-12-01T06:00:00.000Z" };
      const secondEnvelope = { ...envelope, payloadJson: secondPayload };
      const secondKey = "eligible-order-88:2026-12-01T06:00:00.000Z:BUYER_CONFIRMATION_EMAIL:buyer@example.test";
      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "idempotencyKey",
          "identityVersion", "envelopeDigest"
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 2, $7)
      `, [
        "strict-forged-identity-89",
        secondEnvelope.orderId,
        secondEnvelope.kind,
        secondEnvelope.recipient,
        JSON.stringify(secondPayload),
        secondKey,
        "0".repeat(64),
      ])).rejects.toThrow(
        "Transfer-proof delivery digest must match its canonical envelope",
      );
      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "idempotencyKey",
          "identityVersion", "envelopeDigest"
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 2, $7)
      `, [
        "strict-valid-identity-89",
        secondEnvelope.orderId,
        secondEnvelope.kind,
        secondEnvelope.recipient,
        JSON.stringify(secondPayload),
        secondKey,
        envelopeDigest(secondEnvelope),
      ])).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query(`
        SELECT id, "idempotencyKey", "envelopeDigest"
        FROM "TransferProofDeliveryIntent"
        ORDER BY id
      `)).resolves.toMatchObject({ rows: [
        {
          id: "legacy-v1-identity-88",
          idempotencyKey: "legacy-provider-key-88",
          envelopeDigest: null,
        },
        {
          id: "permissive-forged-identity-88",
          idempotencyKey,
          envelopeDigest: envelopeDigest(envelope),
        },
        {
          id: "strict-valid-identity-89",
          idempotencyKey: secondKey,
          envelopeDigest: envelopeDigest(secondEnvelope),
        },
      ] });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${identitySchema}" CASCADE`);
      client.release();
    }
  });

  it("installs authoritative delivery clocks as an atomic forward-only upgrade", async () => {
    const clockSchema = `transfer_proof_authoritative_clock_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    const racingClient = await pool.connect();
    const migration = await readFile(join(
      process.cwd(),
      "prisma/migrations/20260914100000_bind_transfer_proof_delivery_clocks/migration.sql",
    ), "utf8");
    try {
      await client.query(`CREATE SCHEMA "${clockSchema}"`);
      await client.query(`SET search_path TO "${clockSchema}"`);
      await client.query(`
        CREATE TABLE "Order" (
          id TEXT PRIMARY KEY,
          "disputeWindowEndsAt" TIMESTAMP(3)
        );
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          "orderId" TEXT NOT NULL,
          kind TEXT NOT NULL,
          "payloadJson" JSONB NOT NULL,
          "identityVersion" INTEGER NOT NULL
        );
        INSERT INTO "Order" (id, "disputeWindowEndsAt") VALUES
          ('clock-order-89', TIMESTAMP '2026-12-03 00:00:00');
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, "payloadJson", "identityVersion"
        ) VALUES
          ('forged-buyer-clock-89', 'clock-order-89', 'BUYER_CONFIRMATION_EMAIL',
            '{"windowStart":"2026-12-02T00:00:00.000Z"}'::jsonb, 2),
          ('forged-admin-clock-89', 'clock-order-89', 'ADMIN_TRANSFER_ACTIVITY_EMAIL',
            '{"completedAt":"2026-12-02T00:00:00.000Z"}'::jsonb, 2),
          ('legacy-clock-89', 'clock-order-89', 'ADMIN_TRANSFER_ACTIVITY_EMAIL',
            '{"completedAt":"2020-01-01T00:00:00.000Z"}'::jsonb, 1);
      `);

      await racingClient.query(`SET search_path TO "${clockSchema}"`);
      await racingClient.query("BEGIN");
      await racingClient.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, "payloadJson", "identityVersion"
        ) VALUES (
          'concurrent-forged-clock-89', 'clock-order-89', 'BUYER_CONFIRMATION_EMAIL',
          '{"windowStart":"2026-12-02T06:00:00.000Z"}'::jsonb, 2
        )
      `);
      let migrationSettled = false;
      const racingMigration = client.query(migration)
        .finally(() => { migrationSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(migrationSettled).toBe(false);
      await racingClient.query("COMMIT");
      await expect(racingMigration).rejects.toThrow(
        "Transfer-proof delivery clock preflight failed for row concurrent-forged-clock-89",
      );
      await client.query("ROLLBACK");
      await expect(client.query(`
        SELECT to_regprocedure('transfer_proof_delivery_authoritative_completed_at(timestamp without time zone)') AS helper
      `)).resolves.toMatchObject({ rows: [{ helper: null }] });

      await client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "payloadJson" = '{"windowStart":"2026-12-02T00:00:00.000Z"}'::jsonb
        WHERE id = 'concurrent-forged-clock-89';
        UPDATE "TransferProofDeliveryIntent"
        SET "payloadJson" = '{"completedAt":"2026-12-02T01:00:00.000Z"}'::jsonb
        WHERE id = 'forged-admin-clock-89';
      `);
      await expect(client.query(migration)).rejects.toThrow(
        "Transfer-proof delivery clock preflight failed for row forged-admin-clock-89",
      );
      await client.query("ROLLBACK");
      await client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "payloadJson" = '{"completedAt":"2026-12-02T00:00:00.000Z"}'::jsonb
        WHERE id = 'forged-admin-clock-89'
      `);
      await client.query(migration);

      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, "payloadJson", "identityVersion"
        ) VALUES (
          'strict-forged-clock-90', 'clock-order-89', 'BUYER_CONFIRMATION_EMAIL',
          '{"windowStart":"2026-12-02T06:00:00.000Z"}'::jsonb, 2
        )
      `)).rejects.toThrow(
        "Transfer-proof buyer delivery window must match the order transfer clock",
      );
      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, "payloadJson", "identityVersion"
        ) VALUES (
          'strict-valid-clock-90', 'clock-order-89', 'BUYER_CONFIRMATION_EMAIL',
          '{"windowStart":"2026-12-02T00:00:00.000Z"}'::jsonb, 2
        )
      `)).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query(`
        SELECT id, "payloadJson"
        FROM "TransferProofDeliveryIntent"
        WHERE id = 'legacy-clock-89'
      `)).resolves.toMatchObject({ rows: [{
        id: "legacy-clock-89",
        payloadJson: { completedAt: "2020-01-01T00:00:00.000Z" },
      }] });
    } finally {
      await racingClient.query("ROLLBACK").catch(() => undefined);
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${clockSchema}" CASCADE`);
      await racingClient.query("SET search_path TO public");
      racingClient.release();
      client.release();
    }
  });

  it("atomically revalidates delivery identity missed by the migration-89 preflight", async () => {
    const identitySchema = `transfer_proof_identity_revalidation_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    const racingClient = await pool.connect();
    const payloadJson = {
      buyerFirstName: "Buyer",
      ticketCount: 1,
      deadline: "2026-12-03T00:00:00.000Z",
      windowStart: "2026-12-02T00:00:00.000Z",
    };
    const envelope = {
      orderId: "eligible-order-90",
      kind: "BUYER_CONFIRMATION_EMAIL",
      recipient: "buyer@example.test",
      payloadJson,
    };
    const idempotencyKey = "eligible-order-90:2026-12-02T00:00:00.000Z:BUYER_CONFIRMATION_EMAIL:buyer@example.test";
    const subjectMigration = await readFile(join(
      process.cwd(),
      "prisma/migrations/20260914090000_bind_transfer_proof_delivery_subject/migration.sql",
    ), "utf8");
    const identityMigration = await readFile(join(
      process.cwd(),
      "prisma/migrations/20260914093000_bind_transfer_proof_delivery_identity/migration.sql",
    ), "utf8");
    const clockMigration = await readFile(join(
      process.cwd(),
      "prisma/migrations/20260914100000_bind_transfer_proof_delivery_clocks/migration.sql",
    ), "utf8");
    const revalidationMigration = await readFile(join(
      process.cwd(),
      "prisma/migrations/20260914110000_revalidate_transfer_proof_delivery_identity/migration.sql",
    ), "utf8");
    try {
      await client.query(`CREATE SCHEMA "${identitySchema}"`);
      await client.query(`SET search_path TO "${identitySchema}"`);
      await client.query(`
        CREATE TABLE "Order" (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          "buyerConfirmationStatus" TEXT,
          "transferProofType" TEXT,
          "transferProofData" TEXT,
          "transferVerificationStatus" TEXT,
          "disputeWindowEndsAt" TIMESTAMP(3),
          "sellerId" TEXT NOT NULL,
          "buyerSellerId" TEXT NOT NULL
        );
        CREATE TABLE "User" (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          "firstName" TEXT,
          "sellerId" TEXT UNIQUE
        );
        CREATE TABLE "OrderItem" (
          id TEXT PRIMARY KEY,
          "orderId" TEXT NOT NULL
        );
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          "orderId" TEXT NOT NULL,
          kind TEXT NOT NULL,
          recipient TEXT NOT NULL,
          "payloadJson" JSONB NOT NULL,
          "idempotencyKey" TEXT NOT NULL UNIQUE,
          "identityVersion" INTEGER NOT NULL,
          "envelopeDigest" TEXT
        );
        INSERT INTO "Order" (
          id, status, "buyerConfirmationStatus", "transferProofType",
          "transferProofData", "transferVerificationStatus",
          "disputeWindowEndsAt", "sellerId", "buyerSellerId"
        ) VALUES (
          'eligible-order-90', 'PAID', 'PENDING', 'EMAIL', 'legacy-proof',
          'PENDING', TIMESTAMP '2026-12-03 00:00:00', 'seller-90', 'buyer-seller-90'
        );
        INSERT INTO "User" (id, email, "firstName", "sellerId") VALUES
          ('seller-user-90', 'seller@example.test', 'Seller', 'seller-90'),
          ('buyer-90', 'buyer@example.test', 'Buyer', 'buyer-seller-90');
        INSERT INTO "OrderItem" (id, "orderId") VALUES
          ('eligible-ticket-90', 'eligible-order-90');
      `);
      await client.query(subjectMigration);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "idempotencyKey",
          "identityVersion", "envelopeDigest"
        ) VALUES (
          'legacy-v1-identity-90', 'eligible-order-90',
          'BUYER_CONFIRMATION_EMAIL', 'buyer@example.test',
          '{"buyerFirstName":"Buyer","ticketCount":1,"deadline":"2026-12-03T00:00:00.000Z","windowStart":"2020-01-01T00:00:00.000Z"}'::jsonb,
          'legacy-provider-key-90', 1, NULL
        )
      `);

      await racingClient.query(`SET search_path TO "${identitySchema}"`);
      await racingClient.query("BEGIN");
      await racingClient.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "idempotencyKey",
          "identityVersion", "envelopeDigest"
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 2, $7)
      `, [
        "missed-poisoned-identity-89",
        envelope.orderId,
        envelope.kind,
        envelope.recipient,
        JSON.stringify(payloadJson),
        idempotencyKey,
        "0".repeat(64),
      ]);
      let identityMigrationSettled = false;
      const racingIdentityMigration = client.query(identityMigration)
        .finally(() => { identityMigrationSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Migration 89 has no early table lock: it can finish from a snapshot
      // that does not include this already-running permissive INSERT.
      expect(identityMigrationSettled).toBe(true);
      await expect(racingIdentityMigration).resolves.toBeDefined();
      await racingClient.query("COMMIT");

      await expect(client.query(clockMigration)).resolves.toBeDefined();
      await expect(client.query(revalidationMigration)).rejects.toThrow(
        "Transfer-proof delivery identity revalidation failed for row missed-poisoned-identity-89",
      );
      await client.query("ROLLBACK");
      await expect(client.query(`
        SELECT "envelopeDigest"
        FROM "TransferProofDeliveryIntent"
        WHERE id = 'missed-poisoned-identity-89'
      `)).resolves.toMatchObject({ rows: [{ envelopeDigest: "0".repeat(64) }] });

      await client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "envelopeDigest" = $1
        WHERE id = 'missed-poisoned-identity-89'
      `, [envelopeDigest(envelope)]);

      await racingClient.query("BEGIN");
      await racingClient.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "envelopeDigest" = $1
        WHERE id = 'missed-poisoned-identity-89'
      `, ["1".repeat(64)]);
      let revalidationSettled = false;
      const racingRevalidation = client.query(revalidationMigration)
        .finally(() => { revalidationSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(revalidationSettled).toBe(false);
      await racingClient.query("COMMIT");
      await expect(racingRevalidation).rejects.toThrow(
        "Transfer-proof delivery identity revalidation failed for row missed-poisoned-identity-89",
      );
      await client.query("ROLLBACK");

      await client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "envelopeDigest" = $1
        WHERE id = 'missed-poisoned-identity-89'
      `, [envelopeDigest(envelope)]);
      await expect(client.query(revalidationMigration)).resolves.toBeDefined();
      await expect(client.query(`
        SELECT id, "idempotencyKey", "envelopeDigest"
        FROM "TransferProofDeliveryIntent"
        ORDER BY id
      `)).resolves.toMatchObject({ rows: [
        {
          id: "legacy-v1-identity-90",
          idempotencyKey: "legacy-provider-key-90",
          envelopeDigest: null,
        },
        {
          id: "missed-poisoned-identity-89",
          idempotencyKey,
          envelopeDigest: envelopeDigest(envelope),
        },
      ] });
    } finally {
      await racingClient.query("ROLLBACK").catch(() => undefined);
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${identitySchema}" CASCADE`);
      await racingClient.query("SET search_path TO public");
      racingClient.release();
      client.release();
    }
  });

  it("adds nullable notification idempotency without inventing legacy history", async () => {
    const notificationSchema = `notification_idempotency_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    const migration = await readFile(join(
      process.cwd(),
      "prisma/migrations/20260914120000_add_notification_idempotency_key/migration.sql",
    ), "utf8");
    try {
      await client.query(`CREATE SCHEMA "${notificationSchema}"`);
      await client.query(`SET search_path TO "${notificationSchema}"`);
      await client.query(`
        CREATE TABLE "Notification" (
          id TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL,
          type TEXT NOT NULL,
          message TEXT NOT NULL,
          link TEXT
        );
        INSERT INTO "Notification" (id, "userId", type, message, link) VALUES
          ('legacy-notification-1', 'buyer', 'LEGACY', 'first', NULL),
          ('legacy-notification-2', 'buyer', 'LEGACY', 'second', NULL);
      `);

      await expect(client.query(migration)).resolves.toBeDefined();
      await expect(client.query(`
        SELECT id, "idempotencyKey"
        FROM "Notification"
        ORDER BY id
      `)).resolves.toMatchObject({ rows: [
        { id: "legacy-notification-1", idempotencyKey: null },
        { id: "legacy-notification-2", idempotencyKey: null },
      ] });
      await client.query(`
        INSERT INTO "Notification" (id, "userId", type, message, "idempotencyKey") VALUES
          ('keyed-notification', 'buyer', 'CURRENT', 'canonical', 'canonical-key')
      `);
      await expect(client.query(`
        INSERT INTO "Notification" (id, "userId", type, message, "idempotencyKey") VALUES
          ('duplicate-notification', 'buyer', 'CURRENT', 'duplicate', 'canonical-key')
      `)).rejects.toThrow(/unique constraint|duplicate key/i);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${notificationSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs reverse order-snapshot binding as a forward-only upgrade", async () => {
    const snapshotSchema = `transfer_proof_order_snapshot_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    const racingClient = await pool.connect();
    const migration = await readFile(join(
      process.cwd(),
      "prisma/migrations/20260914123000_bind_transfer_proof_order_snapshot/migration.sql",
    ), "utf8");
    try {
      await client.query(`CREATE SCHEMA "${snapshotSchema}"`);
      await client.query(`SET search_path TO "${snapshotSchema}"`);
      await client.query(`
        CREATE TABLE "Order" (
          id TEXT PRIMARY KEY,
          "sellerId" TEXT NOT NULL,
          "buyerSellerId" TEXT NOT NULL,
          "transferProofType" TEXT,
          "disputeWindowEndsAt" TIMESTAMP(3)
        );
        CREATE TABLE "User" (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          "firstName" TEXT,
          "sellerId" TEXT UNIQUE
        );
        CREATE TABLE "OrderItem" (
          id TEXT PRIMARY KEY,
          "orderId" TEXT NOT NULL
        );
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          "orderId" TEXT NOT NULL,
          kind TEXT NOT NULL,
          recipient TEXT NOT NULL,
          "payloadJson" JSONB NOT NULL,
          "identityVersion" INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING'
        );

        INSERT INTO "Order" (
          id, "sellerId", "buyerSellerId", "transferProofType", "disputeWindowEndsAt"
        ) VALUES
          ('snapshot-v2-order', 'snapshot-seller', 'snapshot-buyer', 'EMAIL',
            TIMESTAMP '2026-12-03 00:00:00'),
          ('snapshot-v1-order', 'snapshot-seller', 'snapshot-buyer', 'LEGACY',
            TIMESTAMP '2020-01-01 00:00:00'),
          ('snapshot-route-order', 'snapshot-seller', 'snapshot-buyer', NULL, NULL);
        INSERT INTO "User" (id, email, "firstName", "sellerId") VALUES
          ('snapshot-seller-user', 'seller@example.test', 'Seller', 'snapshot-seller'),
          ('snapshot-buyer-user', 'buyer@example.test', 'Buyer', 'snapshot-buyer');
        INSERT INTO "OrderItem" (id, "orderId") VALUES
          ('snapshot-v2-item', 'snapshot-v2-order'),
          ('snapshot-v1-item', 'snapshot-v1-order'),
          ('snapshot-route-item', 'snapshot-route-order');
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "identityVersion"
        ) VALUES
          ('snapshot-v2-intent', 'snapshot-v2-order', 'ADMIN_TRANSFER_ACTIVITY_EMAIL',
            'admin@truefantix.com',
            '{"sellerEmail":"seller@example.test","buyerEmail":"buyer@example.test","ticketCount":1,"transferProofType":"EMAIL","deadline":"2026-12-03T00:00:00.000Z","completedAt":"2026-12-02T00:00:00.000Z"}'::jsonb,
            2),
          ('snapshot-v2-z-buyer', 'snapshot-v2-order', 'BUYER_CONFIRMATION_EMAIL',
            'buyer@example.test',
            '{"buyerFirstName":"Buyer","ticketCount":1,"deadline":"2026-12-03T00:00:00.000Z","windowStart":"2026-12-02T00:00:00.000Z"}'::jsonb,
            2),
          ('snapshot-v1-intent', 'snapshot-v1-order', 'ADMIN_TRANSFER_ACTIVITY_EMAIL',
            'legacy-admin@example.test', '{}'::jsonb, 1);
      `);

      await client.query(`
        UPDATE "Order"
        SET "disputeWindowEndsAt" = TIMESTAMP '2026-12-03 01:00:00'
        WHERE id = 'snapshot-v2-order'
      `);
      await expect(client.query(migration)).rejects.toThrow(
        "Transfer-proof order snapshot preflight failed for row snapshot-v2-intent",
      );
      await client.query("ROLLBACK");
      await expect(client.query(`
        SELECT to_regprocedure('protect_transfer_proof_order_snapshot()') AS helper
      `)).resolves.toMatchObject({ rows: [{ helper: null }] });

      await client.query(`
        UPDATE "Order"
        SET "disputeWindowEndsAt" = TIMESTAMP '2026-12-03 00:00:00'
        WHERE id = 'snapshot-v2-order'
      `);

      await racingClient.query(`SET search_path TO "${snapshotSchema}"`);
      await racingClient.query("BEGIN");
      await racingClient.query(`
        UPDATE "User" SET email = 'racing-buyer@example.test'
        WHERE id = 'snapshot-buyer-user'
      `);
      let participantMigrationSettled = false;
      const participantMigration = client.query(migration)
        .finally(() => { participantMigrationSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(participantMigrationSettled).toBe(false);
      await racingClient.query("COMMIT");
      await expect(participantMigration).rejects.toThrow(
        "Transfer-proof order snapshot preflight failed for row snapshot-v2-intent",
      );
      await client.query("ROLLBACK");
      await racingClient.query(`
        UPDATE "User" SET email = 'buyer@example.test'
        WHERE id = 'snapshot-buyer-user'
      `);

      // Reproduce the application ordering: own/update Order first, then stage
      // the intent while the migration is waiting on its parent-table lock.
      // The route transaction must be able to complete without becoming the
      // other half of a table/row lock cycle.
      await racingClient.query("BEGIN");
      await racingClient.query(`
        UPDATE "Order"
        SET "transferProofType" = 'EMAIL',
          "disputeWindowEndsAt" = TIMESTAMP '2026-12-04 00:00:00'
        WHERE id = 'snapshot-route-order'
      `);
      let migrationSettled = false;
      const racingMigration = client.query(migration)
        .finally(() => { migrationSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(migrationSettled).toBe(false);
      await racingClient.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "identityVersion", status
        ) VALUES (
          'snapshot-route-intent', 'snapshot-route-order', 'ADMIN_TRANSFER_ACTIVITY_EMAIL',
          'admin@truefantix.com',
          '{"sellerEmail":"seller@example.test","buyerEmail":"buyer@example.test","ticketCount":1,"transferProofType":"EMAIL","deadline":"2026-12-04T00:00:00.000Z","completedAt":"2026-12-03T00:00:00.000Z"}'::jsonb,
          2, 'PENDING'
        )
      `);
      await racingClient.query("COMMIT");
      await expect(racingMigration).resolves.toBeDefined();

      await expect(client.query(`
        UPDATE "Order" SET "transferProofType" = 'OTHER'
        WHERE id = 'snapshot-v2-order'
      `)).rejects.toThrow("Transfer-proof delivery order snapshot is immutable");
      await expect(client.query(`
        INSERT INTO "OrderItem" (id, "orderId")
        VALUES ('snapshot-v2-extra', 'snapshot-v2-order')
      `)).rejects.toThrow("Transfer-proof delivery order item membership is immutable");
      await expect(client.query(`
        UPDATE "User" SET email = 'changed-seller@example.test'
        WHERE id = 'snapshot-seller-user'
      `)).rejects.toThrow("Active transfer-proof delivery participant email is immutable");
      await expect(client.query(`
        UPDATE "User" SET "firstName" = 'Changed Buyer'
        WHERE id = 'snapshot-buyer-user'
      `)).rejects.toThrow("Active transfer-proof delivery buyer name is immutable");

      await expect(client.query(`
        UPDATE "Order" SET "transferProofType" = 'LEGACY-CHANGED'
        WHERE id = 'snapshot-v1-order'
      `)).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query(`
        INSERT INTO "OrderItem" (id, "orderId")
        VALUES ('snapshot-v1-extra', 'snapshot-v1-order')
      `)).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query(`
        SELECT "transferProofType" FROM "Order" WHERE id = 'snapshot-v1-order'
      `)).resolves.toMatchObject({ rows: [{ transferProofType: "LEGACY-CHANGED" }] });
    } finally {
      await racingClient.query("ROLLBACK").catch(() => undefined);
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${snapshotSchema}" CASCADE`);
      await racingClient.query("SET search_path TO public");
      racingClient.release();
      client.release();
    }
  });

  it("installs processing-evidence binding as a forward-only upgrade", async () => {
    const processingSchema = `transfer_proof_processing_evidence_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${processingSchema}"`);
      await client.query(`SET search_path TO "${processingSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "availableAt" TIMESTAMP(3) NOT NULL,
          "lastError" TEXT
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "processingAt", "leaseExpiresAt",
          "claimToken", "dispatchStartedAt", "availableAt"
        ) VALUES
          ('permissive-72', 'SENDGRID', 'PROCESSING', 1,
            TIMESTAMP '2026-12-01 04:00:00', TIMESTAMP '2026-12-01 04:15:00',
            'permissive-owner', TIMESTAMP '2026-12-01 04:00:00', TIMESTAMP '2026-12-01 04:00:00'),
          ('strict-73', 'SENDGRID', 'PROCESSING', 1,
            TIMESTAMP '2026-12-01 05:00:00', TIMESTAMP '2026-12-01 05:15:00',
            'strict-owner', TIMESTAMP '2026-12-01 05:00:00', TIMESTAMP '2026-12-01 05:00:00'),
          ('resend-73', 'RESEND', 'PROCESSING', 1,
            TIMESTAMP '2026-12-01 06:00:00', TIMESTAMP '2026-12-01 06:15:00',
            'resend-owner', TIMESTAMP '2026-12-01 06:00:00', TIMESTAMP '2026-12-01 06:00:00')
      `);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "leaseExpiresAt" = "processingAt",
          "availableAt" = "processingAt" + INTERVAL '5 minutes',
          "lastError" = 'permissive recovery'
        WHERE id = 'permissive-72'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const processingEvidenceMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914013000_bind_transfer_proof_processing_evidence/migration.sql",
      ), "utf8");
      await client.query(processingEvidenceMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "leaseExpiresAt" = "processingAt",
          "availableAt" = "processingAt" + INTERVAL '5 minutes',
          "lastError" = 'forged SendGrid recovery'
        WHERE id = 'strict-73'
      `)).rejects.toThrow(
        "Transfer-proof delivery recovery requires replay-safe Resend evidence",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "leaseExpiresAt" = "processingAt",
          "availableAt" = "processingAt" + INTERVAL '5 minutes',
          "lastError" = 'valid Resend recovery'
        WHERE id = 'resend-73'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${processingSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs immutable pending availability as a forward-only upgrade", async () => {
    const pendingSchema = `transfer_proof_pending_freeze_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${pendingSchema}"`);
      await client.query(`SET search_path TO "${pendingSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          "availableAt" TIMESTAMP(3) NOT NULL
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (id, status, "availableAt")
        VALUES
          ('permissive-71', 'PENDING', TIMESTAMP '2026-12-01 03:00:00'),
          ('strict-72', 'PENDING', TIMESTAMP '2026-12-01 03:00:00')
      `);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "availableAt" = TIMESTAMP '2026-12-01 02:00:00'
        WHERE id = 'permissive-71'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const pendingFreezeMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914010000_freeze_transfer_proof_pending_schedule/migration.sql",
      ), "utf8");
      await client.query(pendingFreezeMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "availableAt" = TIMESTAMP '2026-12-01 02:00:00'
        WHERE id = 'strict-72'
      `)).rejects.toThrow(
        "Pending transfer-proof delivery availability is immutable until claim",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING'
        WHERE id = 'strict-72'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${pendingSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs immutable retryable failure evidence as a forward-only upgrade", async () => {
    const failureSchema = `transfer_proof_failure_freeze_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${failureSchema}"`);
      await client.query(`SET search_path TO "${failureSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3),
          "lastError" TEXT,
          "availableAt" TIMESTAMP(3) NOT NULL
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "firstAttemptAt", "lastError", "availableAt"
        ) VALUES
          ('permissive-70', 'RESEND', 'FAILED', 1,
            TIMESTAMP '2026-12-01 01:00:00', 'original rejection',
            TIMESTAMP '2026-12-01 03:00:00'),
          ('strict-71', 'RESEND', 'FAILED', 1,
            TIMESTAMP '2026-12-01 01:00:00', 'original rejection',
            TIMESTAMP '2026-12-01 03:00:00')
      `);

      for (const migration of [
        "20260913200000_enforce_transfer_proof_delivery_transitions",
        "20260913203000_pin_transfer_proof_provider_on_dispatch",
        "20260913210000_bind_first_transfer_proof_attempt_timestamp",
        "20260913213000_fence_transfer_proof_claim_reassignment",
        "20260913220000_fence_transfer_proof_replay_handoffs",
        "20260913223000_freeze_transfer_proof_attempt_identity",
        "20260913230000_require_transfer_proof_claim_before_dispatch",
        "20260913233000_require_transfer_proof_dispatch_before_delivery",
        "20260914000000_require_transfer_proof_dispatch_before_failure",
      ]) {
        const sql = await readFile(join(
          process.cwd(), `prisma/migrations/${migration}/migration.sql`,
        ), "utf8");
        await client.query(sql);
      }

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "lastError" = 'rewritten rejection',
          "availableAt" = TIMESTAMP '2026-12-01 02:00:00'
        WHERE id = 'permissive-70'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const failureFreezeMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914003000_freeze_transfer_proof_failure_evidence/migration.sql",
      ), "utf8");
      await client.query(failureFreezeMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "lastError" = 'rewritten rejection',
          "availableAt" = TIMESTAMP '2026-12-01 02:00:00'
        WHERE id = 'strict-71'
      `)).rejects.toThrow(
        "Failed transfer-proof delivery evidence is immutable until retry or reconciliation",
      );
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING', "processingAt" = "availableAt",
          "leaseExpiresAt" = "availableAt" + INTERVAL '15 minutes',
          "claimToken" = 'strict-71-retry', "lastError" = NULL
        WHERE id = 'strict-71'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${failureSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs dispatch-bound failure evidence as a forward-only upgrade", async () => {
    const failureSchema = `transfer_proof_failure_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${failureSchema}"`);
      await client.query(`SET search_path TO "${failureSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3),
          "lastError" TEXT,
          "availableAt" TIMESTAMP(3) NOT NULL
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "firstAttemptAt", "processingAt",
          "leaseExpiresAt", "claimToken", "availableAt"
        ) VALUES
          ('permissive-69', 'RESEND', 'PROCESSING', 1,
            TIMESTAMP '2026-12-01 01:00:00', TIMESTAMP '2026-12-01 03:00:00',
            TIMESTAMP '2026-12-01 03:15:00', 'permissive-owner',
            TIMESTAMP '2026-12-01 03:00:00'),
          ('strict-70', 'RESEND', 'PROCESSING', 1,
            TIMESTAMP '2026-12-01 01:00:00', TIMESTAMP '2026-12-01 03:00:00',
            TIMESTAMP '2026-12-01 03:15:00', 'strict-owner',
            TIMESTAMP '2026-12-01 03:00:00')
      `);

      for (const migration of [
        "20260913200000_enforce_transfer_proof_delivery_transitions",
        "20260913203000_pin_transfer_proof_provider_on_dispatch",
        "20260913210000_bind_first_transfer_proof_attempt_timestamp",
        "20260913213000_fence_transfer_proof_claim_reassignment",
        "20260913220000_fence_transfer_proof_replay_handoffs",
        "20260913223000_freeze_transfer_proof_attempt_identity",
        "20260913230000_require_transfer_proof_claim_before_dispatch",
        "20260913233000_require_transfer_proof_dispatch_before_delivery",
      ]) {
        const sql = await readFile(join(
          process.cwd(), `prisma/migrations/${migration}/migration.sql`,
        ), "utf8");
        await client.query(sql);
      }

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'FAILED', "processingAt" = NULL,
          "leaseExpiresAt" = NULL, "claimToken" = NULL,
          "lastError" = 'synthetic undispatched rejection',
          "availableAt" = TIMESTAMP '2026-12-01 03:05:00'
        WHERE id = 'permissive-69'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const failureMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914000000_require_transfer_proof_dispatch_before_failure/migration.sql",
      ), "utf8");
      await client.query(failureMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'FAILED', "processingAt" = NULL,
          "leaseExpiresAt" = NULL, "claimToken" = NULL,
          "lastError" = 'synthetic undispatched rejection',
          "availableAt" = TIMESTAMP '2026-12-01 03:05:00'
        WHERE id = 'strict-70'
      `)).rejects.toThrow("Transfer-proof delivery failure requires its owned dispatch boundary");

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "attemptCount" = 2, "dispatchStartedAt" = "processingAt"
        WHERE id = 'strict-70'
      `)).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'FAILED', "processingAt" = NULL,
          "leaseExpiresAt" = NULL, "claimToken" = NULL,
          "dispatchStartedAt" = NULL,
          "lastError" = 'synthetic rejected delivery',
          "availableAt" = TIMESTAMP '2026-12-01 03:05:00'
        WHERE id = 'strict-70'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${failureSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs dispatch-bound completion as a forward-only upgrade", async () => {
    const completionSchema = `transfer_proof_completion_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${completionSchema}"`);
      await client.query(`SET search_path TO "${completionSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3),
          "lastError" TEXT,
          "availableAt" TIMESTAMP(3) NOT NULL
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "firstAttemptAt", "processingAt",
          "leaseExpiresAt", "claimToken", "availableAt"
        ) VALUES
          ('permissive-68', 'RESEND', 'PROCESSING', 1,
            TIMESTAMP '2026-12-01 01:00:00', TIMESTAMP '2026-12-01 03:00:00',
            TIMESTAMP '2026-12-01 03:15:00', 'permissive-owner',
            TIMESTAMP '2026-12-01 03:00:00'),
          ('strict-69', 'RESEND', 'PROCESSING', 1,
            TIMESTAMP '2026-12-01 01:00:00', TIMESTAMP '2026-12-01 03:00:00',
            TIMESTAMP '2026-12-01 03:15:00', 'strict-owner',
            TIMESTAMP '2026-12-01 03:00:00')
      `);

      for (const migration of [
        "20260913200000_enforce_transfer_proof_delivery_transitions",
        "20260913203000_pin_transfer_proof_provider_on_dispatch",
        "20260913210000_bind_first_transfer_proof_attempt_timestamp",
        "20260913213000_fence_transfer_proof_claim_reassignment",
        "20260913220000_fence_transfer_proof_replay_handoffs",
        "20260913223000_freeze_transfer_proof_attempt_identity",
        "20260913230000_require_transfer_proof_claim_before_dispatch",
      ]) {
        const sql = await readFile(join(
          process.cwd(), `prisma/migrations/${migration}/migration.sql`,
        ), "utf8");
        await client.query(sql);
      }

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'DELIVERED', "processingAt" = NULL,
          "leaseExpiresAt" = NULL, "claimToken" = NULL,
          "deliveredAt" = TIMESTAMP '2026-12-01 03:05:00'
        WHERE id = 'permissive-68'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const completionMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260913233000_require_transfer_proof_dispatch_before_delivery/migration.sql",
      ), "utf8");
      await client.query(completionMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'DELIVERED', "processingAt" = NULL,
          "leaseExpiresAt" = NULL, "claimToken" = NULL,
          "deliveredAt" = TIMESTAMP '2026-12-01 03:05:00'
        WHERE id = 'strict-69'
      `)).rejects.toThrow("Transfer-proof delivery completion requires its owned dispatch boundary");

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "attemptCount" = 2, "dispatchStartedAt" = "processingAt"
        WHERE id = 'strict-69'
      `)).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'DELIVERED', "processingAt" = NULL,
          "leaseExpiresAt" = NULL, "claimToken" = NULL,
          "dispatchStartedAt" = NULL,
          "deliveredAt" = TIMESTAMP '2026-12-01 03:05:00'
        WHERE id = 'strict-69'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${completionSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs pre-dispatch claim acquisition as a forward-only upgrade", async () => {
    const claimSchema = `transfer_proof_retry_claim_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${claimSchema}"`);
      await client.query(`SET search_path TO "${claimSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3),
          "lastError" TEXT,
          "availableAt" TIMESTAMP(3) NOT NULL
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "firstAttemptAt", "lastError", "availableAt"
        ) VALUES
          ('permissive-67', 'RESEND', 'FAILED', 1,
            TIMESTAMP '2026-12-01 01:00:00', 'retryable rejection',
            TIMESTAMP '2026-12-01 03:00:00'),
          ('strict-68', 'RESEND', 'FAILED', 1,
            TIMESTAMP '2026-12-01 01:00:00', 'retryable rejection',
            TIMESTAMP '2026-12-01 03:00:00')
      `);

      for (const migration of [
        "20260913200000_enforce_transfer_proof_delivery_transitions",
        "20260913203000_pin_transfer_proof_provider_on_dispatch",
        "20260913210000_bind_first_transfer_proof_attempt_timestamp",
        "20260913213000_fence_transfer_proof_claim_reassignment",
        "20260913220000_fence_transfer_proof_replay_handoffs",
        "20260913223000_freeze_transfer_proof_attempt_identity",
      ]) {
        const sql = await readFile(join(
          process.cwd(), `prisma/migrations/${migration}/migration.sql`,
        ), "utf8");
        await client.query(sql);
      }

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING', "processingAt" = "availableAt",
          "leaseExpiresAt" = "availableAt" + INTERVAL '15 minutes',
          "claimToken" = 'combined-pre-68', "dispatchStartedAt" = "availableAt",
          "lastError" = NULL
        WHERE id = 'permissive-67'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const claimMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260913230000_require_transfer_proof_claim_before_dispatch/migration.sql",
      ), "utf8");
      await client.query(claimMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING', "processingAt" = "availableAt",
          "leaseExpiresAt" = "availableAt" + INTERVAL '15 minutes',
          "claimToken" = 'combined-post-68', "dispatchStartedAt" = "availableAt",
          "lastError" = NULL
        WHERE id = 'strict-68'
      `)).rejects.toThrow("Transfer-proof delivery claim must be due and pre-dispatch");

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING', "processingAt" = "availableAt",
          "leaseExpiresAt" = "availableAt" + INTERVAL '15 minutes',
          "claimToken" = 'valid-post-68', "lastError" = NULL
        WHERE id = 'strict-68'
      `)).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "attemptCount" = 2, "dispatchStartedAt" = "processingAt"
        WHERE id = 'strict-68'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${claimSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs exact first-attempt evidence as a forward-only upgrade after provider pinning", async () => {
    const transitionSchema = `transfer_proof_first_attempt_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${transitionSchema}"`);
      await client.query(`SET search_path TO "${transitionSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3),
          "lastError" TEXT,
          "availableAt" TIMESTAMP(3) NOT NULL
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "processingAt", "leaseExpiresAt",
          "claimToken", "availableAt"
        ) VALUES
          ('permissive-63', 'RESEND', 'PROCESSING', 0, NOW(),
            NOW() + INTERVAL '15 minutes', 'pre-64-claim', NOW()),
          ('strict-64', 'RESEND', 'PROCESSING', 0, NOW(),
            NOW() + INTERVAL '15 minutes', 'post-64-claim', NOW())
      `);

      const transitionMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260913200000_enforce_transfer_proof_delivery_transitions/migration.sql",
      ), "utf8");
      await client.query(transitionMigration);
      const providerPinMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260913203000_pin_transfer_proof_provider_on_dispatch/migration.sql",
      ), "utf8");
      await client.query(providerPinMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "attemptCount" = 1, "firstAttemptAt" = "processingAt",
          "dispatchStartedAt" = "processingAt" + INTERVAL '1 second'
        WHERE id = 'permissive-63'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const firstAttemptMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260913210000_bind_first_transfer_proof_attempt_timestamp/migration.sql",
      ), "utf8");
      await client.query(firstAttemptMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "attemptCount" = 1, "firstAttemptAt" = "processingAt",
          "dispatchStartedAt" = "processingAt" + INTERVAL '1 second'
        WHERE id = 'strict-64'
      `)).rejects.toThrow("Transfer-proof delivery attempt increment requires its owned dispatch boundary");
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "attemptCount" = 1,
          "firstAttemptAt" = "processingAt" + INTERVAL '1 second',
          "dispatchStartedAt" = "processingAt" + INTERVAL '1 second'
        WHERE id = 'strict-64'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${transitionSchema}" CASCADE`);
      client.release();
    }
  });

  it("installs active claim fencing as a forward-only upgrade after first-attempt binding", async () => {
    const transitionSchema = `transfer_proof_claim_fencing_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${transitionSchema}"`);
      await client.query(`SET search_path TO "${transitionSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL,
          "attemptCount" INTEGER NOT NULL,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3),
          "lastError" TEXT,
          "availableAt" TIMESTAMP(3) NOT NULL
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "firstAttemptAt", "processingAt",
          "leaseExpiresAt", "claimToken", "dispatchStartedAt", "availableAt"
        ) VALUES
          ('permissive-64', 'RESEND', 'PROCESSING', 1, NOW(), NOW(),
            NOW() + INTERVAL '15 minutes', 'pre-65-owner', NOW(), NOW()),
          ('strict-65', 'RESEND', 'PROCESSING', 1, NOW(), NOW(),
            NOW() + INTERVAL '15 minutes', 'post-65-owner', NOW(), NOW())
      `);

      for (const migration of [
        "20260913200000_enforce_transfer_proof_delivery_transitions",
        "20260913203000_pin_transfer_proof_provider_on_dispatch",
        "20260913210000_bind_first_transfer_proof_attempt_timestamp",
      ]) {
        const sql = await readFile(join(
          process.cwd(), `prisma/migrations/${migration}/migration.sql`,
        ), "utf8");
        await client.query(sql);
      }

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "dispatchStartedAt" = NULL
        WHERE id = 'permissive-64'
      `)).resolves.toMatchObject({ rowCount: 1 });

      const claimFencingMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260913213000_fence_transfer_proof_claim_reassignment/migration.sql",
      ), "utf8");
      await client.query(claimFencingMigration);

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "dispatchStartedAt" = NULL
        WHERE id = 'strict-65'
      `)).rejects.toThrow("Transfer-proof delivery active claim evidence requires an expired-lease handoff");
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET "processingAt" = "leaseExpiresAt",
          "leaseExpiresAt" = "leaseExpiresAt" + INTERVAL '15 minutes',
          "claimToken" = 'post-65-successor', "dispatchStartedAt" = NULL
        WHERE id = 'strict-65'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${transitionSchema}" CASCADE`);
      client.release();
    }
  });

  it("quarantines ambiguous legacy lifecycle rows without inferring delivery", async () => {
    const lifecycleSchema = `transfer_proof_lifecycle_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${lifecycleSchema}"`);
      await client.query(`SET search_path TO "${lifecycleSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          provider TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING',
          "attemptCount" INTEGER NOT NULL DEFAULT 0,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "deliveredAt" TIMESTAMP(3),
          "lastError" TEXT
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (id)
        VALUES ('coherent-pending')
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "firstAttemptAt", "processingAt",
          "leaseExpiresAt", "dispatchStartedAt", "deliveredAt", "lastError"
        ) VALUES (
          'ambiguous-processing', 'SENDGRID', 'PROCESSING', 1, NOW(), NOW(),
          NOW() + INTERVAL '15 minutes', NOW(), NOW(), 'legacy warning'
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, status, "attemptCount", "firstAttemptAt", "lastError"
        ) VALUES ('ambiguous-failed-no-provider', 'FAILED', 1, NOW(), 'provider missing')
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, provider, status, "attemptCount", "firstAttemptAt", "deliveredAt"
        ) VALUES ('coherent-delivered', 'RESEND', 'DELIVERED', 1, NOW(), NOW())
      `);

      const migration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260913190500_enforce_transfer_proof_delivery_lifecycle/migration.sql",
      ), "utf8");
      await client.query(migration);

      await expect(client.query(`
        SELECT id, status, "claimToken", "processingAt", "leaseExpiresAt",
          "dispatchStartedAt", "deliveredAt", "lastError"
        FROM "TransferProofDeliveryIntent" ORDER BY id
      `)).resolves.toMatchObject({ rows: [
        {
          id: "ambiguous-failed-no-provider", status: "RECONCILIATION_REQUIRED", claimToken: null,
          processingAt: null, leaseExpiresAt: null, dispatchStartedAt: null,
          deliveredAt: null,
          lastError: "Lifecycle migration quarantined incoherent legacy row from status FAILED: provider missing",
        },
        {
          id: "ambiguous-processing", status: "RECONCILIATION_REQUIRED", claimToken: null,
          processingAt: null, leaseExpiresAt: null, dispatchStartedAt: null,
          deliveredAt: expect.any(Date),
          lastError: "Lifecycle migration quarantined incoherent legacy row from status PROCESSING: legacy warning",
        },
        {
          id: "coherent-delivered", status: "DELIVERED", claimToken: null,
          processingAt: null, leaseExpiresAt: null, dispatchStartedAt: null,
          deliveredAt: expect.any(Date), lastError: null,
        },
        {
          id: "coherent-pending", status: "PENDING", claimToken: null,
          processingAt: null, leaseExpiresAt: null, dispatchStartedAt: null,
          deliveredAt: null, lastError: null,
        },
      ] });

      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'DELIVERED'
        WHERE id = 'coherent-pending'
      `)).rejects.toThrow("Invalid transfer-proof delivery lifecycle state");
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'FAILED', "attemptCount" = 1, "firstAttemptAt" = NOW(),
          "lastError" = 'provider missing'
        WHERE id = 'coherent-pending'
      `)).rejects.toThrow("Invalid transfer-proof delivery lifecycle state");
      await expect(client.query(`
        UPDATE "TransferProofDeliveryIntent"
        SET status = 'PROCESSING', provider = 'RESEND', "processingAt" = NOW(),
          "leaseExpiresAt" = NOW() + INTERVAL '15 minutes', "claimToken" = 'owned-claim'
        WHERE id = 'coherent-pending'
      `)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${lifecycleSchema}" CASCADE`);
      client.release();
    }
  });

  it("quarantines an initially inconsistent full-envelope identity", async () => {
    // Migration 89 rejects this shape for current writers; retain a direct
    // legacy injection seam to prove the drainer also quarantines restored
    // inconsistent history before provider access.
    await forceCreateDeliveryIntents([{
      orderId,
      kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL",
      recipient: "admin@truefantix.com",
      payloadJson: {
        sellerEmail: "seller@example.test", buyerEmail,
        ticketCount: 1, transferProofType: "EMAIL",
        deadline: params("22").deadline.toISOString(),
        completedAt: "2026-12-01T22:00:00.000Z",
      },
      idempotencyKey: `${orderId}:2026-12-01T18:00:00.000Z:ADMIN_TRANSFER_ACTIVITY_EMAIL:admin@truefantix.com`,
      identityVersion: 2,
      envelopeDigest: "0".repeat(64),
      availableAt: new Date("2026-12-01T22:00:00.000Z"),
    }]);

    await expect(drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T22:00:00.000Z") }, prisma,
    )).resolves.toMatchObject({ claimed: 1, delivered: 0, failed: 1, reconciliationRequired: 1 });

    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({
        status: "RECONCILIATION_REQUIRED",
        attemptCount: 0,
        lastError: "Pre-dispatch delivery failure: Transfer-proof delivery full-envelope identity does not match its payload",
      });
  });

  it("preserves legacy provider keys for unattempted and ambiguous Resend upgrade rows", async () => {
    const buyerKey = `${orderId}:2026-12-01T18:00:00.000Z:BUYER_CONFIRMATION_EMAIL:${buyerEmail}`;
    const adminKey = `${orderId}:2026-12-01T18:00:00.000Z:ADMIN_TRANSFER_ACTIVITY_EMAIL:admin@truefantix.com`;
    const upgradeSchema = `transfer_proof_upgrade_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${upgradeSchema}"`);
      await client.query(`SET search_path TO "${upgradeSchema}"`);
      await client.query(`
        CREATE TABLE "TransferProofDeliveryIntent" (
          id TEXT PRIMARY KEY,
          "orderId" TEXT NOT NULL,
          kind TEXT NOT NULL,
          recipient TEXT NOT NULL,
          "payloadJson" JSONB NOT NULL,
          "idempotencyKey" TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'PENDING',
          provider TEXT,
          "attemptCount" INTEGER NOT NULL DEFAULT 0,
          "firstAttemptAt" TIMESTAMP(3),
          "processingAt" TIMESTAMP(3),
          "leaseExpiresAt" TIMESTAMP(3),
          "claimToken" TEXT,
          "dispatchStartedAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "idempotencyKey"
        ) VALUES ('legacy-pending', $1, 'BUYER_CONFIRMATION_EMAIL', $2, '{}'::jsonb, $3)
      `, [orderId, buyerEmail, buyerKey]);
      await client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "idempotencyKey", status,
          provider, "attemptCount", "firstAttemptAt", "processingAt", "leaseExpiresAt",
          "claimToken", "dispatchStartedAt"
        ) VALUES (
          'legacy-processing', $1, 'ADMIN_TRANSFER_ACTIVITY_EMAIL', 'admin@truefantix.com',
          '{}'::jsonb, $2, 'PROCESSING', 'RESEND', 1, NOW(), NOW(), NOW(),
          'legacy-upgrade-claim', NOW()
        )
      `, [orderId, adminKey]);

      const migration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260913184000_protect_transfer_proof_delivery_envelopes/migration.sql",
      ), "utf8");
      await client.query(migration);

      await expect(client.query(`
        SELECT id, "idempotencyKey", "identityVersion", "envelopeDigest"
        FROM "TransferProofDeliveryIntent" ORDER BY id
      `)).resolves.toMatchObject({ rows: [
        { id: "legacy-pending", idempotencyKey: buyerKey, identityVersion: 1, envelopeDigest: null },
        { id: "legacy-processing", idempotencyKey: adminKey, identityVersion: 1, envelopeDigest: null },
      ] });

      await expect(client.query(`
        INSERT INTO "TransferProofDeliveryIntent" (
          id, "orderId", kind, recipient, "payloadJson", "idempotencyKey",
          "identityVersion", "envelopeDigest"
        ) VALUES (
          'post-migration-v1', $1, 'BUYER_CONFIRMATION_EMAIL', $2, '{}'::jsonb,
          'post-migration-v1-key', 1, NULL
        )
      `, [orderId, buyerEmail])).rejects.toThrow(
        "New transfer-proof delivery intents require current envelope identity",
      );
    } finally {
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${upgradeSchema}" CASCADE`);
      client.release();
    }

    // Drain exact upgraded row shapes in the application schema. Trigger bypass
    // is limited to setup because the real migration path was exercised above.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.transferProofDeliveryIntent.createMany({ data: [
        {
          orderId,
          kind: "BUYER_CONFIRMATION_EMAIL",
          recipient: buyerEmail,
          payloadJson: {
            buyerFirstName: "Buyer", ticketCount: 1,
            deadline: "2026-12-02T23:00:00.000Z", windowStart: "2026-12-01T18:00:00.000Z",
          },
          idempotencyKey: buyerKey,
          identityVersion: 1,
          availableAt: new Date("2026-12-01T23:00:00.000Z"),
        },
        {
          orderId,
          kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL",
          recipient: "admin@truefantix.com",
          payloadJson: {
            sellerEmail: "seller@example.test", buyerEmail,
            ticketCount: 1, transferProofType: "EMAIL",
            deadline: "2026-12-02T23:00:00.000Z", completedAt: "2026-12-01T23:00:00.000Z",
          },
          idempotencyKey: adminKey,
          identityVersion: 1,
          status: "PROCESSING",
          provider: "RESEND",
          attemptCount: 1,
          firstAttemptAt: new Date("2026-12-01T23:00:00.000Z"),
          processingAt: new Date("2026-12-01T23:00:00.000Z"),
          leaseExpiresAt: new Date("2026-12-01T23:15:00.000Z"),
          claimToken: "legacy-upgrade-claim",
          dispatchStartedAt: new Date("2026-12-01T23:00:00.000Z"),
        },
      ] });
    });

    await expect(drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T23:16:00.000Z") }, prisma,
    )).resolves.toMatchObject({ claimed: 2, delivered: 2, failed: 0, reconciliationRequired: 0 });

    const expectedProviderKey = (durableKey: string) =>
      `tft-transfer-proof-${createHash("sha256").update(durableKey).digest("hex")}`;
    expect(mockedSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expectedProviderKey(buyerKey),
      provider: "RESEND",
    }));
    expect(mockedSendAdmin).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expectedProviderKey(adminKey),
      provider: "RESEND",
    }));
    await expect(prisma.transferProofDeliveryIntent.findMany({
      where: { orderId }, orderBy: { kind: "asc" },
      select: { identityVersion: true, envelopeDigest: true, status: true },
    })).resolves.toEqual([
      { identityVersion: 1, envelopeDigest: null, status: "DELIVERED" },
      { identityVersion: 1, envelopeDigest: null, status: "DELIVERED" },
    ]);
  });

  it("rejects new legacy-identity rows after the upgrade", async () => {
    await expect(prisma.transferProofDeliveryIntent.create({ data: {
      orderId,
      kind: "BUYER_CONFIRMATION_EMAIL",
      recipient: buyerEmail,
      payloadJson: {
        buyerFirstName: "Buyer", ticketCount: 1,
        deadline: "2026-12-03T00:00:00.000Z", windowStart: "2026-12-02T00:00:00.000Z",
      },
      idempotencyKey: `${orderId}:2026-12-02T00:00:00.000Z:BUYER_CONFIRMATION_EMAIL:${buyerEmail}`,
      identityVersion: 1,
    } })).rejects.toThrow("New transfer-proof delivery intents require current envelope identity");
  });

  function transactionWithIntentUpdateFilter<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    blocked: (args: Prisma.TransferProofDeliveryIntentUpdateManyArgs) => boolean,
  ) {
    return prisma.$transaction((tx) => fn(new Proxy(tx, {
      get(target, property, receiver) {
        if (property !== "transferProofDeliveryIntent") return Reflect.get(target, property, receiver);
        return new Proxy(target.transferProofDeliveryIntent, {
          get(delegate, delegateProperty, delegateReceiver) {
            if (delegateProperty !== "updateMany") return Reflect.get(delegate, delegateProperty, delegateReceiver);
            return (args: Prisma.TransferProofDeliveryIntentUpdateManyArgs) => blocked(args)
              ? Promise.resolve({ count: 0 })
              : delegate.updateMany(args);
          },
        });
      },
    }) as Prisma.TransactionClient));
  }

  function completionLosingDb(providerAccepted: () => boolean) {
    const blocksAcceptedTransition = (args: Prisma.TransferProofDeliveryIntentUpdateManyArgs) => {
      const status = typeof args.data.status === "string" ? args.data.status : undefined;
      return Boolean(providerAccepted() && status && status !== "PROCESSING");
    };
    return {
      $transaction: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => transactionWithIntentUpdateFilter(
        fn, blocksAcceptedTransition,
      ),
      transferProofDeliveryIntent: {
        findMany: (args: Prisma.TransferProofDeliveryIntentFindManyArgs) => prisma.transferProofDeliveryIntent.findMany(args),
        updateMany: (args: Prisma.TransferProofDeliveryIntentUpdateManyArgs) => {
          const status = typeof args.data.status === "string" ? args.data.status : undefined;
          if (providerAccepted() && status && status !== "PROCESSING") return Promise.resolve({ count: 0 });
          return prisma.transferProofDeliveryIntent.updateMany(args);
        },
      },
      reminderDelivery: prisma.reminderDelivery,
      emailDelivery: prisma.emailDelivery,
    } as unknown as NonNullable<Parameters<typeof drainTransferProofDeliveryIntents>[1]>;
  }

  it("waits for the pinned Resend provider after atomic success persistence loses ownership", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("15")));
    await forceDeleteDeliveryIntents({ orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" });
    const previousResendKey = process.env.RESEND_API_KEY;
    const previousSendGridKey = process.env.SENDGRID_API_KEY;
    let accepted = false;
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    delete process.env.SENDGRID_API_KEY;
    mockedSendEmail.mockImplementation(async () => {
      accepted = true;
      return { ok: true, provider: "RESEND", providerResult: "accepted" };
    });
    try {
      await drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-01T15:00:00.000Z") }, completionLosingDb(() => accepted));
      await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
        .resolves.toMatchObject({ status: "PROCESSING", provider: "RESEND", attemptCount: 1 });
      await expect(prisma.reminderDelivery.findFirstOrThrow({ where: { orderId } }))
        .resolves.toMatchObject({ status: "ATTEMPTING", provider: "RESEND", completedAt: null });

      accepted = false;
      delete process.env.RESEND_API_KEY;
      process.env.SENDGRID_API_KEY = "synthetic-sendgrid-key";
      await drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-01T15:16:00.000Z") }, prisma);
      expect(mockedSendEmail).toHaveBeenCalledTimes(1);
      await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
        .resolves.toMatchObject({ status: "PROCESSING", provider: "RESEND", attemptCount: 1 });

      process.env.RESEND_API_KEY = "restored-synthetic-resend-key";
      await drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-01T15:17:00.000Z") }, prisma);
    } finally {
      if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResendKey;
      if (previousSendGridKey === undefined) delete process.env.SENDGRID_API_KEY;
      else process.env.SENDGRID_API_KEY = previousSendGridKey;
    }
    expect(mockedSendEmail).toHaveBeenCalledTimes(2);
    expect(mockedSendEmail.mock.calls[0][0]).toMatchObject({ provider: "RESEND" });
    expect(mockedSendEmail.mock.calls[1][0]).toMatchObject({
      provider: "RESEND",
      idempotencyKey: mockedSendEmail.mock.calls[0][0].idempotencyKey,
    });
    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({ status: "DELIVERED", provider: "RESEND", attemptCount: 2 });
  });

  it("does not consume a rejected delivery retry while its pinned provider is unavailable", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("16")));
    await forceDeleteDeliveryIntents({ orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" });
    await forceLegacyIntentState(
      { orderId },
      {
        status: "FAILED", provider: "RESEND", attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T16:00:00.000Z"),
        availableAt: new Date("2026-12-01T16:05:00.000Z"),
        lastError: "temporary rejection",
      },
    );
    const previousResendKey = process.env.RESEND_API_KEY;
    const previousSendGridKey = process.env.SENDGRID_API_KEY;
    delete process.env.RESEND_API_KEY;
    process.env.SENDGRID_API_KEY = "synthetic-sendgrid-key";
    try {
      await expect(drainTransferProofDeliveryIntents(
        { orderId, now: new Date("2026-12-01T16:06:00.000Z") }, prisma,
      )).resolves.toMatchObject({ claimed: 0, delivered: 0, failed: 0 });
    } finally {
      if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResendKey;
      if (previousSendGridKey === undefined) delete process.env.SENDGRID_API_KEY;
      else process.env.SENDGRID_API_KEY = previousSendGridKey;
    }
    expect(mockedSendEmail).not.toHaveBeenCalled();
    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({
        status: "FAILED", provider: "RESEND", attemptCount: 1, lastError: "temporary rejection",
      });
  });

  it("quarantines an accepted SendGrid delivery when atomic success persistence loses ownership", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("17")));
    await forceDeleteDeliveryIntents({ orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" });
    const previousResendKey = process.env.RESEND_API_KEY;
    const previousSendGridKey = process.env.SENDGRID_API_KEY;
    let accepted = false;
    delete process.env.RESEND_API_KEY;
    process.env.SENDGRID_API_KEY = "synthetic-sendgrid-key";
    mockedSendEmail.mockImplementation(async () => {
      accepted = true;
      return { ok: true, provider: "SENDGRID", providerResult: "accepted" };
    });
    try {
      await drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-01T17:00:00.000Z") }, completionLosingDb(() => accepted));
      await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
        .resolves.toMatchObject({ status: "PROCESSING", provider: "SENDGRID", attemptCount: 1 });

      accepted = false;
      process.env.RESEND_API_KEY = "synthetic-resend-key";
      delete process.env.SENDGRID_API_KEY;
      await expect(drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-01T17:16:00.000Z") }, prisma))
        .resolves.toMatchObject({ claimed: 0, reconciliationRequired: 1 });
    } finally {
      if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResendKey;
      if (previousSendGridKey === undefined) delete process.env.SENDGRID_API_KEY;
      else process.env.SENDGRID_API_KEY = previousSendGridKey;
    }
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({ status: "RECONCILIATION_REQUIRED", provider: "SENDGRID", attemptCount: 1 });
  });

  it("does not commit administrator SENT evidence without the matching outbox completion", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("19")));
    await forceDeleteDeliveryIntents({ orderId, kind: "BUYER_CONFIRMATION_EMAIL" });
    let accepted = false;
    mockedSendAdmin.mockImplementation(async () => {
      accepted = true;
      return { ok: true, provider: "RESEND", providerResult: "ACCEPTED" };
    });

    await drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T19:00:00.000Z") },
      completionLosingDb(() => accepted),
    );

    await expect(prisma.emailDelivery.count({ where: { orderId } })).resolves.toBe(0);
    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({ status: "PROCESSING", provider: "RESEND", attemptCount: 1 });
  });

  it("quarantines an accepted buyer delivery whose provider identity changed", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("20")));
    await forceDeleteDeliveryIntents({ orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" });
    mockedSendEmail.mockResolvedValue({ ok: true, provider: "SENDGRID", providerResult: "unexpected-acceptance" });

    await expect(drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T20:00:00.000Z") }, prisma,
    )).resolves.toMatchObject({ claimed: 1, delivered: 0, failed: 1, reconciliationRequired: 1 });

    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({
        status: "RECONCILIATION_REQUIRED", provider: "RESEND", attemptCount: 1,
        lastError: "Transfer-proof delivery provider changed from RESEND to SENDGRID",
      });
    await expect(prisma.reminderDelivery.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({ status: "ATTEMPTING", provider: "RESEND", completedAt: null });
  });

  it("quarantines an accepted administrator delivery whose provider identity changed", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("20")));
    await forceDeleteDeliveryIntents({ orderId, kind: "BUYER_CONFIRMATION_EMAIL" });
    mockedSendAdmin.mockResolvedValue({ ok: true, provider: "SENDGRID", providerResult: "unexpected-acceptance" });

    await expect(drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T20:00:00.000Z") }, prisma,
    )).resolves.toMatchObject({ claimed: 1, delivered: 0, failed: 1, reconciliationRequired: 1 });

    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({
        status: "RECONCILIATION_REQUIRED", provider: "RESEND", attemptCount: 1,
        lastError: "Transfer-proof delivery provider changed from RESEND to SENDGRID",
      });
    await expect(prisma.emailDelivery.count({ where: { orderId } })).resolves.toBe(0);
  });

  it("leaves unconfigured intents pending and claims them after a provider is configured", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("21")));
    await forceDeleteDeliveryIntents({ orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" });
    const savedResendKey = process.env.RESEND_API_KEY;
    const savedSendGridKey = process.env.SENDGRID_API_KEY;
    delete process.env.RESEND_API_KEY;
    delete process.env.SENDGRID_API_KEY;
    try {
      await expect(drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-01T21:00:00.000Z") }, prisma))
        .resolves.toMatchObject({ claimed: 0, delivered: 0, failed: 0 });
      await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
        .resolves.toMatchObject({ status: "PENDING", provider: null, attemptCount: 0 });

      process.env.SENDGRID_API_KEY = "synthetic-sendgrid-key";
      mockedSendEmail.mockResolvedValue({ ok: true, provider: "SENDGRID", providerResult: "ACCEPTED" });
      await expect(drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-01T21:01:00.000Z") }, prisma))
        .resolves.toMatchObject({ claimed: 1, delivered: 1, failed: 0 });
    } finally {
      if (savedResendKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = savedResendKey;
      if (savedSendGridKey === undefined) delete process.env.SENDGRID_API_KEY;
      else process.env.SENDGRID_API_KEY = savedSendGridKey;
    }
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail).toHaveBeenCalledWith(expect.objectContaining({ provider: "SENDGRID" }));
    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({ status: "DELIVERED", provider: "SENDGRID", attemptCount: 1 });
  });

  it("escalates an accepted Resend delivery when atomic success persistence exhausts the retry budget", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("22")));
    await forceDeleteDeliveryIntents({ orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" });
    await forceLegacyIntentState(
      { orderId },
      {
        status: "PROCESSING", provider: "RESEND", attemptCount: 2,
        firstAttemptAt: new Date("2026-12-01T22:00:00.000Z"),
        processingAt: new Date("2026-12-01T22:00:00.000Z"),
        leaseExpiresAt: new Date("2026-12-01T22:15:00.000Z"),
        claimToken: "synthetic-exhaustion-claim",
      },
    );
    mockedSendEmail.mockResolvedValue({ ok: true, provider: "RESEND", providerResult: "accepted" });
    const blocksDeliveredTransition = (args: Prisma.TransferProofDeliveryIntentUpdateManyArgs) =>
      args.data.status === "DELIVERED";
    const completionConflictingDb = {
      $transaction: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => transactionWithIntentUpdateFilter(
        fn, blocksDeliveredTransition,
      ),
      transferProofDeliveryIntent: {
        findMany: (args: Prisma.TransferProofDeliveryIntentFindManyArgs) => prisma.transferProofDeliveryIntent.findMany(args),
        updateMany: (args: Prisma.TransferProofDeliveryIntentUpdateManyArgs) => {
          if (args.data.status === "DELIVERED") return Promise.resolve({ count: 0 });
          return prisma.transferProofDeliveryIntent.updateMany(args);
        },
      },
      reminderDelivery: prisma.reminderDelivery,
      emailDelivery: prisma.emailDelivery,
    } as unknown as NonNullable<Parameters<typeof drainTransferProofDeliveryIntents>[1]>;

    await expect(drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T22:16:00.000Z") }, completionConflictingDb,
    )).resolves.toMatchObject({ claimed: 1, reconciliationRequired: 1 });
    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({ status: "RECONCILIATION_REQUIRED", provider: "RESEND", attemptCount: 3 });
    await expect(prisma.reminderDelivery.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({ status: "ATTEMPTING", provider: "RESEND", completedAt: null });
  });
});
