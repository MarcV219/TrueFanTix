/** @jest-environment node */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { prisma } from "@/lib/prisma";
import {
  buildOutreachReplyForwardIntent,
  drainOutreachReplyForwardIntents,
  outreachReplyForwardingConfig,
} from "@/lib/outreach-reply-forwarding";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) describe.skip("outreach reply forwarding PostgreSQL boundary", () => {
  it("requires an isolated database", () => undefined);
}); else describe("outreach reply forwarding PostgreSQL boundary", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const runId = `${Date.now()}-${process.pid}`;
  const campaignId = `reply-forward-campaign-${runId}`;
  const contactId = `reply-forward-contact-${runId}`;
  const recipientId = `reply-forward-recipient-${runId}`;
  let sequence = 0;

  const accepted = (messageId: string) => new Response(JSON.stringify({ id: messageId }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  async function seedIntent(options: {
    subject?: string;
    textBody?: string;
    status?: "PENDING" | "PROCESSING" | "DELIVERED" | "FAILED" | "RECONCILIATION_REQUIRED" | "QUARANTINED";
    attemptCount?: number;
    claimToken?: string | null;
    claimExpiresAt?: Date | null;
    providerDispatchAt?: Date | null;
    providerMessageId?: string | null;
    failureCode?: string | null;
    completedAt?: Date | null;
  } = {}) {
    const id = ++sequence;
    const providerEmailId = `inbound-forward-${runId}-${id}`;
    const subject = options.subject ?? `Synthetic reply ${id}`;
    const textBody = options.textBody ?? "Synthetic plain-text reply.";
    const config = outreachReplyForwardingConfig();
    if (!config) throw new Error("Synthetic forward configuration is missing.");
    const envelope = buildOutreachReplyForwardIntent({
      providerEmailId,
      fromEmail: "fan@example.test",
      subject,
      textBody,
      htmlBody: null,
      attachmentCount: 0,
      receivedAt: new Date("2026-09-16T15:00:00.000Z"),
    }, config);
    const reply = await prisma.outreachReply.create({
      data: {
        id: `reply-forward-${runId}-${id}`,
        providerEmailId,
        recipientId,
        contactId,
        fromEmail: "fan@example.test",
        toEmail: "reply+synthetic@replies.truefantix.com",
        subject,
        textBody,
        receivedAt: new Date("2026-09-16T15:00:00.000Z"),
        forwardIntent: { create: {
          id: `reply-forward-intent-${runId}-${id}`,
          ...envelope,
        } },
      },
      include: { forwardIntent: true },
    });
    if (options.status && options.status !== "PENDING") {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await tx.outreachReplyForwardIntent.update({
          where: { replyId: reply.id },
          data: {
            status: options.status,
            attemptCount: options.attemptCount,
            claimToken: options.claimToken,
            claimExpiresAt: options.claimExpiresAt,
            providerDispatchAt: options.providerDispatchAt,
            providerMessageId: options.providerMessageId,
            failureCode: options.failureCode,
            completedAt: options.completedAt,
          },
        });
      });
    }
    return reply;
  }

  beforeAll(async () => {
    process.env.OUTREACH_RESEND_INBOUND_API_KEY = "re_synthetic_forward";
    process.env.OUTREACH_REPLY_FORWARD_TO = "owner@example.test";
    process.env.OUTREACH_FROM_EMAIL = "marc@truefantix.com";
    await prisma.outreachCampaign.create({
      data: {
        id: campaignId,
        name: `Synthetic reply forwarding ${runId}`,
        subject: "Synthetic",
        bodyText: "Synthetic",
        createdById: `synthetic-admin-${runId}`,
      },
    });
    await prisma.outreachContact.create({
      data: {
        id: contactId,
        externalKey: `reply-forward-${runId}`,
        category: "SYNTHETIC_TEST",
        email: "fan@example.test",
        normalizedEmail: "fan@example.test",
      },
    });
    await prisma.outreachRecipient.create({
      data: {
        id: recipientId,
        campaignId,
        contactId,
        emailSnapshot: "fan@example.test",
        subjectSnapshot: "Synthetic",
        bodyTextSnapshot: "Synthetic",
      },
    });
  });

  afterAll(async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.outreachReplyForwardIntent.deleteMany({ where: { reply: { recipientId } } });
      await tx.outreachReply.deleteMany({ where: { recipientId } });
      await tx.outreachRecipient.deleteMany({ where: { id: recipientId } });
      await tx.outreachCampaign.deleteMany({ where: { id: campaignId } });
      await tx.outreachContact.deleteMany({ where: { id: contactId } });
    });
    delete process.env.OUTREACH_RESEND_INBOUND_API_KEY;
    delete process.env.OUTREACH_REPLY_FORWARD_TO;
    delete process.env.OUTREACH_FROM_EMAIL;
    await pool.end();
  });

  it("recovers a committed pending intent and persists exact acceptance atomically", async () => {
    const reply = await seedIntent();
    const fetchImpl = jest.fn().mockResolvedValue(accepted(`forwarded-${runId}-1`));

    await expect(drainOutreachReplyForwardIntents({
      providerEmailId: reply.providerEmailId,
      limit: 1,
      fetchImpl,
    })).resolves.toMatchObject({ claimed: 1, delivered: 1 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: reply.id },
    })).resolves.toMatchObject({
      status: "DELIVERED",
      attemptCount: 1,
      providerMessageId: `forwarded-${runId}-1`,
    });
    expect((await prisma.outreachReply.findUniqueOrThrow({ where: { id: reply.id } })).forwardedAt)
      .toBeInstanceOf(Date);
  });

  it("agrees with PostgreSQL idempotency derivation for Unicode and delimiters", async () => {
    const reply = await seedIntent({
      subject: "Résumé 😀 2:α",
      textBody: "one:two\u001fthree\n四",
    });
    await expect(prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: reply.id },
    })).resolves.toMatchObject({
      idempotencyKey: expect.stringMatching(/^tft-outreach-reply-forward-v1-[a-f0-9]{64}$/),
      status: "PENDING",
    });
  });

  it("owns origin, lease, dispatch, and update clocks independently of session timezone", async () => {
    const id = ++sequence;
    const providerEmailId = `inbound-forward-${runId}-${id}`;
    const replyId = `reply-forward-${runId}-${id}`;
    const intentId = `reply-forward-intent-${runId}-${id}`;
    const config = outreachReplyForwardingConfig();
    if (!config) throw new Error("Synthetic forward configuration is missing.");
    const envelope = buildOutreachReplyForwardIntent({
      providerEmailId,
      fromEmail: "fan@example.test",
      subject: "Timezone-independent clocks",
      textBody: "Synthetic plain-text reply.",
      htmlBody: null,
      attachmentCount: 0,
      receivedAt: new Date("2026-09-16T15:00:00.000Z"),
    }, config);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'America/Los_Angeles'");
      await tx.outreachReply.create({ data: {
        id: replyId,
        providerEmailId,
        recipientId,
        contactId,
        fromEmail: "fan@example.test",
        toEmail: "reply+synthetic@replies.truefantix.com",
        subject: "Timezone-independent clocks",
        textBody: "Synthetic plain-text reply.",
        receivedAt: new Date("2026-09-16T15:00:00.000Z"),
        forwardIntent: { create: { id: intentId, ...envelope } },
      } });
      await expect(tx.$queryRaw<Array<{ databaseOwned: boolean; aligned: boolean }>>`
        SELECT
          "createdAt" BETWEEN
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 seconds'
            AND (statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '5 seconds'
            AS "databaseOwned",
          "createdAt" = "updatedAt" AND "createdAt" = "availableAt" AS aligned
        FROM "OutreachReplyForwardIntent" WHERE "id" = ${intentId}
      `).resolves.toEqual([{ databaseOwned: true, aligned: true }]);

      const claimToken = `timezone-claim-${runId}`;
      await expect(tx.$queryRaw<Array<{ leaseOwned: boolean; updateOwned: boolean }>>`
        UPDATE "OutreachReplyForwardIntent"
        SET "status" = 'PROCESSING',
            "claimToken" = ${claimToken},
            "claimExpiresAt" = (statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '15 minutes',
            "updatedAt" = TIMESTAMP '2001-01-01 00:00:00'
        WHERE "id" = ${intentId}
        RETURNING
          "claimExpiresAt" = ((statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '15 minutes')::TIMESTAMP(3)
            AS "leaseOwned",
          "updatedAt" BETWEEN
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 seconds'
            AND (statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '5 seconds'
            AS "updateOwned"
      `).resolves.toEqual([{ leaseOwned: true, updateOwned: true }]);

      await expect(tx.$queryRaw<Array<{ dispatchOwned: boolean }>>`
        UPDATE "OutreachReplyForwardIntent"
        SET "attemptCount" = 1,
            "providerDispatchAt" = (statement_timestamp() AT TIME ZONE 'UTC'),
            "updatedAt" = TIMESTAMP '2099-01-01 00:00:00'
        WHERE "id" = ${intentId}
        RETURNING "providerDispatchAt" = (statement_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3)
          AS "dispatchOwned"
      `).resolves.toEqual([{ dispatchOwned: true }]);
    });
  });

  it("rejects dispatch and authoritative provider results after the worker lease expires", async () => {
    const expired = new Date("2020-01-01T00:00:00.000Z");
    const preDispatch = await seedIntent({
      status: "PROCESSING",
      attemptCount: 0,
      claimToken: `expired-dispatch-${runId}`,
      claimExpiresAt: expired,
    });
    const preDispatchIntent = await prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: preDispatch.id },
    });
    await expect(prisma.$executeRaw`
      UPDATE "OutreachReplyForwardIntent"
      SET "attemptCount" = 1,
          "providerDispatchAt" = (statement_timestamp() AT TIME ZONE 'UTC'),
          "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
      WHERE "id" = ${preDispatchIntent.id}
    `).rejects.toThrow();

    const dispatched = await seedIntent({
      status: "PROCESSING",
      attemptCount: 1,
      claimToken: `expired-result-${runId}`,
      claimExpiresAt: expired,
      providerDispatchAt: expired,
    });
    const dispatchedIntent = await prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: dispatched.id },
    });
    await expect(prisma.$executeRaw`
      UPDATE "OutreachReplyForwardIntent"
      SET "status" = 'DELIVERED',
          "providerMessageId" = ${`expired-result-${runId}`},
          "completedAt" = (statement_timestamp() AT TIME ZONE 'UTC'),
          "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
      WHERE "id" = ${dispatchedIntent.id}
    `).rejects.toThrow();
    await expect(prisma.$executeRaw`
      UPDATE "OutreachReplyForwardIntent"
      SET "status" = 'FAILED',
          "failureCode" = 'RESEND_FORWARD_REJECTED',
          "completedAt" = (statement_timestamp() AT TIME ZONE 'UTC'),
          "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
      WHERE "id" = ${dispatchedIntent.id}
    `).rejects.toThrow();
    await expect(prisma.$executeRaw`
      UPDATE "OutreachReplyForwardIntent"
      SET "status" = 'RECONCILIATION_REQUIRED',
          "failureCode" = 'RESEND_FORWARD_TIMEOUT',
          "completedAt" = (statement_timestamp() AT TIME ZONE 'UTC'),
          "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
      WHERE "id" = ${dispatchedIntent.id}
    `).rejects.toThrow();
    await expect(prisma.$executeRaw`
      UPDATE "OutreachReplyForwardIntent"
      SET "status" = 'RECONCILIATION_REQUIRED',
          "failureCode" = 'FORWARD_CLAIM_EXPIRED_AFTER_DISPATCH',
          "completedAt" = (statement_timestamp() AT TIME ZONE 'UTC'),
          "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
      WHERE "id" = ${dispatchedIntent.id}
    `).resolves.toBe(1);
  });

  it("installs the UTC clock and live-lease fence as a forward-only upgrade", async () => {
    const upgradeSchema = `outreach_forward_clock_${process.pid}_${Date.now()}`;
    const client = await pool.connect();
    const migration113 = await readFile(join(
      process.cwd(),
      "prisma/migrations/20260916182000_add_outreach_reply_forward_intents/migration.sql",
    ), "utf8");
    const migration114 = await readFile(join(
      process.cwd(),
      "prisma/migrations/20260916190000_fence_outreach_reply_forward_clock/migration.sql",
    ), "utf8");
    const insertReply = (id: string) => client.query(`
      INSERT INTO "OutreachReply" (
        id, "providerEmailId", "recipientId", "contactId", "fromEmail", "toEmail",
        subject, "textBody", "receivedAt", "attachmentCount"
      ) VALUES (
        $1, $2, 'recipient', 'contact', 'fan@example.test',
        'reply+synthetic@replies.truefantix.com', 'Synthetic', 'Body',
        TIMESTAMP '2026-09-16 15:00:00', 0
      )
    `, [`${id}-reply`, `${id}-provider`]);
    const insertIntent = (id: string) => client.query(`
      INSERT INTO "OutreachReplyForwardIntent" (
        id, "updatedAt", "replyId", "providerEmailId", "fromEmailSnapshot",
        "toEmailSnapshot", "subjectSnapshot", "textBodySnapshot", "attachmentCount",
        "idempotencyKey"
      ) VALUES (
        $1, CURRENT_TIMESTAMP, $2, $3, 'marc@truefantix.com',
        'owner@example.test', 'Outreach reply: Synthetic', 'Body', 0,
        outreach_reply_forward_idempotency_key(
          $3, 'marc@truefantix.com', 'owner@example.test',
          'Outreach reply: Synthetic', 'Body', 0
        )
      )
    `, [id, `${id}-reply`, `${id}-provider`]);

    try {
      await client.query(`CREATE SCHEMA "${upgradeSchema}"`);
      await client.query(`SET search_path TO "${upgradeSchema}", public`);
      await client.query(`
        CREATE TABLE "OutreachReply" (
          id TEXT PRIMARY KEY,
          "providerEmailId" TEXT NOT NULL UNIQUE,
          "providerMessageId" TEXT,
          "recipientId" TEXT NOT NULL,
          "contactId" TEXT NOT NULL,
          "fromEmail" TEXT NOT NULL,
          "toEmail" TEXT NOT NULL,
          subject TEXT NOT NULL,
          "textBody" TEXT,
          "htmlBody" TEXT,
          "receivedAt" TIMESTAMP(3) NOT NULL,
          "attachmentCount" INTEGER NOT NULL,
          "forwardedAt" TIMESTAMP(3)
        )
      `);
      await client.query(migration113);
      await client.query("SET TIME ZONE 'America/Los_Angeles'");

      await insertReply("permissive");
      await insertIntent("permissive");
      await client.query(`
        UPDATE "OutreachReplyForwardIntent"
        SET status = 'PROCESSING', "claimToken" = 'permissive-claim',
            "claimExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '15 minutes',
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = 'permissive'
      `);
      await client.query(`ALTER TABLE "OutreachReplyForwardIntent" DISABLE TRIGGER "OutreachReplyForwardIntent_guard"`);
      await client.query(`
        UPDATE "OutreachReplyForwardIntent"
        SET "claimExpiresAt" = TIMESTAMP '2001-01-01 00:00:00'
        WHERE id = 'permissive'
      `);
      await client.query(`ALTER TABLE "OutreachReplyForwardIntent" ENABLE TRIGGER "OutreachReplyForwardIntent_guard"`);
      await expect(client.query(`
        UPDATE "OutreachReplyForwardIntent"
        SET "attemptCount" = 1, "providerDispatchAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = 'permissive'
      `)).resolves.toBeDefined();
      await expect(client.query(`
        UPDATE "OutreachReplyForwardIntent"
        SET status = 'DELIVERED', "providerMessageId" = 'permissive-message',
            "completedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = 'permissive'
      `)).resolves.toBeDefined();
      await expect(client.query(`
        SELECT status FROM "OutreachReplyForwardIntent" WHERE id = 'permissive'
      `)).resolves.toMatchObject({ rows: [{ status: "DELIVERED" }] });

      await client.query("SET TIME ZONE 'UTC'");
      for (const id of [
        "upgrade-live-dispatch",
        "upgrade-expired-dispatch",
        "upgrade-live-result",
        "upgrade-expired-result",
      ]) {
        await insertReply(id);
        await insertIntent(id);
        await client.query(`
          UPDATE "OutreachReplyForwardIntent"
          SET status = 'PROCESSING', "claimToken" = $2,
              "claimExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '15 minutes',
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [id, `${id}-claim`]);
      }
      await client.query(`
        UPDATE "OutreachReplyForwardIntent"
        SET "attemptCount" = 1, "providerDispatchAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id IN ('upgrade-live-result', 'upgrade-expired-result')
      `);
      await client.query(`ALTER TABLE "OutreachReplyForwardIntent" DISABLE TRIGGER "OutreachReplyForwardIntent_guard"`);
      await client.query(`
        UPDATE "OutreachReplyForwardIntent"
        SET "claimExpiresAt" = TIMESTAMP '2001-01-01 00:00:00'
        WHERE id IN ('upgrade-expired-dispatch', 'upgrade-expired-result')
      `);
      await client.query(`ALTER TABLE "OutreachReplyForwardIntent" ENABLE TRIGGER "OutreachReplyForwardIntent_guard"`);
      const activeBefore = await client.query<{ snapshot: string }>(`
        SELECT row_to_json(i)::text AS snapshot
        FROM "OutreachReplyForwardIntent" i
        WHERE id LIKE 'upgrade-%'
        ORDER BY id
      `);

      await client.query(migration114);
      const activeAfter = await client.query<{ snapshot: string }>(`
        SELECT row_to_json(i)::text AS snapshot
        FROM "OutreachReplyForwardIntent" i
        WHERE id LIKE 'upgrade-%'
        ORDER BY id
      `);
      expect(activeAfter.rows).toEqual(activeBefore.rows);

      await client.query("SET TIME ZONE 'America/Los_Angeles'");
      await insertReply("strict-clock");
      await insertIntent("strict-clock");
      await expect(client.query(`
        SELECT
          "createdAt" BETWEEN
            (statement_timestamp() AT TIME ZONE 'UTC') - INTERVAL '5 seconds'
            AND (statement_timestamp() AT TIME ZONE 'UTC') + INTERVAL '5 seconds'
            AS utc_owned
        FROM "OutreachReplyForwardIntent" WHERE id = 'strict-clock'
      `)).resolves.toMatchObject({ rows: [{ utc_owned: true }] });
      await expect(client.query(`
        UPDATE "OutreachReplyForwardIntent"
        SET "attemptCount" = 1,
            "providerDispatchAt" = (statement_timestamp() AT TIME ZONE 'UTC'),
            "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
        WHERE id = 'upgrade-expired-dispatch'
      `)).rejects.toThrow(/invalid pre-dispatch outreach reply forward transition/);
      await expect(client.query(`
        UPDATE "OutreachReplyForwardIntent"
        SET status = 'PENDING', "claimToken" = NULL, "claimExpiresAt" = NULL,
            "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
        WHERE id = 'upgrade-expired-dispatch'
        RETURNING status, "attemptCount", "claimToken", "claimExpiresAt",
                  "providerDispatchAt", "completedAt"
      `)).resolves.toMatchObject({ rows: [{
        status: "PENDING",
        attemptCount: 0,
        claimToken: null,
        claimExpiresAt: null,
        providerDispatchAt: null,
        completedAt: null,
      }] });
      await expect(client.query(`
        UPDATE "OutreachReplyForwardIntent"
        SET "attemptCount" = 1,
            "providerDispatchAt" = (statement_timestamp() AT TIME ZONE 'UTC'),
            "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
        WHERE id = 'upgrade-live-dispatch'
      `)).resolves.toBeDefined();
      await expect(client.query(`
        UPDATE "OutreachReplyForwardIntent"
        SET status = 'DELIVERED', "providerMessageId" = 'strict-message',
            "completedAt" = (statement_timestamp() AT TIME ZONE 'UTC'),
            "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
        WHERE id = 'upgrade-expired-result'
      `)).rejects.toThrow(/expired outreach reply forward claim/);
      await expect(client.query(`
        UPDATE "OutreachReplyForwardIntent"
        SET status = 'FAILED', "failureCode" = 'RESEND_FORWARD_REJECTED',
            "completedAt" = (statement_timestamp() AT TIME ZONE 'UTC'),
            "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
        WHERE id = 'upgrade-expired-result'
      `)).rejects.toThrow(/expired outreach reply forward claim/);
      await expect(client.query(`
        UPDATE "OutreachReplyForwardIntent"
        SET status = 'RECONCILIATION_REQUIRED',
            "failureCode" = 'RESEND_FORWARD_TIMEOUT',
            "completedAt" = (statement_timestamp() AT TIME ZONE 'UTC'),
            "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
        WHERE id = 'upgrade-expired-result'
      `)).rejects.toThrow(/expired outreach reply forward claim/);
      await expect(client.query(`
        UPDATE "OutreachReplyForwardIntent"
        SET status = 'RECONCILIATION_REQUIRED',
            "failureCode" = 'FORWARD_CLAIM_EXPIRED_AFTER_DISPATCH',
            "completedAt" = (statement_timestamp() AT TIME ZONE 'UTC'),
            "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
        WHERE id = 'upgrade-live-result'
      `)).rejects.toThrow(/live outreach reply forward claim cannot use expired-lease recovery/);
      await expect(client.query(`
        UPDATE "OutreachReplyForwardIntent"
        SET status = 'DELIVERED', "providerMessageId" = 'upgrade-live-message',
            "completedAt" = (statement_timestamp() AT TIME ZONE 'UTC'),
            "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
        WHERE id = 'upgrade-live-result'
      `)).resolves.toBeDefined();
      await expect(client.query(`
        UPDATE "OutreachReplyForwardIntent"
        SET status = 'RECONCILIATION_REQUIRED',
            "failureCode" = 'FORWARD_CLAIM_EXPIRED_AFTER_DISPATCH',
            "completedAt" = (statement_timestamp() AT TIME ZONE 'UTC'),
            "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
        WHERE id = 'upgrade-expired-result'
      `)).resolves.toBeDefined();
    } finally {
      await client.query("SET TIME ZONE 'UTC'");
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE`);
      client.release();
    }
  });

  it("permits only one provider dispatch under concurrent drains", async () => {
    const reply = await seedIntent();
    const fetchImpl = jest.fn().mockResolvedValue(accepted(`forwarded-${runId}-2`));

    await Promise.all([
      drainOutreachReplyForwardIntents({ providerEmailId: reply.providerEmailId, limit: 1, fetchImpl }),
      drainOutreachReplyForwardIntents({ providerEmailId: reply.providerEmailId, limit: 1, fetchImpl }),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: reply.id },
    })).resolves.toMatchObject({ status: "DELIVERED", attemptCount: 1 });
  });

  it.each([
    ["acceptance", () => accepted(`late-acceptance-${runId}`), false],
    ["explicit rejection", () => new Response(null, { status: 422 }), true],
  ])("does not persist late provider %s after the owned lease expires", async (
    _label,
    providerResponse,
    rejectsDrain,
  ) => {
    const reply = await seedIntent();
    let providerStarted!: () => void;
    let releaseProvider!: (response: Response) => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    const fetchImpl = jest.fn(() => {
      providerStarted();
      return new Promise<Response>((resolve) => { releaseProvider = resolve; });
    });
    const firstDrain = drainOutreachReplyForwardIntents({
      providerEmailId: reply.providerEmailId,
      limit: 1,
      fetchImpl,
    });
    await started;
    const processing = await prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: reply.id },
    });
    expect(processing).toMatchObject({ status: "PROCESSING", attemptCount: 1 });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.outreachReplyForwardIntent.update({
        where: { id: processing.id },
        data: { claimExpiresAt: new Date("2001-01-01T00:00:00.000Z") },
      });
    });
    releaseProvider(providerResponse());
    if (rejectsDrain) await expect(firstDrain).rejects.toThrow();
    else await expect(firstDrain).resolves.toBeDefined();

    await expect(prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: reply.id },
    })).resolves.toMatchObject({
      status: "PROCESSING",
      attemptCount: 1,
      providerMessageId: null,
      failureCode: null,
      completedAt: null,
    });
    await expect(prisma.outreachReply.findUniqueOrThrow({ where: { id: reply.id } }))
      .resolves.toMatchObject({ forwardedAt: null });

    await drainOutreachReplyForwardIntents({
      providerEmailId: reply.providerEmailId,
      limit: 1,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: reply.id },
    })).resolves.toMatchObject({
      status: "RECONCILIATION_REQUIRED",
      failureCode: "FORWARD_CLAIM_EXPIRED_AFTER_DISPATCH",
      providerMessageId: null,
    });
    await expect(prisma.outreachReply.findUniqueOrThrow({ where: { id: reply.id } }))
      .resolves.toMatchObject({ forwardedAt: null });
  });

  it.each([
    ["is removed", () => delete process.env.OUTREACH_REPLY_FORWARD_TO],
    ["changes", () => { process.env.OUTREACH_REPLY_FORWARD_TO = "changed@example.test"; }],
  ])("quarantines attempt zero when forwarding configuration %s", async (_label, driftConfig) => {
    const reply = await seedIntent();
    driftConfig();
    const fetchImpl = jest.fn();

    await expect(drainOutreachReplyForwardIntents({
      providerEmailId: reply.providerEmailId,
      limit: 1,
      fetchImpl,
    })).resolves.toMatchObject({ claimed: 0, quarantined: 1 });

    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: reply.id },
    })).resolves.toMatchObject({
      status: "QUARANTINED",
      attemptCount: 0,
      failureCode: "FORWARD_CONFIGURATION_DRIFT",
    });
    await drainOutreachReplyForwardIntents({
      providerEmailId: reply.providerEmailId,
      limit: 1,
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    process.env.OUTREACH_REPLY_FORWARD_TO = "owner@example.test";
  });

  it("rejects envelope mutation and deletion at the database boundary", async () => {
    const reply = await seedIntent();
    const intent = await prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: reply.id },
    });

    await expect(prisma.outreachReplyForwardIntent.update({
      where: { id: intent.id },
      data: { subjectSnapshot: "forged subject" },
    })).rejects.toThrow();
    await expect(prisma.outreachReplyForwardIntent.delete({
      where: { id: intent.id },
    })).rejects.toThrow();
    await expect(prisma.outreachReply.update({
      where: { id: reply.id },
      data: { subject: "forged source subject" },
    })).rejects.toThrow();
    await expect(prisma.outreachReply.update({
      where: { id: reply.id },
      data: { forwardedAt: new Date() },
    })).rejects.toThrow();
  });

  it("rejects forged terminal origin and cross-classified terminal outcomes", async () => {
    const forgedId = ++sequence;
    const providerEmailId = `inbound-forward-${runId}-${forgedId}`;
    const replyId = `reply-forward-${runId}-${forgedId}`;
    const intentId = `reply-forward-intent-${runId}-${forgedId}`;
    const config = outreachReplyForwardingConfig();
    if (!config) throw new Error("Synthetic forward configuration is missing.");
    const envelope = buildOutreachReplyForwardIntent({
      providerEmailId,
      fromEmail: "fan@example.test",
      subject: "Forged terminal origin",
      textBody: "Synthetic plain-text reply.",
      htmlBody: null,
      attachmentCount: 0,
      receivedAt: new Date("2026-09-16T15:00:00.000Z"),
    }, config);
    await prisma.outreachReply.create({ data: {
      id: replyId,
      providerEmailId,
      recipientId,
      contactId,
      fromEmail: "fan@example.test",
      toEmail: "reply+synthetic@replies.truefantix.com",
      subject: "Forged terminal origin",
      textBody: "Synthetic plain-text reply.",
      receivedAt: new Date("2026-09-16T15:00:00.000Z"),
    } });

    await expect(prisma.$executeRaw`
      INSERT INTO "OutreachReplyForwardIntent" (
        "id", "createdAt", "updatedAt", "replyId", "providerEmailId",
        "fromEmailSnapshot", "toEmailSnapshot", "subjectSnapshot", "textBodySnapshot",
        "attachmentCount", "idempotencyKey", "status", "availableAt", "attemptCount",
        "claimToken", "claimExpiresAt", "providerDispatchAt", "providerMessageId",
        "failureCode", "completedAt"
      ) VALUES (
        ${intentId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${replyId}, ${providerEmailId},
        ${envelope.fromEmailSnapshot}, ${envelope.toEmailSnapshot}, ${envelope.subjectSnapshot},
        ${envelope.textBodySnapshot}, ${envelope.attachmentCount}, ${envelope.idempotencyKey},
        'FAILED', CURRENT_TIMESTAMP, 1, ${`forged-${runId}`},
        CURRENT_TIMESTAMP + INTERVAL '15 minutes', CURRENT_TIMESTAMP, NULL,
        'RESEND_FORWARD_REJECTED', CURRENT_TIMESTAMP
      )
    `).rejects.toThrow();

    const processing = await seedIntent({
      status: "PROCESSING",
      attemptCount: 1,
      claimToken: `classification-${runId}`,
      claimExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      providerDispatchAt: new Date("2026-09-16T15:00:00.000Z"),
    });
    const processingIntent = await prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: processing.id },
    });
    await expect(prisma.$executeRaw`
      UPDATE "OutreachReplyForwardIntent"
      SET "status" = 'FAILED', "failureCode" = 'RESEND_FORWARD_TIMEOUT',
          "completedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${processingIntent.id}
    `).rejects.toThrow();
    await expect(prisma.$executeRaw`
      UPDATE "OutreachReplyForwardIntent"
      SET "status" = 'RECONCILIATION_REQUIRED', "failureCode" = 'RESEND_FORWARD_REJECTED',
          "completedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${processingIntent.id}
    `).rejects.toThrow();
  });

  it("quarantines an oversized multibyte envelope before attempt one without replay", async () => {
    const reply = await seedIntent({ textBody: "😀".repeat(40_000) });
    const fetchImpl = jest.fn();

    await drainOutreachReplyForwardIntents({
      providerEmailId: reply.providerEmailId,
      limit: 1,
      fetchImpl,
    });
    await drainOutreachReplyForwardIntents({
      providerEmailId: reply.providerEmailId,
      limit: 1,
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: reply.id },
    })).resolves.toMatchObject({
      status: "QUARANTINED",
      attemptCount: 0,
      providerDispatchAt: null,
      failureCode: "FORWARD_LOCAL_ENVELOPE_INVALID",
    });
  });

  it("recovers an expired pre-dispatch lease but quarantines an expired dispatched claim", async () => {
    const expired = new Date("2020-01-01T00:00:00.000Z");
    const preDispatch = await seedIntent({
      status: "PROCESSING",
      attemptCount: 0,
      claimToken: `expired-pre-${runId}`,
      claimExpiresAt: expired,
    });
    const dispatched = await seedIntent({
      status: "PROCESSING",
      attemptCount: 1,
      claimToken: `expired-post-${runId}`,
      claimExpiresAt: expired,
      providerDispatchAt: expired,
    });
    const fetchImpl = jest.fn().mockResolvedValue(accepted(`forwarded-${runId}-3`));

    await drainOutreachReplyForwardIntents({
      providerEmailId: preDispatch.providerEmailId,
      limit: 1,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: preDispatch.id },
    })).resolves.toMatchObject({ status: "DELIVERED" });
    await expect(prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: dispatched.id },
    })).resolves.toMatchObject({
      status: "RECONCILIATION_REQUIRED",
      failureCode: "FORWARD_CLAIM_EXPIRED_AFTER_DISPATCH",
    });
  });

  it("persists a 429 retry and later delivers the identical idempotent envelope exactly once", async () => {
    const reply = await seedIntent();
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 429,
        headers: { "retry-after": "60" },
      }))
      .mockResolvedValueOnce(accepted(`forwarded-after-rate-limit-${runId}`));

    await expect(drainOutreachReplyForwardIntents({
      providerEmailId: reply.providerEmailId,
      limit: 1,
      fetchImpl,
    })).resolves.toMatchObject({ claimed: 1, delivered: 0, failed: 0 });

    const retry = await prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: reply.id },
    });
    expect(retry).toMatchObject({
      status: "PENDING",
      attemptCount: 0,
      retryCount: 1,
      failureCode: "RESEND_FORWARD_RATE_LIMITED",
      claimToken: null,
      claimExpiresAt: null,
      providerDispatchAt: null,
    });
    expect(retry.availableAt.getTime()).toBeGreaterThan(retry.updatedAt.getTime());

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.outreachReplyForwardIntent.update({
        where: { id: retry.id },
        data: { availableAt: new Date("2020-01-01T00:00:00.000Z") },
      });
    });

    await expect(drainOutreachReplyForwardIntents({
      providerEmailId: reply.providerEmailId,
      limit: 1,
      fetchImpl,
    })).resolves.toMatchObject({ claimed: 1, delivered: 1 });
    await drainOutreachReplyForwardIntents({
      providerEmailId: reply.providerEmailId,
      limit: 1,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const requests = fetchImpl.mock.calls.map(([, init]) => init as RequestInit);
    expect(requests[1].headers).toEqual(requests[0].headers);
    expect(requests[1].body).toBe(requests[0].body);
    await expect(prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: reply.id },
    })).resolves.toMatchObject({
      status: "DELIVERED",
      retryCount: 1,
      providerMessageId: `forwarded-after-rate-limit-${runId}`,
      failureCode: null,
    });
  });

  it.each([
    ["409", new Response(null, { status: 409 }), "RECONCILIATION_REQUIRED", "RESEND_FORWARD_CONCURRENT_IDEMPOTENCY"],
    ["explicit 422", new Response(null, { status: 422 }), "FAILED", "RESEND_FORWARD_REJECTED"],
    ["503", new Response(null, { status: 503 }), "RECONCILIATION_REQUIRED", "RESEND_FORWARD_HTTP_UNCERTAIN"],
    ["malformed 2xx", new Response("{}", { status: 200, headers: { "content-type": "application/json" } }), "RECONCILIATION_REQUIRED", "RESEND_FORWARD_ACCEPTANCE_INVALID"],
  ])("records %s without replay", async (_label, response, status, failureCode) => {
    const reply = await seedIntent();
    const fetchImpl = jest.fn().mockResolvedValue(response);

    await drainOutreachReplyForwardIntents({
      providerEmailId: reply.providerEmailId,
      limit: 1,
      fetchImpl,
    });
    await drainOutreachReplyForwardIntents({
      providerEmailId: reply.providerEmailId,
      limit: 1,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: reply.id },
    })).resolves.toMatchObject({ status, failureCode, attemptCount: 1 });
  });

  it.each([
    [
      "network failure",
      () => jest.fn().mockRejectedValue(new Error("synthetic network failure")),
      undefined,
      "RESEND_FORWARD_TRANSPORT_UNCERTAIN",
    ],
    [
      "timeout",
      () => jest.fn().mockImplementation(() => new Promise<Response>(() => undefined)),
      5,
      "RESEND_FORWARD_TIMEOUT",
    ],
  ])("persists ambiguous %s without replay", async (_label, fetchFactory, timeoutMs, failureCode) => {
    const reply = await seedIntent();
    const fetchImpl = fetchFactory();

    await drainOutreachReplyForwardIntents({
      providerEmailId: reply.providerEmailId,
      limit: 1,
      fetchImpl,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    await drainOutreachReplyForwardIntents({
      providerEmailId: reply.providerEmailId,
      limit: 1,
      fetchImpl,
      ...(timeoutMs ? { timeoutMs } : {}),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(prisma.outreachReplyForwardIntent.findUniqueOrThrow({
      where: { replyId: reply.id },
    })).resolves.toMatchObject({
      status: "RECONCILIATION_REQUIRED",
      failureCode,
      attemptCount: 1,
    });
  });
});
