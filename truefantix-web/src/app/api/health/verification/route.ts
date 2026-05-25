export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { DEFAULT_FROM_EMAIL } from "@/lib/email";

function isNonEmpty(v: string | undefined | null) {
  return !!v && v.trim().length > 0;
}

function isE164(v: string | undefined | null) {
  if (!v) return false;
  return /^\+[1-9]\d{1,14}$/.test(v.trim());
}

export async function GET() {
  const sendgridApiKey = process.env.SENDGRID_API_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  const configuredFromEmail = process.env.FROM_EMAIL;
  const fromEmail = configuredFromEmail || DEFAULT_FROM_EMAIL;

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
  const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

  const sendgridConfigured = isNonEmpty(sendgridApiKey) && isNonEmpty(fromEmail);
  const resendConfigured = isNonEmpty(resendApiKey) && isNonEmpty(fromEmail);

  const email = {
    configured: sendgridConfigured || resendConfigured,
    provider: resendConfigured ? "resend" : sendgridConfigured ? "sendgrid" : "none",
    checks: {
      RESEND_API_KEY: isNonEmpty(resendApiKey) ? "ok" : "missing",
      SENDGRID_API_KEY: isNonEmpty(sendgridApiKey) ? "ok" : "missing",
      FROM_EMAIL: isNonEmpty(configuredFromEmail) ? "ok" : `default:${DEFAULT_FROM_EMAIL}`,
    },
  };

  const twilio = {
    configured: isNonEmpty(twilioSid) && isNonEmpty(twilioAuth) && isE164(twilioPhone),
    checks: {
      TWILIO_ACCOUNT_SID: isNonEmpty(twilioSid) ? "ok" : "missing",
      TWILIO_AUTH_TOKEN: isNonEmpty(twilioAuth) ? "ok" : "missing",
      TWILIO_PHONE_NUMBER: !isNonEmpty(twilioPhone)
        ? "missing"
        : isE164(twilioPhone)
          ? "ok"
          : "invalid_format",
    },
  };

  const ok = email.configured && twilio.configured;

  return NextResponse.json(
    {
      ok,
      status: ok ? "healthy" : "degraded",
      providers: {
        email,
        twilio,
      },
      ts: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
