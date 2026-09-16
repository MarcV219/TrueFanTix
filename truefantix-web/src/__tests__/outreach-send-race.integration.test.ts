/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { sendOutreachEmail } from "@/lib/outreach-email";
import { auditLog } from "@/lib/audit";
import { claimOutreachRecipient, settleOutreachCampaign } from "@/lib/outreach-send";
import { recordOutreachDeliveryEvent } from "@/lib/outreach-delivery-event";
import { unsubscribeToken } from "@/lib/outreach";
import { POST as sendCampaign } from "@/app/api/admin/outreach/campaigns/[id]/send/route";
import { POST as unsubscribe } from "@/app/unsubscribe/outreach/route";

jest.mock("@/lib/auth/guards", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/outreach-email", () => ({ sendOutreachEmail: jest.fn() }));
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
    mockedSendOutreachEmail.mockResolvedValue({ provider: "RESEND", messageId: `synthetic-${runId}` });
    mockedAuditLog.mockResolvedValue(undefined as never);
  });

  afterAll(async () => {
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
      .toMatchObject({ status: "SENT", providerMessageId: `synthetic-${runId}` });
    expect(await prisma.outreachCampaign.findUniqueOrThrow({ where: { id: campaignId } }))
      .toMatchObject({ status: "COMPLETED" });
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
      recipientId: staleSnapshot.id,
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
});
