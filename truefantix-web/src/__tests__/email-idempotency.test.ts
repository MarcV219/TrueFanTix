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

  it("does not cross providers when the claimed provider is unavailable", async () => {
    const previousResend = process.env.RESEND_API_KEY;
    const previousSendGrid = process.env.SENDGRID_API_KEY;
    delete process.env.RESEND_API_KEY;
    process.env.SENDGRID_API_KEY = "synthetic-sendgrid-key";
    try {
      await expect(sendEmail({
        to: "buyer@example.test",
        subject: "Subject",
        text: "Text",
        provider: "RESEND",
        idempotencyKey: "transfer-proof-outbox-key",
      })).resolves.toMatchObject({
        ok: false,
        provider: "RESEND",
        providerResult: "NOT_CONFIGURED",
      });
    } finally {
      if (previousResend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResend;
      if (previousSendGrid === undefined) delete process.env.SENDGRID_API_KEY;
      else process.env.SENDGRID_API_KEY = previousSendGrid;
    }
  });
});
