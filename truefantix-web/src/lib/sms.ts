export type SmsPayload = {
  to: string;
  body: string;
};

export async function sendSms(payload: SmsPayload): Promise<{ ok: boolean; error?: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromPhoneNumber) {
    console.log("[SMS] TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER not set - logging to console instead");
    console.log("[SMS] To:", payload.to);
    console.log("[SMS] Body:", payload.body.slice(0, 200) + "...");
    return { ok: true }; // DEV mode - pretend it worked
  }

  try {
    const twilioModule = await import("twilio");
    const Twilio = twilioModule.default;
    const client = Twilio(accountSid, authToken);

    await client.messages.create({
      body: payload.body,
      to: payload.to,
      from: fromPhoneNumber,
    });

    return { ok: true };
  } catch (err: any) {
    console.error("[SMS] Twilio error:", err);
    return { ok: false, error: err.message };
  }
}

export function generateVerificationSms(code: string) {
  const body = `Your TrueFanTix verification code is: ${code}. This code expires in 10 minutes.`;
  return { body };
}
