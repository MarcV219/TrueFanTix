/** @jest-environment node */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { sendEmail } from "@/lib/email";
import { sendAdminActivityEmail } from "@/lib/adminActivityEmail";
import {
  drainTransferProofDeliveryIntents,
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

if (!databaseUrl) describe.skip("transfer-proof delivery PostgreSQL boundary", () => {
  it("requires an isolated database", () => undefined);
}); else describe("transfer-proof delivery PostgreSQL boundary", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const runId = `${Date.now()}-${process.pid}`;
  const orderId = `transfer-proof-${runId}`;
  const buyerEmail = `transfer-proof-${runId}@example.test`;
  let buyerUserId = "";

  beforeAll(async () => {
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
  });

  beforeEach(async () => {
    await prisma.notification.deleteMany({ where: { userId: buyerUserId } });
    await prisma.transferProofDeliveryIntent.deleteMany({ where: { orderId } });
    await prisma.reminderDelivery.deleteMany({ where: { orderId } });
    await prisma.emailDelivery.deleteMany({ where: { orderId } });
    jest.clearAllMocks();
    mockedSendEmail.mockResolvedValue({ ok: true, provider: "CONSOLE", providerResult: "ACCEPTED" });
    mockedSendAdmin.mockResolvedValue({ ok: true, provider: "CONSOLE" });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: buyerUserId } });
    await prisma.transferProofDeliveryIntent.deleteMany({ where: { orderId } });
    await prisma.reminderDelivery.deleteMany({ where: { orderId } });
    await prisma.emailDelivery.deleteMany({ where: { orderId } });
    await prisma.user.deleteMany({ where: { id: buyerUserId } });
    await prisma.$disconnect();
    await pool.end();
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
      deadline: new Date(now.getTime() + 86_400_000),
      now,
    };
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

  it("loses a real Serializable race without intent residue or pre-commit sends", async () => {
    let staged!: () => void;
    const stagedPromise = new Promise<void>((resolve) => { staged = resolve; });
    let competingCommitted!: () => void;
    const competingPromise = new Promise<void>((resolve) => { competingCommitted = resolve; });

    const loser = prisma.$transaction(async (tx) => {
      await tx.user.findUniqueOrThrow({ where: { id: buyerUserId } });
      await stageTransferProofDeliveryIntent(tx, params("07"));
      staged();
      await competingPromise;
      await tx.user.update({ where: { id: buyerUserId }, data: { lastName: "Losing transaction" } });
    }, { isolationLevel: "Serializable" });

    await stagedPromise;
    await prisma.$transaction(async (tx) => {
      await tx.user.findUniqueOrThrow({ where: { id: buyerUserId } });
      await tx.user.update({ where: { id: buyerUserId }, data: { lastName: "Winning transaction" } });
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
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId, status: "DELIVERED" } })).resolves.toBe(2);
    await expect(prisma.reminderDelivery.count({ where: { orderId, status: "SENT" } })).resolves.toBe(1);
    await expect(prisma.emailDelivery.count({ where: { orderId, status: "SENT" } })).resolves.toBe(1);
  });

  it("stages the buyer notification and Admin intent when buyer email is absent", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, { ...params("19"), buyerEmail: null }));

    await expect(prisma.notification.count({ where: { userId: buyerUserId } })).resolves.toBe(1);
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId, kind: "BUYER_CONFIRMATION_EMAIL" } })).resolves.toBe(0);
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId, recipient: "admin@truefantix.com" } })).resolves.toBe(1);
  });

  it("recovers failed and stale claims through the persisted drainer", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("23")));
    await prisma.transferProofDeliveryIntent.updateMany({ where: { orderId, kind: "BUYER_CONFIRMATION_EMAIL" }, data: { status: "FAILED", availableAt: new Date("2026-12-01T18:00:00.000Z") } });
    await prisma.transferProofDeliveryIntent.updateMany({ where: { orderId, recipient: "admin@truefantix.com" }, data: { status: "PROCESSING", attemptCount: 1, leaseExpiresAt: new Date("2026-12-01T18:00:00.000Z") } });

    await drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-02T00:00:00.000Z") }, prisma);
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendAdmin).toHaveBeenCalledTimes(1);
    await expect(prisma.transferProofDeliveryIntent.findMany({ where: { orderId }, select: { status: true, attemptCount: true } }))
      .resolves.toEqual(expect.arrayContaining([
        { status: "DELIVERED", attemptCount: 1 },
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
    mockedSendEmail.mockResolvedValue({ ok: true, provider: "CONSOLE", providerResult: "ACCEPTED" });
    mockedSendAdmin.mockResolvedValue({ ok: true, provider: "CONSOLE" });
    await expect(drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-01T03:04:59.999Z") }, prisma))
      .resolves.toMatchObject({ claimed: 0 });
    await expect(drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-01T03:05:00.000Z") }, prisma))
      .resolves.toMatchObject({ claimed: 2, delivered: 2, failed: 0 });
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendAdmin).toHaveBeenCalledTimes(1);
    await expect(prisma.transferProofDeliveryIntent.count({ where: { orderId, status: "DELIVERED", attemptCount: 2 } })).resolves.toBe(2);
  });

  it("does not claim a delivery after its bounded attempt budget is exhausted", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("05")));
    await prisma.transferProofDeliveryIntent.updateMany({
      where: { orderId },
      data: { status: "FAILED", attemptCount: 3, availableAt: new Date("2026-12-01T00:00:00.000Z") },
    });

    await expect(drainTransferProofDeliveryIntents({ orderId, now: new Date("2026-12-02T00:00:00.000Z") }, prisma))
      .resolves.toMatchObject({ claimed: 0 });
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
  });

  it("quarantines an ambiguous stale SendGrid acceptance instead of resending", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("09")));
    await prisma.transferProofDeliveryIntent.updateMany({
      where: { orderId },
      data: { status: "PROCESSING", attemptCount: 1, leaseExpiresAt: new Date("2026-12-01T09:00:00.000Z") },
    });
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
});
