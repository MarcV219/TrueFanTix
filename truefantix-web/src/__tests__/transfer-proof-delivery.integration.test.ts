/** @jest-environment node */

import { Prisma, PrismaClient } from "@prisma/client";
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
  let previousResendKey: string | undefined;

  beforeAll(async () => {
    previousResendKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "synthetic-resend-key";
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
    expect(mockedSendEmail.mock.calls[0][0].idempotencyKey).toMatch(/^tft-transfer-proof-[a-f0-9]{64}$/);
    expect(mockedSendEmail.mock.calls[0][0].idempotencyKey!.length).toBeLessThanOrEqual(256);
    expect(mockedSendAdmin.mock.calls[0][0]).toMatchObject({
      idempotencyKey: expect.stringMatching(/^tft-transfer-proof-[a-f0-9]{64}$/),
      completedAt: "2026-12-01T13:00:00.000Z",
    });
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
    await prisma.transferProofDeliveryIntent.updateMany({ where: { orderId, recipient: "admin@truefantix.com" }, data: { status: "PROCESSING", provider: "RESEND", attemptCount: 1, firstAttemptAt: new Date("2026-12-01T18:00:00.000Z"), leaseExpiresAt: new Date("2026-12-01T18:00:00.000Z") } });

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
    await prisma.transferProofDeliveryIntent.updateMany({
      where: { orderId },
      data: { status: "FAILED", attemptCount: 3, availableAt: new Date("2026-12-01T00:00:00.000Z") },
    });

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
    await prisma.transferProofDeliveryIntent.deleteMany({ where: { orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" } });
    await prisma.transferProofDeliveryIntent.updateMany({
      where: { orderId },
      data: {
        status: "FAILED", provider: "RESEND", attemptCount: 2,
        firstAttemptAt: new Date("2026-12-01T05:00:00.000Z"),
        availableAt: new Date("2026-12-01T06:00:00.000Z"),
      },
    });
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
    await prisma.transferProofDeliveryIntent.updateMany({
      where: { orderId },
      data: { status: "PROCESSING", provider: "SENDGRID", attemptCount: 1, firstAttemptAt: new Date("2026-12-01T09:00:00.000Z"), leaseExpiresAt: new Date("2026-12-01T09:00:00.000Z") },
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

  it("quarantines ambiguous Resend recovery after its 24-hour idempotency window", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("11")));
    await prisma.transferProofDeliveryIntent.updateMany({
      where: { orderId },
      data: {
        status: "PROCESSING",
        provider: "RESEND",
        attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T11:00:00.000Z"),
        leaseExpiresAt: new Date("2026-12-01T11:15:00.000Z"),
      },
    });
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
    await prisma.transferProofDeliveryIntent.updateMany({
      where: { orderId },
      data: {
        status: "FAILED",
        provider: "RESEND",
        attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T12:00:00.000Z"),
        availableAt: new Date("2026-12-01T12:05:00.000Z"),
      },
    });

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
    await prisma.transferProofDeliveryIntent.updateMany({
      where: { orderId },
      data: {
        status: "FAILED",
        provider: "RESEND",
        attemptCount: 1,
        firstAttemptAt: null,
        availableAt: new Date("2026-12-01T14:05:00.000Z"),
      },
    });

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

  function completionLosingDb(providerAccepted: () => boolean) {
    return {
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

  it("waits for the pinned Resend provider before reclaiming a lost completion", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("15")));
    await prisma.transferProofDeliveryIntent.deleteMany({ where: { orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" } });
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
        .resolves.toMatchObject({ status: "SENT", provider: "RESEND", failureReason: null });

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
    await prisma.transferProofDeliveryIntent.deleteMany({ where: { orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" } });
    await prisma.transferProofDeliveryIntent.updateMany({
      where: { orderId },
      data: {
        status: "FAILED", provider: "RESEND", attemptCount: 1,
        firstAttemptAt: new Date("2026-12-01T16:00:00.000Z"),
        availableAt: new Date("2026-12-01T16:05:00.000Z"),
        lastError: "temporary rejection",
      },
    });
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

  it("quarantines a lost SendGrid completion after config changes instead of crossing providers", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("17")));
    await prisma.transferProofDeliveryIntent.deleteMany({ where: { orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" } });
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

  it("preserves SENT administrator evidence when outbox completion persistence is lost", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("19")));
    await prisma.transferProofDeliveryIntent.deleteMany({ where: { orderId, kind: "BUYER_CONFIRMATION_EMAIL" } });
    let accepted = false;
    mockedSendAdmin.mockImplementation(async () => {
      accepted = true;
      return { ok: true, provider: "RESEND", providerResult: "ACCEPTED" };
    });

    await drainTransferProofDeliveryIntents(
      { orderId, now: new Date("2026-12-01T19:00:00.000Z") },
      completionLosingDb(() => accepted),
    );

    await expect(prisma.emailDelivery.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({ status: "SENT", provider: "RESEND", error: null });
    await expect(prisma.transferProofDeliveryIntent.findFirstOrThrow({ where: { orderId } }))
      .resolves.toMatchObject({ status: "PROCESSING", provider: "RESEND", attemptCount: 1 });
  });

  it("leaves unconfigured intents pending and claims them after a provider is configured", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("21")));
    await prisma.transferProofDeliveryIntent.deleteMany({ where: { orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" } });
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

  it("escalates an accepted Resend delivery when completion persistence exhausts the retry budget", async () => {
    await prisma.$transaction((tx) => stageTransferProofDeliveryIntent(tx, params("22")));
    await prisma.transferProofDeliveryIntent.deleteMany({ where: { orderId, kind: "ADMIN_TRANSFER_ACTIVITY_EMAIL" } });
    await prisma.transferProofDeliveryIntent.updateMany({
      where: { orderId },
      data: {
        status: "PROCESSING", provider: "RESEND", attemptCount: 2,
        firstAttemptAt: new Date("2026-12-01T22:00:00.000Z"),
        leaseExpiresAt: new Date("2026-12-01T22:15:00.000Z"),
      },
    });
    mockedSendEmail.mockResolvedValue({ ok: true, provider: "RESEND", providerResult: "accepted" });
    const completionConflictingDb = {
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
      .resolves.toMatchObject({ status: "SENT", provider: "RESEND", failureReason: null });
  });
});
