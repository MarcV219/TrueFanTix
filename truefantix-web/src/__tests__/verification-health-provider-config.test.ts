/** @jest-environment node */

import { GET } from "@/app/api/health/verification/route";

describe("verification health provider configuration", () => {
  const originalResend = process.env.RESEND_API_KEY;
  const originalSendGrid = process.env.SENDGRID_API_KEY;
  const originalTwilioSid = process.env.TWILIO_ACCOUNT_SID;
  const originalTwilioAuth = process.env.TWILIO_AUTH_TOKEN;
  const originalTwilioPhone = process.env.TWILIO_PHONE_NUMBER;

  afterEach(() => {
    if (originalResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalResend;
    if (originalSendGrid === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = originalSendGrid;
    if (originalTwilioSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    else process.env.TWILIO_ACCOUNT_SID = originalTwilioSid;
    if (originalTwilioAuth === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = originalTwilioAuth;
    if (originalTwilioPhone === undefined) delete process.env.TWILIO_PHONE_NUMBER;
    else process.env.TWILIO_PHONE_NUMBER = originalTwilioPhone;
  });

  it("does not report quoted-empty email credentials as healthy", async () => {
    process.env.RESEND_API_KEY = "  '\"\"'  ";
    process.env.SENDGRID_API_KEY = "  ";
    process.env.TWILIO_ACCOUNT_SID = "synthetic-sid";
    process.env.TWILIO_AUTH_TOKEN = "synthetic-auth";
    process.env.TWILIO_PHONE_NUMBER = "+14165550123";

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false, status: "degraded" });
  });
});
