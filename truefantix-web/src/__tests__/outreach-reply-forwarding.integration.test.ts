/** @jest-environment node */

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
