/** @jest-environment node */

import { sendEmail } from "@/lib/email";

describe("email provider idempotency", () => {
  it("forwards the durable outbox key to Resend", async () => {
    const previous = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "email-1" }), { status: 200 }));
    try {
      await expect(sendEmail({
        to: "buyer@example.test",
        subject: "Subject",
        text: "Text",
        idempotencyKey: "transfer-proof-outbox-key",
      })).resolves.toMatchObject({ ok: true, provider: "RESEND" });
      expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": "transfer-proof-outbox-key" }),
      }));
    } finally {
      fetchMock.mockRestore();
      if (previous === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previous;
    }
  });
});
