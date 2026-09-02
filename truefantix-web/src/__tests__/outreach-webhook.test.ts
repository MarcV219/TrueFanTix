/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { POST } from "@/app/api/webhooks/resend-outreach/route";

describe("Resend outreach webhook security", () => {
  afterEach(() => { delete process.env.OUTREACH_RESEND_WEBHOOK_SECRET; });

  it("stays disabled until a signing secret is configured", async () => {
    const response = await POST(new Request("https://truefantix.ca/api/webhooks/resend-outreach", { method: "POST", body: "{}" }));
    expect(response.status).toBe(503);
  });

  it("rejects events without a valid Resend signature", async () => {
    process.env.OUTREACH_RESEND_WEBHOOK_SECRET = "whsec_test_secret_that_is_long_enough";
    const response = await POST(new Request("https://truefantix.ca/api/webhooks/resend-outreach", { method: "POST", headers: { "svix-id": "evt_fake", "svix-timestamp": "1", "svix-signature": "v1,fake" }, body: "{}" }));
    expect(response.status).toBe(400);
  });
});
