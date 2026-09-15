import { Resend } from "resend";
import { cleanEmailProviderCredential } from "@/lib/emailProviderConfig";

const apiKey = cleanEmailProviderCredential(process.env.RESEND_API_KEY);

if (!apiKey) {
  throw new Error("Missing RESEND_API_KEY environment variable");
}

export const resend = new Resend(apiKey);

export const DEFAULT_FROM = "TrueFanTix <no-reply@mail.truefantix.com>";
