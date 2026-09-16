/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import {
  OutreachEmailOutcomeUncertainError,
  OutreachEmailRejectedError,
  sendOutreachEmail,
} from "@/lib/outreach-email";
import { auditLog } from "@/lib/audit";
import {
  claimOutreachRecipient,
  settleOutreachCampaign,
} from "@/lib/outreach-send";
import { recordOutreachDeliveryEvent } from "@/lib/outreach-delivery-event";
import { unsubscribeToken } from "@/lib/outreach";
import { POST as sendCampaign } from "@/app/api/admin/outreach/campaigns/[id]/send/route";
import { POST as unsubscribe } from "@/app/unsubscribe/outreach/route";

jest.mock("@/lib/auth/guards", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/outreach-email", () => ({
  ...jest.requireActual("@/lib/outreach-email"),
  sendOutreachEmail: jest.fn(),
}));
jest.mock("@/lib/audit", () => ({
  auditLog: jest.fn(),
  createAuditContext: jest.fn(() => ({})),
}));

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;
const mockedRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockedSendOutreachEmail = sendOutreachEmail as jest.MockedFunction<typeof sendOutreachEmail>;
const mockedAuditLog = auditLog as jest.MockedFunction<typeof auditLog>;

if (!databaseUrl) describe.skip("outreach send PostgreSQL claim boundary", () => {
  it("requires an isolated database", () => undefined);
}); else describe("outreach send PostgreSQL claim boundary", () => {
  const runId = `${Date.now()}-${process.pid}`;
  const campaignIds: string[] = [];
  const contactIds: string[] = [];
  const fixtureEmails: string[] = [];

  function request(campaignName: string, limit = 10) {
    return new Request("https://preview.example/api/admin/outreach/campaigns/test/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: campaignName, limit }),
    });
  }

  async function fixture(options: {
    recipientCount?: number;
    unsubscribed?: boolean;
    lastContactedAt?: Date | null;
    allowRecentContact?: boolean;
  } = {}) {
    const sequence = campaignIds.length + 1;
    const campaignId = `outreach-send-campaign-${runId}-${sequence}`;
    const campaignName = `Synthetic outreach ${runId}-${sequence}`;
    campaignIds.push(campaignId);
    await prisma.outreachCampaign.create({
      data: {
        id: campaignId,
        name: campaignName,
        subject: "Synthetic subject",
        bodyText: "Synthetic body",
        createdById: `synthetic-admin-${runId}`,
        allowRecentContact: options.allowRecentContact ?? false,
      },
    });

    const recipientIds: string[] = [];
    const fixtureContactIds: string[] = [];
    const emails: string[] = [];
    const count = options.recipientCount ?? 1;
    for (let index = 0; index < count; index += 1) {
      const contactId = `outreach-send-contact-${runId}-${sequence}-${index}`;
      const recipientId = `outreach-send-recipient-${runId}-${sequence}-${index}`;
      const email = `outreach-${runId}-${sequence}-${index}@example.test`.toLowerCase();
      contactIds.push(contactId);
      fixtureContactIds.push(contactId);
      recipientIds.push(recipientId);
      emails.push(email);
      fixtureEmails.push(email);
      await prisma.outreachContact.create({
        data: {
          id: contactId,
          externalKey: `outreach-send-external-${runId}-${sequence}-${index}`,
          category: "SYNTHETIC_TEST",
          email,
          normalizedEmail: email,
          unsubscribedAt: options.unsubscribed ? new Date() : null,
          lastContactedAt: options.lastContactedAt ?? null,
        },
      });
      await prisma.outreachRecipient.create({
        data: {
          id: recipientId,
          campaignId,
          contactId,
          emailSnapshot: email,
          subjectSnapshot: `Synthetic subject ${index}`,
          bodyTextSnapshot: `Synthetic body ${index}`,
          createdAt: new Date(Date.UTC(2026, 8, 16, 12, 0, index)),
        },
      });
    }
    return { campaignId, campaignName, recipientIds, contactIds: fixtureContactIds, emails };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireAdmin.mockResolvedValue({
      ok: true,
      user: { id: `synthetic-admin-${runId}` },
    } as never);
    mockedSendOutreachEmail.mockImplementation(async (input) => ({
      provider: "RESEND",
      messageId: `synthetic-${runId}-${input.to}`,
    }));
    mockedAuditLog.mockResolvedValue(undefined as never);
  });

  afterAll(async () => {
    await prisma.outreachQuarantinedEmailEvent.deleteMany({
      where: { svixId: { contains: runId } },
    });
    await prisma.outreachEmailEventTombstone.deleteMany({
      where: { svixId: { contains: runId } },
    });
    await prisma.outreachSuppression.deleteMany({
      where: { normalizedEmail: { in: fixtureEmails } },
    });
    await prisma.outreachCampaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.outreachContact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.$disconnect();
  });

  it("gives exactly one concurrent claimant authority over a recipient", async () => {
    const { campaignId, recipientIds } = await fixture();

    const results = await Promise.all([
      claimOutreachRecipient(campaignId, recipientIds[0]),
      claimOutreachRecipient(campaignId, recipientIds[0]),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["CLAIMED", "NOT_CLAIMED"]);
    expect(await prisma.outreachRecipient.findUniqueOrThrow({ where: { id: recipientIds[0] } }))
      .toMatchObject({ status: "SENDING", error: null });
  });

  it("allows two concurrent route invocations to make only one provider call", async () => {
    const { campaignId, campaignName } = await fixture();

    const responses = await Promise.all([
      sendCampaign(request(campaignName), { params: Promise.resolve({ id: campaignId }) }),
      sendCampaign(request(campaignName), { params: Promise.resolve({ id: campaignId }) }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(mockedSendOutreachEmail).toHaveBeenCalledTimes(1);
    expect(await prisma.outreachRecipient.findFirstOrThrow({ where: { campaignId } }))
      .toMatchObject({ status: "SENT", providerMessageId: expect.stringContaining(`synthetic-${runId}`) });
    expect(await prisma.outreachCampaign.findUniqueOrThrow({ where: { id: campaignId } }))
      .toMatchObject({ status: "COMPLETED" });
  });

  it("preserves accepted provider evidence when the ordinary finalization transaction fails", async () => {
    const { campaignId, campaignName, recipientIds } = await fixture();
    const triggerName = `fail_outreach_sent_${process.pid}_${campaignIds.length}`.replace(/[^a-zA-Z0-9_]/g, "_");
    const functionName = `${triggerName}_fn`;
    const recipientId = recipientIds[0].replaceAll("'", "''");
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = '${recipientId}' AND NEW.status = 'SENT' THEN
          RAISE EXCEPTION 'synthetic finalization failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE UPDATE ON "OutreachRecipient"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `);

    try {
      const response = await sendCampaign(request(campaignName), {
        params: Promise.resolve({ id: campaignId }),
      });
      await expect(response.json()).resolves.toMatchObject({
        sent: 0,
        failed: 0,
        reconciliationRequired: 1,
        remaining: 1,
      });
      expect(mockedSendOutreachEmail).toHaveBeenCalledTimes(1);
      const recipient = await prisma.outreachRecipient.findUniqueOrThrow({
        where: { id: recipientIds[0] },
      });
      expect(recipient).toMatchObject({
        status: "RECONCILIATION_REQUIRED",
        providerMessageId: expect.stringContaining(`synthetic-${runId}`),
        providerResult: "RESEND_ACCEPTED_RECONCILIATION_REQUIRED",
        sentAt: expect.any(Date),
        deliveryAttemptId: expect.any(String),
      });
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "OutreachRecipient"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }

    await sendCampaign(request(campaignName), { params: Promise.resolve({ id: campaignId }) });
    expect(mockedSendOutreachEmail).toHaveBeenCalledTimes(1);
  });

  it("binds a tagged signed provider event that arrives before acceptance persistence", async () => {
    const { campaignId, recipientIds, emails } = await fixture();
    const claim = await claimOutreachRecipient(campaignId, recipientIds[0]);
    expect(claim.status).toBe("CLAIMED");
    if (claim.status !== "CLAIMED") throw new Error("Synthetic recipient was not claimed.");
    const providerMessageId = `outreach-early-provider-${runId}`;
    const svixId = `outreach-early-svix-${runId}`;

    await expect(recordOutreachDeliveryEvent({
      svixId,
      type: "email.delivered",
      providerMessageId,
      deliveryAttemptId: claim.recipient.deliveryAttemptId,
      normalizedEmail: emails[0],
      occurredAt: new Date(),
      detail: null,
      nextStatus: "DELIVERED",
      suppressionReason: null,
      contactUpdate: null,
    })).resolves.toMatchObject({ status: "APPLIED", campaignId });

    await expect(prisma.outreachRecipient.findUniqueOrThrow({ where: { id: recipientIds[0] } }))
      .resolves.toMatchObject({ status: "DELIVERED", providerMessageId });
    await expect(prisma.outreachEmailEvent.findUnique({ where: { svixId } }))
      .resolves.toMatchObject({ recipientId: recipientIds[0], providerMessageId });

    await expect(recordOutreachDeliveryEvent({
      svixId,
      type: "email.delivered",
      providerMessageId,
      deliveryAttemptId: claim.recipient.deliveryAttemptId,
      normalizedEmail: emails[0],
      occurredAt: new Date(),
      detail: null,
      nextStatus: "DELIVERED",
      suppressionReason: null,
      contactUpdate: null,
    })).resolves.toMatchObject({ status: "DUPLICATE", campaignId });
  });

  it("reports a tagged early-webhook race as an idempotent successful send", async () => {
    const { campaignId, campaignName, recipientIds } = await fixture();
    const providerMessageId = `outreach-route-race-${runId}`;
    mockedSendOutreachEmail.mockImplementationOnce(async (input) => {
      if (!input.idempotencyKey) throw new Error("Missing synthetic attempt identity.");
      const result = await recordOutreachDeliveryEvent({
        svixId: `outreach-route-race-svix-${runId}`,
        type: "email.delivered",
        providerMessageId,
        deliveryAttemptId: input.idempotencyKey,
        normalizedEmail: input.to,
        occurredAt: new Date(),
        detail: null,
        nextStatus: "DELIVERED",
        suppressionReason: null,
        contactUpdate: null,
      });
      expect(result.status).toBe("APPLIED");
      return { provider: "RESEND", messageId: providerMessageId };
    });

    const response = await sendCampaign(request(campaignName), {
      params: Promise.resolve({ id: campaignId }),
    });
    await expect(response.json()).resolves.toMatchObject({
      sent: 1,
      failed: 0,
      reconciliationRequired: 0,
      remaining: 0,
    });
    expect(mockedSendOutreachEmail).toHaveBeenCalledTimes(1);
    await expect(prisma.outreachRecipient.findUniqueOrThrow({ where: { id: recipientIds[0] } }))
      .resolves.toMatchObject({ status: "DELIVERED", providerMessageId });
    await expect(prisma.outreachCampaign.findUniqueOrThrow({ where: { id: campaignId } }))
      .resolves.toMatchObject({ status: "COMPLETED" });
  });

  it.each([
    "RESEND_HTTP_NON_4XX",
    "RESEND_PROVIDER_TIMEOUT",
    "RESEND_PROVIDER_RESPONSE_INVALID",
  ])("never dispatches a second provider call after uncertain outcome %s", async (evidence) => {
    const { campaignId, campaignName, recipientIds } = await fixture();
    mockedSendOutreachEmail.mockRejectedValueOnce(
      new OutreachEmailOutcomeUncertainError(evidence),
    );

    const first = await sendCampaign(request(campaignName), {
      params: Promise.resolve({ id: campaignId }),
    });
    await expect(first.json()).resolves.toMatchObject({
      sent: 0,
      failed: 0,
      reconciliationRequired: 1,
      remaining: 1,
    });
    await sendCampaign(request(campaignName), { params: Promise.resolve({ id: campaignId }) });

    expect(mockedSendOutreachEmail).toHaveBeenCalledTimes(1);
    await expect(prisma.outreachRecipient.findUniqueOrThrow({ where: { id: recipientIds[0] } }))
      .resolves.toMatchObject({
        status: "RECONCILIATION_REQUIRED",
        providerMessageId: null,
        providerResult: "RESEND_OUTCOME_UNCERTAIN",
        error: evidence,
      });
  });

  it("records explicit HTTP 4xx rejection without replaying or persisting provider text", async () => {
    const { campaignId, campaignName, recipientIds } = await fixture();
    mockedSendOutreachEmail.mockRejectedValueOnce(
      new OutreachEmailRejectedError("RESEND_HTTP_4XX"),
    );

    const first = await sendCampaign(request(campaignName), {
      params: Promise.resolve({ id: campaignId }),
    });
    await expect(first.json()).resolves.toMatchObject({
      sent: 0,
      failed: 1,
      reconciliationRequired: 0,
      remaining: 0,
    });
    await sendCampaign(request(campaignName), { params: Promise.resolve({ id: campaignId }) });

    expect(mockedSendOutreachEmail).toHaveBeenCalledTimes(1);
    await expect(prisma.outreachRecipient.findUniqueOrThrow({ where: { id: recipientIds[0] } }))
      .resolves.toMatchObject({
        status: "FAILED",
        providerMessageId: null,
        providerResult: "RESEND_REJECTED",
        error: "RESEND_HTTP_4XX",
      });
  });

  it("ignores unrelated signed-account traffic and terminally quarantines identity mismatch", async () => {
    const unrelatedSvixId = `outreach-unrelated-${runId}`;
    await expect(recordOutreachDeliveryEvent({
      svixId: unrelatedSvixId,
      type: "email.delivered",
      providerMessageId: `unrelated-provider-${runId}`,
      deliveryAttemptId: null,
      normalizedEmail: `transactional-${runId}@example.test`,
      occurredAt: new Date(),
      detail: null,
      nextStatus: "DELIVERED",
      suppressionReason: null,
      contactUpdate: null,
    })).resolves.toMatchObject({ status: "IGNORED" });
    await expect(prisma.outreachQuarantinedEmailEvent.findUnique({ where: { svixId: unrelatedSvixId } }))
      .resolves.toBeNull();

    const { campaignId, recipientIds, emails } = await fixture();
    const claim = await claimOutreachRecipient(campaignId, recipientIds[0]);
    expect(claim.status).toBe("CLAIMED");
    if (claim.status !== "CLAIMED") throw new Error("Synthetic recipient was not claimed.");
    const mismatchSvixId = `outreach-mismatch-${runId}`;
    await expect(recordOutreachDeliveryEvent({
      svixId: mismatchSvixId,
      type: "email.delivered",
      providerMessageId: `mismatch-provider-${runId}`,
      deliveryAttemptId: claim.recipient.deliveryAttemptId,
      normalizedEmail: `wrong-${emails[0]}`,
      occurredAt: new Date(),
      detail: null,
      nextStatus: "DELIVERED",
      suppressionReason: null,
      contactUpdate: null,
    })).resolves.toMatchObject({ status: "QUARANTINED" });
    const quarantined = await prisma.outreachQuarantinedEmailEvent.findUniqueOrThrow({
      where: { svixId: mismatchSvixId },
    });
    expect(quarantined).toMatchObject({
      deliveryAttemptId: claim.recipient.deliveryAttemptId,
      reason: "OUTREACH_EVENT_IDENTITY_MISMATCH",
      deleteAfter: expect.any(Date),
    });
    expect(quarantined.deleteAfter.getTime()).toBeGreaterThan(Date.now());
    await prisma.outreachQuarantinedEmailEvent.update({
      where: { svixId: mismatchSvixId },
      data: { deleteAfter: new Date(0) },
    });
    await expect(recordOutreachDeliveryEvent({
      svixId: mismatchSvixId,
      type: "email.delivered",
      providerMessageId: `mismatch-provider-${runId}`,
      deliveryAttemptId: claim.recipient.deliveryAttemptId,
      normalizedEmail: emails[0],
      occurredAt: new Date(),
      detail: null,
      nextStatus: "DELIVERED",
      suppressionReason: null,
      contactUpdate: null,
    })).resolves.toMatchObject({ status: "DUPLICATE" });
    await expect(prisma.outreachQuarantinedEmailEvent.findUnique({ where: { svixId: mismatchSvixId } }))
      .resolves.toBeNull();
    await expect(prisma.outreachEmailEventTombstone.findUnique({ where: { svixId: mismatchSvixId } }))
      .resolves.toMatchObject({ svixId: mismatchSvixId });
    await expect(prisma.outreachRecipient.findUniqueOrThrow({ where: { id: recipientIds[0] } }))
      .resolves.toMatchObject({ status: "SENDING", providerMessageId: null });
  });

  it("serializes a real unsubscribe race with a claim without deadlock", async () => {
    const { campaignId, recipientIds, contactIds: fixtureContactIds, emails } = await fixture();
    const token = unsubscribeToken(emails[0]);

    const [claim, response] = await Promise.all([
      claimOutreachRecipient(campaignId, recipientIds[0]),
      unsubscribe(new Request(
        `https://preview.example/unsubscribe/outreach?token=${encodeURIComponent(token)}`,
        { method: "POST" },
      )),
    ]);

    expect(response.status).toBe(200);
    expect(["CLAIMED", "NOT_CLAIMED"]).toContain(claim.status);
    if (claim.status === "CLAIMED") {
      await mockedSendOutreachEmail({
        to: claim.recipient.emailSnapshot,
        subject: claim.recipient.subjectSnapshot,
        text: claim.recipient.bodyTextSnapshot,
        unsubscribeUrl: "https://preview.example/unsubscribe/outreach?token=synthetic",
      });
    }
    expect(mockedSendOutreachEmail).toHaveBeenCalledTimes(claim.status === "CLAIMED" ? 1 : 0);
    await expect(prisma.outreachSuppression.findUniqueOrThrow({
      where: { normalizedEmail: emails[0] },
    })).resolves.toMatchObject({ reason: "UNSUBSCRIBED", source: "LINK" });
    await expect(prisma.outreachContact.findUniqueOrThrow({
      where: { id: fixtureContactIds[0] },
    })).resolves.toMatchObject({ unsubscribedAt: expect.any(Date) });
  });

  it("performs zero provider work when unsubscribe wins before claim", async () => {
    const { campaignId, recipientIds, emails } = await fixture();
    const token = unsubscribeToken(emails[0]);
    await unsubscribe(new Request(
      `https://preview.example/unsubscribe/outreach?token=${encodeURIComponent(token)}`,
      { method: "POST" },
    ));

    await expect(claimOutreachRecipient(campaignId, recipientIds[0]))
      .resolves.toMatchObject({ status: "NOT_CLAIMED" });
    expect(mockedSendOutreachEmail).not.toHaveBeenCalled();
    await expect(prisma.outreachRecipient.findUniqueOrThrow({ where: { id: recipientIds[0] } }))
      .resolves.toMatchObject({ status: "SUPPRESSED", error: "UNSUBSCRIBED" });
  });

  it("revalidates suppression and unsubscribe state before claiming", async () => {
    const suppressed = await fixture();
    const suppressedRecipient = await prisma.outreachRecipient.findUniqueOrThrow({
      where: { id: suppressed.recipientIds[0] },
    });
    await prisma.outreachSuppression.create({
      data: {
        normalizedEmail: suppressedRecipient.emailSnapshot,
        email: suppressedRecipient.emailSnapshot,
        reason: "SYNTHETIC_SUPPRESSION",
        source: `SYNTHETIC_TEST_${runId}`,
      },
    });
    const unsubscribed = await fixture({ unsubscribed: true });

    await sendCampaign(request(suppressed.campaignName), {
      params: Promise.resolve({ id: suppressed.campaignId }),
    });
    await sendCampaign(request(unsubscribed.campaignName), {
      params: Promise.resolve({ id: unsubscribed.campaignId }),
    });

    expect(mockedSendOutreachEmail).not.toHaveBeenCalled();
    await expect(prisma.outreachRecipient.findUniqueOrThrow({
      where: { id: suppressed.recipientIds[0] },
    })).resolves.toMatchObject({ status: "SUPPRESSED", error: "SYNTHETIC_SUPPRESSION" });
    await expect(prisma.outreachRecipient.findUniqueOrThrow({
      where: { id: unsubscribed.recipientIds[0] },
    })).resolves.toMatchObject({ status: "SUPPRESSED", error: "UNSUBSCRIBED" });
  });

  it("revalidates recent contact and keeps a claimed campaign unresolved", async () => {
    const recent = await fixture({ lastContactedAt: new Date() });
    await sendCampaign(request(recent.campaignName), {
      params: Promise.resolve({ id: recent.campaignId }),
    });
    expect(mockedSendOutreachEmail).not.toHaveBeenCalled();
    await expect(prisma.outreachRecipient.findUniqueOrThrow({
      where: { id: recent.recipientIds[0] },
    })).resolves.toMatchObject({ status: "SKIPPED_RECENT", error: "CONTACTED_WITHIN_30_DAYS" });

    const claimed = await fixture();
    await expect(claimOutreachRecipient(claimed.campaignId, claimed.recipientIds[0]))
      .resolves.toMatchObject({ status: "CLAIMED" });
    await expect(settleOutreachCampaign(claimed.campaignId))
      .resolves.toMatchObject({ pending: 0, sending: 1, failed: 0 });
    await expect(prisma.outreachCampaign.findUniqueOrThrow({ where: { id: claimed.campaignId } }))
      .resolves.toMatchObject({ status: "SENDING", completedAt: null });
  });

  it("honors a deterministic capped batch without claiming later recipients", async () => {
    const { campaignId, campaignName, recipientIds } = await fixture({ recipientCount: 2 });

    const first = await sendCampaign(request(campaignName, 1), {
      params: Promise.resolve({ id: campaignId }),
    });

    await expect(first.json()).resolves.toMatchObject({ sent: 1, failed: 0, remaining: 1 });
    expect(mockedSendOutreachEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendOutreachEmail.mock.calls[0][0].subject).toBe("Synthetic subject 0");
    await expect(prisma.outreachRecipient.findUniqueOrThrow({ where: { id: recipientIds[1] } }))
      .resolves.toMatchObject({ status: "PENDING" });
  });

  it("re-reads locked delivery state so a delayed event cannot downgrade delivery", async () => {
    const { recipientIds, emails } = await fixture();
    const providerMessageId = `outreach-provider-${runId}`;
    await prisma.outreachRecipient.update({
      where: { id: recipientIds[0] },
      data: { status: "SENT", providerMessageId },
    });
    const staleSnapshot = await prisma.outreachRecipient.findUniqueOrThrow({
      where: { id: recipientIds[0] },
      select: { id: true, status: true, providerMessageId: true },
    });
    expect(staleSnapshot.status).toBe("SENT");

    const base = {
      providerMessageId: staleSnapshot.providerMessageId!,
      deliveryAttemptId: null,
      normalizedEmail: emails[0],
      occurredAt: new Date(),
      detail: null,
      suppressionReason: null,
      contactUpdate: null,
    } as const;
    await Promise.all([
      recordOutreachDeliveryEvent({
        ...base,
        svixId: `outreach-delivered-${runId}`,
        type: "email.delivered",
        nextStatus: "DELIVERED",
      }),
      recordOutreachDeliveryEvent({
        ...base,
        svixId: `outreach-delayed-${runId}`,
        type: "email.delivery_delayed",
        nextStatus: "DELIVERY_DELAYED",
      }),
    ]);

    await expect(prisma.outreachRecipient.findUniqueOrThrow({ where: { id: recipientIds[0] } }))
      .resolves.toMatchObject({ status: "DELIVERED", providerMessageId });
    await expect(prisma.outreachEmailEvent.count({
      where: { recipientId: recipientIds[0] },
    })).resolves.toBe(2);
  });

  it("reduces equal-priority conflicts identically in both orders and concurrently", async () => {
    const conflicts = [
      {
        older: { type: "email.delivered", nextStatus: "DELIVERED", detail: null },
        newer: { type: "email.failed", nextStatus: "FAILED", detail: "synthetic failure" },
        expectedStatus: "FAILED",
        expectedCampaignStatus: "COMPLETED_WITH_ERRORS",
      },
      {
        older: { type: "email.bounced", nextStatus: "BOUNCED", detail: "synthetic bounce" },
        newer: { type: "email.suppressed", nextStatus: "SUPPRESSED", detail: "synthetic suppression" },
        expectedStatus: "SUPPRESSED",
        expectedCampaignStatus: "COMPLETED",
      },
    ] as const;
    const modes = ["older-first", "newer-first", "concurrent"] as const;

    for (const conflict of conflicts) {
      for (const mode of modes) {
        const { campaignId, recipientIds, contactIds: fixtureContactIds, emails } = await fixture();
        const providerMessageId = `outreach-order-${conflict.expectedStatus}-${mode}-${runId}`;
        await prisma.outreachRecipient.update({
          where: { id: recipientIds[0] },
          data: { status: "SENT", providerMessageId },
        });
        await prisma.outreachCampaign.update({
          where: { id: campaignId },
          data: { status: "SENDING" },
        });
        const olderAt = new Date("2026-09-16T14:00:00.000Z");
        const newerAt = new Date("2026-09-16T14:01:00.000Z");
        const input = (
          event: typeof conflict.older | typeof conflict.newer,
          occurredAt: Date,
          suffix: string,
        ) => ({
          svixId: `outreach-order-${conflict.expectedStatus}-${mode}-${suffix}-${runId}`,
          type: event.type,
          providerMessageId,
          deliveryAttemptId: null,
          normalizedEmail: emails[0],
          occurredAt,
          detail: event.detail,
          nextStatus: event.nextStatus,
          suppressionReason: event.type === "email.suppressed" ? "PROVIDER_SUPPRESSED" : null,
          contactUpdate: event.type === "email.bounced"
            ? { engagementStage: "BOUNCED" as const, followUpAt: null }
            : null,
        });
        const older = input(conflict.older, olderAt, "older");
        const newer = input(conflict.newer, newerAt, "newer");

        if (mode === "older-first") {
          await recordOutreachDeliveryEvent(older);
          await recordOutreachDeliveryEvent(newer);
        } else if (mode === "newer-first") {
          await recordOutreachDeliveryEvent(newer);
          await recordOutreachDeliveryEvent(older);
        } else {
          await Promise.all([
            recordOutreachDeliveryEvent(older),
            recordOutreachDeliveryEvent(newer),
          ]);
        }

        await expect(prisma.outreachRecipient.findUniqueOrThrow({
          where: { id: recipientIds[0] },
        })).resolves.toMatchObject({
          status: conflict.expectedStatus,
          error: conflict.newer.detail,
          deliveryStatusPriority: conflict.expectedStatus === "FAILED" ? 3 : 4,
          deliveryStatusOccurredAt: newerAt,
          deliveryStatusSvixId: newer.svixId,
        });
        await expect(prisma.outreachEmailEvent.count({
          where: { recipientId: recipientIds[0] },
        })).resolves.toBe(2);
        await settleOutreachCampaign(campaignId);
        await expect(prisma.outreachCampaign.findUniqueOrThrow({
          where: { id: campaignId },
        })).resolves.toMatchObject({ status: conflict.expectedCampaignStatus });

        if (conflict.expectedStatus === "SUPPRESSED") {
          await expect(prisma.outreachContact.findUniqueOrThrow({
            where: { id: fixtureContactIds[0] },
          })).resolves.toMatchObject({ engagementStage: "BOUNCED" });
          await expect(prisma.outreachSuppression.findUniqueOrThrow({
            where: { normalizedEmail: emails[0] },
          })).resolves.toMatchObject({ reason: "PROVIDER_SUPPRESSED" });
        }
      }
    }
  });

  it("uses Svix ID as a stable equal-time tie-break and preserves both events", async () => {
    const { recipientIds, emails } = await fixture();
    const providerMessageId = `outreach-tie-provider-${runId}`;
    const occurredAt = new Date("2026-09-16T14:10:00.000Z");
    await prisma.outreachRecipient.update({
      where: { id: recipientIds[0] },
      data: { status: "SENT", providerMessageId },
    });
    const base = {
      providerMessageId,
      deliveryAttemptId: null,
      normalizedEmail: emails[0],
      occurredAt,
      suppressionReason: null,
      contactUpdate: null,
    } as const;
    const winningSvixId = `outreach-tie-z-${runId}`;
    await recordOutreachDeliveryEvent({
      ...base,
      svixId: winningSvixId,
      type: "email.failed",
      detail: "stable winner",
      nextStatus: "FAILED",
    });
    await recordOutreachDeliveryEvent({
      ...base,
      svixId: `outreach-tie-a-${runId}`,
      type: "email.delivered",
      detail: null,
      nextStatus: "DELIVERED",
    });

    await expect(prisma.outreachRecipient.findUniqueOrThrow({
      where: { id: recipientIds[0] },
    })).resolves.toMatchObject({
      status: "FAILED",
      error: "stable winner",
      deliveryStatusPriority: 3,
      deliveryStatusOccurredAt: occurredAt,
      deliveryStatusSvixId: winningSvixId,
    });
    await expect(prisma.outreachEmailEvent.count({
      where: { recipientId: recipientIds[0] },
    })).resolves.toBe(2);
  });

  it("keeps legacy status authoritative until strictly higher priority evidence", async () => {
    const { recipientIds, emails } = await fixture();
    const providerMessageId = `outreach-legacy-provider-${runId}`;
    await prisma.outreachRecipient.update({
      where: { id: recipientIds[0] },
      data: { status: "DELIVERED", providerMessageId },
    });
    const base = {
      providerMessageId,
      deliveryAttemptId: null,
      normalizedEmail: emails[0],
      occurredAt: new Date("2026-09-16T14:20:00.000Z"),
      suppressionReason: null,
      contactUpdate: null,
    } as const;
    await recordOutreachDeliveryEvent({
      ...base,
      svixId: `outreach-legacy-equal-${runId}`,
      type: "email.failed",
      detail: "must not replace legacy",
      nextStatus: "FAILED",
    });
    await expect(prisma.outreachRecipient.findUniqueOrThrow({
      where: { id: recipientIds[0] },
    })).resolves.toMatchObject({
      status: "DELIVERED",
      error: null,
      deliveryStatusPriority: null,
      deliveryStatusOccurredAt: null,
      deliveryStatusSvixId: null,
    });

    const advancingSvixId = `outreach-legacy-higher-${runId}`;
    await recordOutreachDeliveryEvent({
      ...base,
      svixId: advancingSvixId,
      type: "email.bounced",
      detail: "higher priority",
      nextStatus: "BOUNCED",
      contactUpdate: { engagementStage: "BOUNCED" as const, followUpAt: null },
    });
    await expect(prisma.outreachRecipient.findUniqueOrThrow({
      where: { id: recipientIds[0] },
    })).resolves.toMatchObject({
      status: "BOUNCED",
      error: "higher priority",
      deliveryStatusPriority: 4,
      deliveryStatusSvixId: advancingSvixId,
    });
  });

  it("rejects forged or non-advancing materialized provenance in PostgreSQL", async () => {
    const { recipientIds, emails } = await fixture();
    const providerMessageId = `outreach-provenance-provider-${runId}`;
    await prisma.outreachRecipient.update({
      where: { id: recipientIds[0] },
      data: { status: "SENT", providerMessageId },
    });
    const selectedAt = new Date("2026-09-16T14:30:00.000Z");
    const selectedSvixId = `outreach-provenance-selected-${runId}`;
    await recordOutreachDeliveryEvent({
      svixId: selectedSvixId,
      type: "email.delivered",
      providerMessageId,
      deliveryAttemptId: null,
      normalizedEmail: emails[0],
      occurredAt: selectedAt,
      detail: null,
      nextStatus: "DELIVERED",
      suppressionReason: null,
      contactUpdate: null,
    });
    await expect(prisma.outreachRecipient.update({
      where: { id: recipientIds[0] },
      data: { status: "FAILED", error: "same provenance rewrite" },
    })).rejects.toThrow();
    await expect(prisma.outreachRecipient.update({
      where: { id: recipientIds[0] },
      data: { status: "REPLIED", repliedAt: new Date("2026-09-16T14:30:30.000Z") },
    })).resolves.toMatchObject({
      status: "REPLIED",
      deliveryStatusPriority: 3,
      deliveryStatusSvixId: selectedSvixId,
    });
    const lowerSvixId = `outreach-provenance-lower-${runId}`;
    const lowerAt = new Date("2026-09-16T14:29:00.000Z");
    await recordOutreachDeliveryEvent({
      svixId: lowerSvixId,
      type: "email.delivery_delayed",
      providerMessageId,
      deliveryAttemptId: null,
      normalizedEmail: emails[0],
      occurredAt: lowerAt,
      detail: "older delay",
      nextStatus: "DELIVERY_DELAYED",
      suppressionReason: null,
      contactUpdate: null,
    });

    await expect(prisma.outreachRecipient.update({
      where: { id: recipientIds[0] },
      data: {
        status: "FAILED",
        error: "forged",
        deliveryStatusPriority: 3,
        deliveryStatusOccurredAt: new Date("2026-09-16T14:31:00.000Z"),
        deliveryStatusSvixId: `outreach-provenance-missing-${runId}`,
      },
    })).rejects.toThrow();
    await expect(prisma.outreachRecipient.update({
      where: { id: recipientIds[0] },
      data: {
        status: "DELIVERY_DELAYED",
        error: "older delay",
        deliveryStatusPriority: 2,
        deliveryStatusOccurredAt: lowerAt,
        deliveryStatusSvixId: lowerSvixId,
      },
    })).rejects.toThrow();
  });

  it("advances late delivery evidence without regressing the reply lifecycle", async () => {
    for (const mode of ["legacy-reply", "selected-reply"] as const) {
      const { recipientIds, emails } = await fixture();
      const providerMessageId = `outreach-reply-${mode}-${runId}`;
      const repliedAt = new Date("2026-09-16T14:35:00.000Z");
      await prisma.outreachRecipient.update({
        where: { id: recipientIds[0] },
        data: { status: "SENT", providerMessageId },
      });

      if (mode === "selected-reply") {
        await recordOutreachDeliveryEvent({
          svixId: `outreach-reply-delivered-${runId}`,
          type: "email.delivered",
          providerMessageId,
          deliveryAttemptId: null,
          normalizedEmail: emails[0],
          occurredAt: new Date("2026-09-16T14:34:00.000Z"),
          detail: null,
          nextStatus: "DELIVERED",
          suppressionReason: null,
          contactUpdate: null,
        });
      }
      await prisma.outreachRecipient.update({
        where: { id: recipientIds[0] },
        data: { status: "REPLIED", repliedAt },
      });

      const bounceSvixId = `outreach-reply-bounced-${mode}-${runId}`;
      const bouncedAt = new Date("2026-09-16T14:36:00.000Z");
      await recordOutreachDeliveryEvent({
        svixId: bounceSvixId,
        type: "email.bounced",
        providerMessageId,
        deliveryAttemptId: null,
        normalizedEmail: emails[0],
        occurredAt: bouncedAt,
        detail: "late synthetic bounce",
        nextStatus: "BOUNCED",
        suppressionReason: null,
        contactUpdate: { engagementStage: "BOUNCED", followUpAt: null },
      });

      await expect(prisma.outreachRecipient.findUniqueOrThrow({
        where: { id: recipientIds[0] },
      })).resolves.toMatchObject({
        status: "REPLIED",
        repliedAt,
        error: "late synthetic bounce",
        deliveryStatusPriority: 4,
        deliveryStatusOccurredAt: bouncedAt,
        deliveryStatusSvixId: bounceSvixId,
      });
      await expect(prisma.outreachRecipient.update({
        where: { id: recipientIds[0] },
        data: { status: "BOUNCED" },
      })).rejects.toThrow();

      const complaintSvixId = `outreach-reply-complaint-${mode}-${runId}`;
      const complainedAt = new Date("2026-09-16T14:37:00.000Z");
      await prisma.outreachEmailEvent.create({
        data: {
          svixId: complaintSvixId,
          type: "email.complained",
          providerMessageId,
          recipientId: recipientIds[0],
          email: emails[0],
          occurredAt: complainedAt,
          detail: null,
        },
      });
      await expect(prisma.outreachRecipient.update({
        where: { id: recipientIds[0] },
        data: {
          status: "REPLIED",
          repliedAt: new Date("2026-09-16T14:38:00.000Z"),
          error: null,
          deliveryStatusPriority: 5,
          deliveryStatusOccurredAt: complainedAt,
          deliveryStatusSvixId: complaintSvixId,
        },
      })).rejects.toThrow();
      await expect(prisma.outreachRecipient.findUniqueOrThrow({
        where: { id: recipientIds[0] },
      })).resolves.toMatchObject({
        status: "REPLIED",
        repliedAt,
        deliveryStatusPriority: 4,
        deliveryStatusSvixId: bounceSvixId,
      });
    }
  });

  it("refuses non-ASCII Svix identity before persistence", async () => {
    const { recipientIds, emails } = await fixture();
    const providerMessageId = `outreach-non-ascii-provider-${runId}`;
    await prisma.outreachRecipient.update({
      where: { id: recipientIds[0] },
      data: { status: "SENT", providerMessageId },
    });

    await expect(recordOutreachDeliveryEvent({
      svixId: `outreach-non-ascii-é-${runId}`,
      type: "email.delivered",
      providerMessageId,
      deliveryAttemptId: null,
      normalizedEmail: emails[0],
      occurredAt: new Date("2026-09-16T14:40:00.000Z"),
      detail: null,
      nextStatus: "DELIVERED",
      suppressionReason: null,
      contactUpdate: null,
    })).rejects.toThrow("Invalid outreach delivery event identity.");
    await expect(prisma.outreachEmailEvent.count({
      where: { recipientId: recipientIds[0] },
    })).resolves.toBe(0);
  });
});
