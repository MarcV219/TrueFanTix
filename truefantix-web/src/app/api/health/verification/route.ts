export const runtime = "nodejs";

import { NextResponse } from "next/server";

function isNonEmpty(v: string | undefined | null) {
  return !!v && v.trim().length > 0;
}

function isE164(v: string | undefined | null) {
  if (!v) return false;
  return /^\+[1-9]\d{1,14}$/.test(v.trim());
}

export async function GET() {
  const sendgridApiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.FROM_EMAIL;

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
  const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

  const sendgrid = {
    configured: isNonEmpty(sendgridApiKey) && isNonEmpty(fromEmail),
    checks: {
      SENDGRID_API_KEY: isNonEmpty(sendgridApiKey) ? "ok" : "missing",
      FROM_EMAIL: isNonEmpty(fromEmail) ? "ok" : "missing",
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

  const ok = sendgrid.configured && twilio.configured;

  return NextResponse.json(
    {
      ok,
      status: ok ? "healthy" : "degraded",
      providers: {
        sendgrid,
        twilio,
      },
      ts: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
