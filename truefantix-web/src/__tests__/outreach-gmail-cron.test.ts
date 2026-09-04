/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/gmail-outreach", () => ({
  gmailReplyMatchingConfigured: jest.fn(() => true),
  syncGmailOutreachReplies: jest.fn(async () => ({ matched: 1, ignored: 0, duplicates: 2 })),
}));

import { POST } from "@/app/api/cron/outreach-gmail-sync/route";

describe("outreach Gmail cron", () => {
  beforeEach(() => { process.env.CRON_SECRET = "cron-test-secret"; });
  afterEach(() => { delete process.env.CRON_SECRET; });

  it("rejects unauthenticated requests", async () => {
    const response = await POST(new Request("https://truefantix.ca/api/cron/outreach-gmail-sync", { method: "POST" }));
    expect(response.status).toBe(401);
  });

  it("runs with the internal cron secret", async () => {
    const response = await POST(new Request("https://truefantix.ca/api/cron/outreach-gmail-sync", { method: "POST", headers: { authorization: "Bearer cron-test-secret" } }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, matched: 1 });
  });
});
