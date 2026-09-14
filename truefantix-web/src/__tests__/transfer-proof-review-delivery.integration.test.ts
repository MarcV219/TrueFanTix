/** @jest-environment node */

import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { sendEmail } from "@/lib/email";
import {
  drainTransferProofReviewDeliveryIntents,
  stageTransferProofReviewDeliveryIntent,
} from "@/lib/orders/transferProofReviewDelivery";

jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }));

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;

if (!databaseUrl) describe.skip("transfer-proof review delivery PostgreSQL boundary", () => {
  it("requires an isolated database", () => undefined);
}); else describe("transfer-proof review delivery PostgreSQL boundary", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const runId = `${Date.now()}-${process.pid}`;
  const orderId = `review-delivery-${runId}`;
  const sellerId = `review-delivery-seller-${runId}`;
  const buyerSellerId = `review-delivery-buyer-${runId}`;
  const sellerUserId = `review-delivery-user-${runId}`;
  let requestId = "";
  let requestedAt = new Date();
  let previousResendKey: string | undefined;

  function params(overrides: Partial<{
    requestId: string;
    subject: string;
    textBody: string;
    htmlBody: string;
  }> = {}) {
    return {
      orderId,
      requestId: overrides.requestId ?? requestId,
      recipient: "support@truefantix.com",
      subject: overrides.subject ?? `Review requested for ${orderId}`,
      textBody: overrides.textBody ?? `Review ${orderId} requested at ${requestedAt.toISOString()}`,
      htmlBody: overrides.htmlBody ?? `<p>Review ${orderId} requested at ${requestedAt.toISOString()}</p>`,
      requestedAt,
    };
  }

  async function forceDeleteIntents() {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.transferProofReviewDeliveryIntent.deleteMany({ where: { orderId } });
    });
  }

  async function forceProcessingExhausted(
    providerResult: string | null,
    leaseExpiresAt: Date,
  ) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.transferProofReviewDeliveryIntent.update({
        where: { requestId },
        data: {
          status: "PROCESSING",
          provider: "RESEND",
          attemptCount: 3,
          firstAttemptAt: requestedAt,
          processingAt: requestedAt,
          leaseExpiresAt,
          claimToken: `final-claim-${requestId}`,
          dispatchStartedAt: requestedAt,
          providerResult,
          lastError: providerResult ? "Synthetic accepted-send persistence loss" : null,
        },
      });
    });
  }

  async function databaseUtcNow() {
    const [row] = await prisma.$queryRaw<Array<{ now: Date }>>`
      SELECT statement_timestamp() AT TIME ZONE 'UTC' AS now
    `;
    return row.now;
  }

  async function prepareRequest() {
    requestId = randomUUID();
    requestedAt = new Date();
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "PAID",
        buyerConfirmationStatus: "PENDING",
        transferProofType: "Screenshot",
        transferProofData: JSON.stringify({
          sellerNote: "Synthetic review",
          proofUpload: "synthetic-proof",
          manualReviewRequestId: requestId,
          manualReviewRequestedAt: requestedAt.toISOString(),
          requestedByUserId: sellerUserId,
        }),
        transferVerificationStatus: "MANUAL_REVIEW",
        transferVerificationReason: "synthetic-review",
        disputeWindowEndsAt: null,
      },
    });
  }

  beforeAll(async () => {
    previousResendKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    await prisma.seller.createMany({ data: [
      { id: sellerId, name: "Review Delivery Seller" },
      { id: buyerSellerId, name: "Review Delivery Buyer" },
    ] });
    await prisma.user.create({ data: {
      id: sellerUserId,
      email: `review-delivery-${runId}@example.test`,
      passwordHash: "synthetic",
      firstName: "Seller",
      lastName: "Review",
      phone: `+7${String(Date.now()).slice(-10)}`,
      streetAddress1: "1 Test Street",
      city: "Toronto",
      region: "ON",
      postalCode: "A1A1A1",
      country: "CA",
      sellerId,
    } });
    await prisma.order.create({ data: {
      id: orderId,
      sellerId,
      buyerSellerId,
      status: "PAID",
      amountCents: 100,
      adminFeeCents: 10,
      totalCents: 110,
      transferProofType: "Screenshot",
      transferProofData: "{}",
      transferVerificationStatus: "MANUAL_REVIEW",
      buyerConfirmationStatus: "PENDING",
    } });
  });

  beforeEach(async () => {
    await forceDeleteIntents();
    await prisma.emailDelivery.deleteMany({ where: { orderId } });
    await prepareRequest();
    jest.clearAllMocks();
    mockedSendEmail.mockResolvedValue({
      ok: true,
      provider: "RESEND",
      providerResult: "ACCEPTED",
    });
  });

  afterAll(async () => {
    await forceDeleteIntents();
    await prisma.emailDelivery.deleteMany({ where: { orderId } });
    await prisma.order.delete({ where: { id: orderId } });
    await prisma.user.delete({ where: { id: sellerUserId } });
    await prisma.seller.deleteMany({ where: { id: { in: [sellerId, buyerSellerId] } } });
    await prisma.$disconnect();
    await pool.end();
    if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResendKey;
  });

  it("rolls back the durable envelope without performing provider I/O", async () => {
    await expect(prisma.$transaction(async (tx) => {
      await stageTransferProofReviewDeliveryIntent(tx, params());
      throw new Error("force review delivery rollback");
    }, { isolationLevel: "Serializable" })).rejects.toThrow("force review delivery rollback");

    await expect(prisma.transferProofReviewDeliveryIntent.count({ where: { orderId } }))
      .resolves.toBe(0);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("rejects a caller-selected future request origin before it can become pending work", async () => {
    requestId = randomUUID();
    requestedAt = new Date((await databaseUtcNow()).getTime() + 60 * 60 * 1000);
    await prisma.order.update({
      where: { id: orderId },
      data: { transferProofData: JSON.stringify({
        sellerNote: "Synthetic future review",
        proofUpload: "synthetic-proof",
        manualReviewRequestId: requestId,
        manualReviewRequestedAt: requestedAt.toISOString(),
        requestedByUserId: sellerUserId,
      }) },
    });

    await expect(prisma.$transaction((tx) => (
      stageTransferProofReviewDeliveryIntent(tx, params())
    ))).rejects.toThrow("must originate pending");
    await expect(prisma.transferProofReviewDeliveryIntent.count({ where: { orderId } }))
      .resolves.toBe(0);
  });

  it("leaves a committed envelope pending until a later resumable drain", async () => {
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));

    await expect(prisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
      where: { requestId },
    })).resolves.toMatchObject({ status: "PENDING", attemptCount: 0, provider: null });
    expect(mockedSendEmail).not.toHaveBeenCalled();

    await expect(drainTransferProofReviewDeliveryIntents({ orderId, now: requestedAt }, prisma))
      .resolves.toMatchObject({ claimed: 1, delivered: 1, reconciliationRequired: 0 });
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^tft-human-review-[0-9a-f]{64}$/),
      provider: "RESEND",
      to: "support@truefantix.com",
    }));
    await expect(prisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
      where: { requestId },
    })).resolves.toMatchObject({ status: "DELIVERED", attemptCount: 1, provider: "RESEND" });
    await expect(prisma.emailDelivery.count({ where: { orderId, status: "SENT" } }))
      .resolves.toBe(1);
  });

  it("reuses one immutable request identity and rejects conflicting content", async () => {
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));

    await expect(prisma.transferProofReviewDeliveryIntent.count({ where: { orderId } }))
      .resolves.toBe(1);
    await expect(prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(
      tx,
      params({ subject: "Conflicting review subject" }),
    ))).rejects.toThrow("does not match the canonical envelope");
    await expect(prisma.transferProofReviewDeliveryIntent.update({
      where: { requestId },
      data: { textBody: "rewritten" },
    })).rejects.toThrow("Transfer-proof review delivery envelope is immutable");
  });

  it("rejects caller-forged claim, dispatch, retry, and completion clocks", async () => {
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
    const databaseNow = await databaseUtcNow();
    const forgedPast = new Date(databaseNow.getTime() - 60 * 60 * 1000);
    const forgedFuture = new Date(databaseNow.getTime() + 60 * 60 * 1000);

    await expect(prisma.transferProofReviewDeliveryIntent.update({
      where: { requestId },
      data: {
        status: "PROCESSING",
        provider: "RESEND",
        processingAt: forgedPast,
        leaseExpiresAt: new Date(forgedPast.getTime() + 15 * 60 * 1000),
        claimToken: `forged-claim-${requestId}`,
      },
    })).rejects.toThrow("Invalid transfer-proof review delivery claim acquisition");

    const claimToken = `synthetic-valid-claim-${requestId}`;
    const leaseExpiresAt = new Date(databaseNow.getTime() + 15 * 60 * 1000);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.transferProofReviewDeliveryIntent.update({
        where: { requestId },
        data: {
          status: "PROCESSING",
          provider: "RESEND",
          processingAt: databaseNow,
          leaseExpiresAt,
          claimToken,
        },
      });
    });

    await expect(prisma.transferProofReviewDeliveryIntent.update({
      where: { requestId },
      data: {
        attemptCount: 1,
        firstAttemptAt: forgedFuture,
        dispatchStartedAt: forgedFuture,
      },
    })).rejects.toThrow("Invalid transfer-proof review delivery dispatch boundary");

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.transferProofReviewDeliveryIntent.update({
        where: { requestId },
        data: {
          attemptCount: 1,
          firstAttemptAt: databaseNow,
          dispatchStartedAt: databaseNow,
        },
      });
    });

    await expect(prisma.transferProofReviewDeliveryIntent.update({
      where: { requestId },
      data: {
        status: "FAILED",
        processingAt: null,
        leaseExpiresAt: null,
        claimToken: null,
        dispatchStartedAt: null,
        providerResult: "REJECTED",
        lastError: "forged retry",
        availableAt: forgedFuture,
      },
    })).rejects.toThrow("Invalid transfer-proof review delivery retry schedule");

    await expect(prisma.transferProofReviewDeliveryIntent.update({
      where: { requestId },
      data: {
        status: "DELIVERED",
        processingAt: null,
        leaseExpiresAt: null,
        claimToken: null,
        dispatchStartedAt: null,
        providerResult: "ACCEPTED",
        deliveredAt: forgedFuture,
      },
    })).rejects.toThrow("Invalid transfer-proof review delivery completion evidence");
  });

  it("uses PostgreSQL UTC evidence even when the worker session is non-UTC", async () => {
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
    const nonUtcPool = new Pool({ connectionString: databaseUrl, max: 1 });
    const nonUtcPrisma = new PrismaClient({ adapter: new PrismaPg(nonUtcPool) });
    try {
      await nonUtcPrisma.$executeRawUnsafe("SET TIME ZONE 'America/Toronto'");
      await expect(drainTransferProofReviewDeliveryIntents({
        orderId,
        now: new Date("2099-01-01T00:00:00.000Z"),
      }, nonUtcPrisma)).resolves.toMatchObject({ claimed: 1, delivered: 1 });
      await expect(nonUtcPrisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
        where: { requestId },
      })).resolves.toMatchObject({ status: "DELIVERED", attemptCount: 1 });
    } finally {
      await nonUtcPrisma.$disconnect();
      await nonUtcPool.end();
    }
  });

  it("terminally quarantines a malformed envelope before provider dispatch", async () => {
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.transferProofReviewDeliveryIntent.update({
        where: { requestId },
        data: { idempotencyKey: `tft-human-review-${"0".repeat(64)}` },
      });
    });

    await expect(drainTransferProofReviewDeliveryIntents({ orderId }, prisma))
      .resolves.toMatchObject({ claimed: 1, failed: 1, reconciliationRequired: 1 });
    await expect(prisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
      where: { requestId },
    })).resolves.toMatchObject({
      status: "RECONCILIATION_REQUIRED",
      processingAt: null,
      leaseExpiresAt: null,
      claimToken: null,
      dispatchStartedAt: null,
      lastError: expect.stringContaining("identity does not match"),
    });
    expect(mockedSendEmail).not.toHaveBeenCalled();

    await expect(drainTransferProofReviewDeliveryIntents({ orderId }, prisma))
      .resolves.toMatchObject({ claimed: 0, reconciliationRequired: 0 });
  });

  it("quarantines an expired Resend claim whose replay window elapsed before dispatch", async () => {
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
    const databaseNow = await databaseUtcNow();
    const expired = new Date(databaseNow.getTime() - 60 * 1000);
    const oldFirstAttempt = new Date(databaseNow.getTime() - 25 * 60 * 60 * 1000);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.transferProofReviewDeliveryIntent.update({
        where: { requestId },
        data: {
          status: "PROCESSING",
          provider: "RESEND",
          attemptCount: 1,
          firstAttemptAt: oldFirstAttempt,
          processingAt: expired,
          leaseExpiresAt: expired,
          claimToken: `expired-predispatch-${requestId}`,
          dispatchStartedAt: null,
          providerResult: "REJECTED",
          lastError: "Prior rejected attempt",
        },
      });
    });

    await expect(drainTransferProofReviewDeliveryIntents({ orderId }, prisma))
      .resolves.toMatchObject({ claimed: 0, reconciliationRequired: 1 });
    await expect(prisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
      where: { requestId },
    })).resolves.toMatchObject({
      status: "RECONCILIATION_REQUIRED",
      provider: "RESEND",
      attemptCount: 1,
      firstAttemptAt: oldFirstAttempt,
      dispatchStartedAt: null,
      lastError: "Resend review delivery idempotency window expired; reconciliation required",
    });
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("replays accepted Resend persistence ambiguity only with the same provider key", async () => {
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
    let transactionCall = 0;
    type ReviewDeliveryDb = NonNullable<Parameters<typeof drainTransferProofReviewDeliveryIntents>[1]>;
    const persistenceFailureDb = {
      transferProofReviewDeliveryIntent: prisma.transferProofReviewDeliveryIntent,
      emailDelivery: prisma.emailDelivery,
      $executeRaw: prisma.$executeRaw.bind(prisma),
      $queryRaw: prisma.$queryRaw.bind(prisma),
      $transaction: async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        transactionCall += 1;
        if (transactionCall === 2) throw new Error("synthetic persistence failure");
        return prisma.$transaction(work);
      },
    } as unknown as ReviewDeliveryDb;

    await expect(drainTransferProofReviewDeliveryIntents(
      { orderId, now: requestedAt },
      persistenceFailureDb,
    )).resolves.toMatchObject({ claimed: 1, delivered: 0, failed: 1 });
    await expect(prisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
      where: { requestId },
    })).resolves.toMatchObject({
      status: "PROCESSING",
      provider: "RESEND",
      attemptCount: 1,
    });

    await expect(drainTransferProofReviewDeliveryIntents({
      orderId,
      now: new Date(requestedAt.getTime() + 1),
    }, prisma)).resolves.toMatchObject({ claimed: 1, delivered: 1 });
    expect(mockedSendEmail).toHaveBeenCalledTimes(2);
    const firstKey = mockedSendEmail.mock.calls[0][0].idempotencyKey;
    const replayKey = mockedSendEmail.mock.calls[1][0].idempotencyKey;
    expect(replayKey).toBe(firstKey);
    await expect(prisma.emailDelivery.count({ where: { orderId, status: "SENT" } }))
      .resolves.toBe(1);
  });

  it("does not let a caller clock reclaim a live sub-max claim", async () => {
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
    const databaseNow = await databaseUtcNow();
    const liveLeaseExpiresAt = new Date(databaseNow.getTime() + 60 * 60 * 1000);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.transferProofReviewDeliveryIntent.update({
        where: { requestId },
        data: {
          status: "PROCESSING",
          provider: "RESEND",
          attemptCount: 1,
          firstAttemptAt: requestedAt,
          processingAt: requestedAt,
          leaseExpiresAt: liveLeaseExpiresAt,
          claimToken: `live-sub-max-${requestId}`,
          dispatchStartedAt: null,
        },
      });
    });

    await expect(drainTransferProofReviewDeliveryIntents({
      orderId,
      now: new Date(liveLeaseExpiresAt.getTime() + 60 * 60 * 1000),
    }, prisma)).resolves.toMatchObject({ claimed: 0, delivered: 0 });
    expect(mockedSendEmail).not.toHaveBeenCalled();

    const expiredLease = new Date((await databaseUtcNow()).getTime() - 1);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.transferProofReviewDeliveryIntent.update({
        where: { requestId },
        data: { leaseExpiresAt: expiredLease },
      });
    });

    await expect(drainTransferProofReviewDeliveryIntents({
      orderId,
      now: databaseNow,
    }, prisma)).resolves.toMatchObject({ claimed: 1, delivered: 1 });
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    await expect(drainTransferProofReviewDeliveryIntents({ orderId }, prisma))
      .resolves.toMatchObject({ claimed: 0, delivered: 0 });
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["before provider result", null],
    ["after accepted-send persistence loss", "ACCEPTED"],
  ])("reconciles an expired third dispatch %s without a fourth provider call", async (
    _case,
    providerResult,
  ) => {
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
    const databaseNow = await databaseUtcNow();
    const liveLeaseExpiresAt = new Date(databaseNow.getTime() + 60 * 60 * 1000);
    await forceProcessingExhausted(providerResult, liveLeaseExpiresAt);

    await expect(drainTransferProofReviewDeliveryIntents({
      orderId,
      // A caller-selected future clock must not expire a live database lease.
      now: new Date(liveLeaseExpiresAt.getTime() + 60 * 60 * 1000),
    }, prisma)).resolves.toMatchObject({ claimed: 0, reconciliationRequired: 0 });
    await expect(prisma.$executeRaw`
      UPDATE "TransferProofReviewDeliveryIntent"
      SET status = 'RECONCILIATION_REQUIRED'
      WHERE "requestId" = ${requestId}
    `).rejects.toThrow(/result ownership|state_check|violates check constraint/i);
    await expect(prisma.transferProofReviewDeliveryIntent.update({
      where: { requestId },
      data: {
        status: "RECONCILIATION_REQUIRED",
        processingAt: null,
        leaseExpiresAt: null,
        claimToken: null,
        dispatchStartedAt: null,
        lastError: "forged final reconciliation clock",
        availableAt: new Date(databaseNow.getTime() + 60 * 60 * 1000),
      },
    })).rejects.toThrow("Invalid transfer-proof review reconciliation schedule");

    const expiredLease = new Date(databaseNow.getTime() - 1);
    await forceProcessingExhausted(providerResult, expiredLease);

    await expect(drainTransferProofReviewDeliveryIntents({
      orderId,
      now: databaseNow,
    }, prisma)).resolves.toMatchObject({ claimed: 0, reconciliationRequired: 1 });
    await expect(prisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
      where: { requestId },
    })).resolves.toMatchObject({
      status: "RECONCILIATION_REQUIRED",
      provider: "RESEND",
      providerResult,
      processingAt: null,
      leaseExpiresAt: null,
      claimToken: null,
      dispatchStartedAt: null,
      lastError: "Expired final review delivery claim requires provider reconciliation",
    });
    expect(mockedSendEmail).not.toHaveBeenCalled();

    await expect(drainTransferProofReviewDeliveryIntents({
      orderId,
      now: new Date(databaseNow.getTime() + 1),
    }, prisma)).resolves.toMatchObject({ claimed: 0, reconciliationRequired: 0 });
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });
});
