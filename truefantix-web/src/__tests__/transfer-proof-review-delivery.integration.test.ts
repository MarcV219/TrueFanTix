/** @jest-environment node */

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { sendEmail } from "@/lib/email";
import {
  TRANSFER_PROOF_REVIEW_STAGING_ORIGIN,
  TRANSFER_PROOF_REVIEW_TEST_ORIGIN,
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
  let previousSendGridKey: string | undefined;

  function params(overrides: Partial<{
    requestId: string;
    sellerName: string;
    sellerEmail: string;
    eventTitle: string;
  }> = {}) {
    return {
      orderId,
      requestId: overrides.requestId ?? requestId,
      recipient: "support@truefantix.com",
      sellerName: overrides.sellerName ?? "Seller Review",
      sellerEmail: overrides.sellerEmail ?? `review-delivery-${runId}@example.test`,
      eventTitle: overrides.eventTitle ?? "Ticket order",
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
    previousSendGridKey = process.env.SENDGRID_API_KEY;
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    delete process.env.SENDGRID_API_KEY;
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
    if (previousSendGridKey === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = previousSendGridKey;
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

  it("delivers the immutable review snapshot after ordinary seller profile changes", async () => {
    const originalEmail = `review-delivery-${runId}@example.test`;
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
    await prisma.user.update({
      where: { id: sellerUserId },
      data: {
        email: `review-delivery-updated-${runId}@example.test`,
        firstName: "Updated",
      },
    });
    await prisma.seller.update({
      where: { id: sellerId },
      data: { name: "Updated Review Delivery Seller" },
    });

    try {
      await expect(drainTransferProofReviewDeliveryIntents({ orderId }, prisma))
        .resolves.toMatchObject({ claimed: 1, delivered: 1, reconciliationRequired: 0 });
      expect(mockedSendEmail).toHaveBeenCalledWith(expect.objectContaining({
        to: "support@truefantix.com",
        text: expect.stringContaining(originalEmail),
      }));
    } finally {
      await prisma.user.update({
        where: { id: sellerUserId },
        data: { email: originalEmail, firstName: "Seller" },
      });
      await prisma.seller.update({
        where: { id: sellerId },
        data: { name: "Review Delivery Seller" },
      });
    }
  });

  it("reuses one immutable request identity and rejects conflicting content", async () => {
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));

    await expect(prisma.transferProofReviewDeliveryIntent.count({ where: { orderId } }))
      .resolves.toBe(1);
    await expect(prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(
      tx,
      params({ eventTitle: "Conflicting event title" }),
    ))).rejects.toThrow("does not match the canonical envelope");
    await expect(prisma.transferProofReviewDeliveryIntent.update({
      where: { requestId },
      data: { textBody: "rewritten" },
    })).rejects.toThrow("Transfer-proof review delivery envelope is immutable");
  });

  it("binds an internally canonical envelope to the current database environment", async () => {
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
    const template = await prisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
      where: { requestId },
    });
    const payload = template.payloadJson as {
      sellerName: string;
      sellerEmail: string;
      eventTitle: string;
      appOrigin: string;
    };
    expect(payload.appOrigin).toBe(TRANSFER_PROOF_REVIEW_TEST_ORIGIN);

    for (const unknownDatabase of [
      "ordinary_live",
      "primary_production_preview_copy",
      "preview_archive_primary_prod",
      "truefantix_primary_test_backup",
    ]) {
      await expect(prisma.$queryRaw`
        SELECT canonical_transfer_proof_review_origin_for_database(${unknownDatabase})
      `).rejects.toThrow("Unrecognized transfer-proof review database environment");
    }

    await forceDeleteIntents();
    const crossEnvironmentPayload = {
      ...payload,
      appOrigin: TRANSFER_PROOF_REVIEW_STAGING_ORIGIN,
    };
    const textBody = template.textBody.replace(
      TRANSFER_PROOF_REVIEW_TEST_ORIGIN,
      TRANSFER_PROOF_REVIEW_STAGING_ORIGIN,
    );
    const htmlBody = template.htmlBody.replace(
      TRANSFER_PROOF_REVIEW_TEST_ORIGIN,
      TRANSFER_PROOF_REVIEW_STAGING_ORIGIN,
    );
    const [digest] = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT transfer_proof_review_envelope_digest(
        ${template.orderId}, ${template.requestId}, ${template.recipient},
        ${template.requestedAt.toISOString()}, ${crossEnvironmentPayload.sellerName},
        ${crossEnvironmentPayload.sellerEmail}, ${crossEnvironmentPayload.eventTitle},
        ${crossEnvironmentPayload.appOrigin}, ${template.subject}, ${textBody}, ${htmlBody}
      ) AS value
    `;

    await expect(prisma.$executeRaw`
      INSERT INTO "TransferProofReviewDeliveryIntent" (
        id, "orderId", "requestId", recipient, subject, "textBody", "htmlBody",
        "requestedAt", "idempotencyKey", "payloadJson", "envelopeDigest", "availableAt"
      ) VALUES (
        ${`cross-environment-${requestId}`}, ${template.orderId}, ${template.requestId},
        ${template.recipient}, ${template.subject}, ${textBody}, ${htmlBody},
        ${template.requestedAt}, ${template.idempotencyKey},
        CAST(${JSON.stringify(crossEnvironmentPayload)} AS JSONB), ${digest.value},
        ${template.requestedAt}
      )
    `).rejects.toThrow("origin does not match the database environment");
    await expect(prisma.transferProofReviewDeliveryIntent.count({ where: { orderId } }))
      .resolves.toBe(0);
  });

  it("makes the environment-binding preflight observe a concurrent predecessor insert", async () => {
    const predecessorSchema = `review_environment_predecessor_${process.pid}_${Date.now()}`;
    const writer = await pool.connect();
    const migrator = await pool.connect();
    let writerCommitted = false;
    try {
      await writer.query(`CREATE SCHEMA "${predecessorSchema}"`);
      await writer.query(`SET search_path TO "${predecessorSchema}"`);
      await migrator.query(`SET search_path TO "${predecessorSchema}"`);
      await writer.query(`
        CREATE TABLE "TransferProofReviewDeliveryIntent" (
          id TEXT PRIMARY KEY,
          "payloadJson" JSONB NOT NULL
        )
      `);
      await writer.query("BEGIN");
      await writer.query(`
        INSERT INTO "TransferProofReviewDeliveryIntent" (id, "payloadJson")
        VALUES ('concurrent-cross-environment', $1::JSONB)
      `, [JSON.stringify({ appOrigin: TRANSFER_PROOF_REVIEW_STAGING_ORIGIN })]);

      const migration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914150000_bind_transfer_proof_review_environment/migration.sql",
      ), "utf8");
      const migratorPid = await migrator.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const applying = migrator.query(migration);
      let waitingOnLock = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await pool.query<{ wait_event_type: string | null }>(`
          SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1
        `, [migratorPid.rows[0].pid]);
        if (activity.rows[0]?.wait_event_type === "Lock") {
          waitingOnLock = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waitingOnLock).toBe(true);

      await writer.query("COMMIT");
      writerCommitted = true;
      await expect(applying).rejects.toThrow(
        "Transfer-proof review origin preflight found cross-environment history",
      );
      await migrator.query("ROLLBACK");
      await expect(migrator.query(`
        SELECT id FROM "TransferProofReviewDeliveryIntent"
      `)).resolves.toMatchObject({ rows: [{ id: "concurrent-cross-environment" }] });
    } finally {
      if (!writerCommitted) await writer.query("ROLLBACK");
      await migrator.query("ROLLBACK");
      await writer.query("SET search_path TO public");
      await migrator.query("SET search_path TO public");
      await pool.query(`DROP SCHEMA "${predecessorSchema}" CASCADE`);
      writer.release();
      migrator.release();
    }
  });

  it("refuses to install the environment binding on an unknown empty database", async () => {
    const unknownDatabase = `review_unknown_${process.pid}_${Date.now()}`;
    const unknownUrl = new URL(databaseUrl);
    unknownUrl.pathname = `/${unknownDatabase}`;
    let unknownPool: Pool | null = null;
    try {
      await pool.query(`CREATE DATABASE "${unknownDatabase}" TEMPLATE template0`);
      unknownPool = new Pool({ connectionString: unknownUrl.toString(), max: 1 });
      await unknownPool.query(`
        CREATE TABLE "TransferProofReviewDeliveryIntent" (
          id TEXT PRIMARY KEY,
          "payloadJson" JSONB NOT NULL
        )
      `);
      const migration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914150000_bind_transfer_proof_review_environment/migration.sql",
      ), "utf8");
      await expect(unknownPool.query(migration)).rejects.toThrow(
        "Unrecognized transfer-proof review database environment",
      );
      await unknownPool.query("ROLLBACK");
      await expect(unknownPool.query(`
        SELECT to_regprocedure('canonical_transfer_proof_review_origin()') AS function
      `)).resolves.toMatchObject({ rows: [{ function: null }] });
    } finally {
      if (unknownPool) await unknownPool.end();
      await pool.query(`DROP DATABASE IF EXISTS "${unknownDatabase}" WITH (FORCE)`);
    }
  });

  it.each(["subject", "textBody", "htmlBody", "payloadJson"] as const)(
    "rejects a directly forged %s under an otherwise canonical request identity",
    async (field) => {
      await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
      const template = await prisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
        where: { requestId },
      });
      await forceDeleteIntents();
      const payload = template.payloadJson as Record<string, unknown>;
      const forgedPayload = field === "payloadJson"
        ? { ...payload, injectedInstruction: "Send this arbitrary content" }
        : payload;
      const subject = field === "subject" ? "Forged review subject" : template.subject;
      const textBody = field === "textBody" ? "Forged review text" : template.textBody;
      const htmlBody = field === "htmlBody" ? "<p>Forged review HTML</p>" : template.htmlBody;
      const digestRows = await prisma.$queryRaw<Array<{ digest: string }>>`
        SELECT transfer_proof_review_envelope_digest(
          ${template.orderId}, ${template.requestId}, ${template.recipient},
          ${template.requestedAt.toISOString()}, ${String(payload.sellerName)},
          ${String(payload.sellerEmail)}, ${String(payload.eventTitle)},
          ${String(payload.appOrigin)}, ${subject}, ${textBody}, ${htmlBody}
        ) AS digest
      `;
      const idempotencyKey = `tft-human-review-${createHash("sha256")
        .update(`${template.orderId}:${template.requestId}:${template.recipient}`)
        .digest("hex")}`;

      await expect(prisma.$executeRaw`
        INSERT INTO "TransferProofReviewDeliveryIntent" (
          id, "orderId", "requestId", recipient, subject, "textBody", "htmlBody",
          "requestedAt", "idempotencyKey", "payloadJson", "envelopeDigest", "availableAt"
        ) VALUES (
          ${`forged-${field}-${requestId}`}, ${template.orderId}, ${template.requestId},
          ${template.recipient}, ${subject}, ${textBody}, ${htmlBody}, ${template.requestedAt},
          ${idempotencyKey}, CAST(${JSON.stringify(forgedPayload)} AS JSONB),
          ${digestRows[0].digest}, ${template.requestedAt}
        )
      `).rejects.toThrow("Transfer-proof review delivery envelope must match the locked review snapshot");
      await expect(prisma.transferProofReviewDeliveryIntent.count({ where: { orderId } }))
        .resolves.toBe(0);
    },
  );

  it("blocks the migration-94 predecessor when an identity-valid body cannot be authenticated", async () => {
    const predecessorSchema = `review_envelope_predecessor_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${predecessorSchema}"`);
      await client.query(`SET search_path TO "${predecessorSchema}"`);
      await client.query(`
        CREATE TABLE "Order" (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          "buyerConfirmationStatus" TEXT,
          "transferVerificationStatus" TEXT,
          "disputeWindowEndsAt" TIMESTAMP(3),
          "transferProofData" TEXT,
          "sellerId" TEXT NOT NULL
        );
        CREATE TABLE "User" (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          "firstName" TEXT NOT NULL,
          "lastName" TEXT NOT NULL,
          "sellerId" TEXT UNIQUE
        );
        CREATE TABLE "EmailDelivery" (
          id TEXT PRIMARY KEY,
          "orderId" TEXT NOT NULL,
          "emailType" TEXT NOT NULL,
          recipient TEXT NOT NULL,
          "sentAt" TIMESTAMP(3) NOT NULL,
          provider TEXT NOT NULL,
          status TEXT NOT NULL,
          error TEXT
        );
      `);
      const predecessorMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914130000_add_transfer_proof_review_delivery_outbox/migration.sql",
      ), "utf8");
      await client.query(predecessorMigration);
      await client.query(`
        INSERT INTO "User" (id, email, "firstName", "lastName", "sellerId")
        VALUES ('seller-user-94', 'seller@example.test', 'Seller', 'Review', 'seller-94');
        WITH origin AS (
          SELECT statement_timestamp() AT TIME ZONE 'UTC' AS requested_at
        )
        INSERT INTO "Order" (
          id, status, "buyerConfirmationStatus", "transferVerificationStatus",
          "disputeWindowEndsAt", "transferProofData", "sellerId"
        )
        SELECT
          'order-94', 'PAID', 'PENDING', 'MANUAL_REVIEW', NULL,
          JSONB_BUILD_OBJECT(
            'manualReviewRequestId', '00000000-0000-4000-8000-000000000095',
            'manualReviewRequestedAt', TO_CHAR(requested_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'requestedByUserId', 'seller-user-94'
          )::TEXT,
          'seller-94'
        FROM origin;
        INSERT INTO "TransferProofReviewDeliveryIntent" (
          id, "orderId", "requestId", recipient, subject, "textBody", "htmlBody",
          "requestedAt", "idempotencyKey", "availableAt"
        )
        SELECT
          'forged-predecessor-94', id,
          "transferProofData"::JSONB ->> 'manualReviewRequestId',
          'support@truefantix.com', 'Forged but nonempty subject',
          'Forged but nonempty text', '<p>Forged but nonempty HTML</p>',
          ("transferProofData"::JSONB ->> 'manualReviewRequestedAt')::TIMESTAMP,
          'tft-human-review-' || ENCODE(SHA256(CONVERT_TO(
            id || ':' || ("transferProofData"::JSONB ->> 'manualReviewRequestId')
              || ':support@truefantix.com', 'UTF8'
          )), 'hex'),
          ("transferProofData"::JSONB ->> 'manualReviewRequestedAt')::TIMESTAMP
        FROM "Order" WHERE id = 'order-94';
      `);

      const envelopeMigration = await readFile(join(
        process.cwd(),
        "prisma/migrations/20260914140000_bind_transfer_proof_review_envelope/migration.sql",
      ), "utf8");
      await expect(client.query(envelopeMigration)).rejects.toThrow(
        "Transfer-proof review envelope preflight requires an empty reconciled outbox",
      );
      await client.query("ROLLBACK");
      await expect(client.query(`
        SELECT subject FROM "TransferProofReviewDeliveryIntent"
        WHERE id = 'forged-predecessor-94'
      `)).resolves.toMatchObject({ rows: [{ subject: "Forged but nonempty subject" }] });
    } finally {
      await client.query("ROLLBACK");
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA "${predecessorSchema}" CASCADE`);
      client.release();
    }
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

  it("quarantines a redigested review envelope whose link origin differs from the current environment", async () => {
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
    const template = await prisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
      where: { requestId },
    });
    const payload = template.payloadJson as {
      sellerName: string;
      sellerEmail: string;
      eventTitle: string;
      appOrigin: string;
    };
    const poisonedOrigin = "https://attacker.example";
    const poisonedPayload = { ...payload, appOrigin: poisonedOrigin };
    const textBody = template.textBody.replaceAll(payload.appOrigin, poisonedOrigin);
    const htmlBody = template.htmlBody.replaceAll(payload.appOrigin, poisonedOrigin);
    const [digest] = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT transfer_proof_review_envelope_digest(
        ${template.orderId}, ${template.requestId}, ${template.recipient},
        ${template.requestedAt.toISOString()}, ${poisonedPayload.sellerName},
        ${poisonedPayload.sellerEmail}, ${poisonedPayload.eventTitle},
        ${poisonedPayload.appOrigin}, ${template.subject}, ${textBody}, ${htmlBody}
      ) AS value
    `;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.transferProofReviewDeliveryIntent.update({
        where: { requestId },
        data: {
          payloadJson: poisonedPayload,
          textBody,
          htmlBody,
          envelopeDigest: digest.value,
        },
      });
    });

    await expect(drainTransferProofReviewDeliveryIntents({ orderId }, prisma))
      .resolves.toMatchObject({ claimed: 1, failed: 1, reconciliationRequired: 1 });
    expect(mockedSendEmail).not.toHaveBeenCalled();
    await expect(prisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
      where: { requestId },
    })).resolves.toMatchObject({
      status: "RECONCILIATION_REQUIRED",
      attemptCount: 0,
      lastError: "Pre-dispatch review delivery failure: Transfer-proof review delivery origin does not match the current environment",
    });
  });

  it("quarantines a redigested review envelope whose recipient is not the support mailbox", async () => {
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
    const template = await prisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
      where: { requestId },
    });
    const payload = template.payloadJson as {
      sellerName: string;
      sellerEmail: string;
      eventTitle: string;
      appOrigin: string;
    };
    const poisonedRecipient = "attacker@example.test";
    const poisonedIdempotencyKey = `tft-human-review-${createHash("sha256")
      .update(`${template.orderId}:${template.requestId}:${poisonedRecipient}`)
      .digest("hex")}`;
    const [digest] = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT transfer_proof_review_envelope_digest(
        ${template.orderId}, ${template.requestId}, ${poisonedRecipient},
        ${template.requestedAt.toISOString()}, ${payload.sellerName},
        ${payload.sellerEmail}, ${payload.eventTitle}, ${payload.appOrigin},
        ${template.subject}, ${template.textBody}, ${template.htmlBody}
      ) AS value
    `;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.transferProofReviewDeliveryIntent.update({
        where: { requestId },
        data: {
          recipient: poisonedRecipient,
          idempotencyKey: poisonedIdempotencyKey,
          envelopeDigest: digest.value,
        },
      });
    });

    await expect(drainTransferProofReviewDeliveryIntents({ orderId }, prisma))
      .resolves.toMatchObject({ claimed: 1, failed: 1, reconciliationRequired: 1 });
    expect(mockedSendEmail).not.toHaveBeenCalled();
    await expect(prisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
      where: { requestId },
    })).resolves.toMatchObject({
      status: "RECONCILIATION_REQUIRED",
      attemptCount: 0,
      lastError: "Pre-dispatch review delivery failure: Transfer-proof review delivery recipient does not match the support mailbox",
    });
  });

  it.each([
    ["approved", "PENDING"],
    ["rejected", "MISMATCHED"],
  ])("quarantines an obsolete review request after it is %s", async (
    _decision,
    transferVerificationStatus,
  ) => {
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
    await prisma.order.update({
      where: { id: orderId },
      data: { transferVerificationStatus },
    });

    await expect(drainTransferProofReviewDeliveryIntents({ orderId }, prisma))
      .resolves.toMatchObject({ claimed: 1, failed: 1, reconciliationRequired: 1 });
    expect(mockedSendEmail).not.toHaveBeenCalled();
    await expect(prisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
      where: { requestId },
    })).resolves.toMatchObject({
      status: "RECONCILIATION_REQUIRED",
      attemptCount: 0,
      processingAt: null,
      leaseExpiresAt: null,
      claimToken: null,
      dispatchStartedAt: null,
      lastError: "Pre-dispatch review delivery failure: Transfer-proof review delivery is no longer awaiting human review",
    });

    await expect(drainTransferProofReviewDeliveryIntents({ orderId }, prisma))
      .resolves.toMatchObject({ claimed: 0, reconciliationRequired: 0 });
    expect(mockedSendEmail).not.toHaveBeenCalled();
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
        if (transactionCall === 3) throw new Error("synthetic persistence failure");
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

  it("does not let an unavailable-provider prefix starve later deliverable work", async () => {
    await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, params()));
    const databaseNow = await databaseUtcNow();
    const expiredLease = new Date(databaseNow.getTime() - 60 * 1000);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.transferProofReviewDeliveryIntent.update({
        where: { requestId },
        data: {
          status: "PROCESSING",
          provider: "SENDGRID",
          processingAt: new Date(expiredLease.getTime() - 15 * 60 * 1000),
          leaseExpiresAt: expiredLease,
          claimToken: `unavailable-prefix-${requestId}`,
          availableAt: new Date(databaseNow.getTime() - 60 * 60 * 1000),
        },
      });
    });

    const deliverableOrderId = `${orderId}-deliverable`;
    const deliverableRequestId = randomUUID();
    const deliverableRequestedAt = await databaseUtcNow();
    await prisma.order.create({ data: {
      id: deliverableOrderId,
      sellerId,
      buyerSellerId,
      status: "PAID",
      amountCents: 100,
      adminFeeCents: 10,
      totalCents: 110,
      transferProofType: "Screenshot",
      transferProofData: JSON.stringify({
        sellerNote: "Synthetic deliverable review",
        proofUpload: "synthetic-proof",
        manualReviewRequestId: deliverableRequestId,
        manualReviewRequestedAt: deliverableRequestedAt.toISOString(),
        requestedByUserId: sellerUserId,
      }),
      transferVerificationStatus: "MANUAL_REVIEW",
      buyerConfirmationStatus: "PENDING",
    } });
    try {
      await prisma.$transaction((tx) => stageTransferProofReviewDeliveryIntent(tx, {
        orderId: deliverableOrderId,
        requestId: deliverableRequestId,
        recipient: "support@truefantix.com",
        sellerName: "Seller Review",
        sellerEmail: `review-delivery-${runId}@example.test`,
        eventTitle: "Ticket order",
        requestedAt: deliverableRequestedAt,
      }));

      await expect(drainTransferProofReviewDeliveryIntents({ limit: 1 }, prisma))
        .resolves.toMatchObject({ scanned: 1, claimed: 1, delivered: 1 });
      expect(mockedSendEmail).toHaveBeenCalledTimes(1);
      await expect(prisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
        where: { requestId: deliverableRequestId },
      })).resolves.toMatchObject({ status: "DELIVERED", provider: "RESEND" });
      await expect(prisma.transferProofReviewDeliveryIntent.findUniqueOrThrow({
        where: { requestId },
      })).resolves.toMatchObject({
        status: "PROCESSING",
        provider: "SENDGRID",
        claimToken: `unavailable-prefix-${requestId}`,
      });
    } finally {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await tx.transferProofReviewDeliveryIntent.deleteMany({ where: { orderId: deliverableOrderId } });
      });
      await prisma.emailDelivery.deleteMany({ where: { orderId: deliverableOrderId } });
      await prisma.order.delete({ where: { id: deliverableOrderId } });
    }
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
