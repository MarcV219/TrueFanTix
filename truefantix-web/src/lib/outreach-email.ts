function clean(value: string | undefined) { return value?.trim().replace(/^['"]|['"]$/g, ""); }
export function outreachSenderEmail() { return (clean(process.env.OUTREACH_FROM_EMAIL) || "marc@truefantix.com").toLowerCase(); }
export function outreachSender() { return `Marc at TrueFanTix <${outreachSenderEmail()}>`; }
export function outreachProviderConfigured() { return Boolean(clean(process.env.OUTREACH_RESEND_API_KEY)); }
export function outreachReplyDomain() { return clean(process.env.OUTREACH_REPLY_DOMAIN) || "replies.truefantix.com"; }
export function outreachReplyAddress(token: string) { return `reply+${token}@${outreachReplyDomain()}`; }
export function outreachReplyCaptureConfigured() { return Boolean(clean(process.env.OUTREACH_RESEND_INBOUND_API_KEY) && clean(process.env.OUTREACH_RESEND_INBOUND_WEBHOOK_SECRET) && clean(process.env.OUTREACH_REPLY_FORWARD_TO)); }

export type OutreachEmailResult = { provider: "RESEND"; messageId: string };
export class OutreachEmailRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutreachEmailRejectedError";
  }
}

export class OutreachEmailOutcomeUncertainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutreachEmailOutcomeUncertainError";
  }
}

export async function sendOutreachEmail(input: { to:string; subject:string; text:string; html?:string; unsubscribeUrl:string; replyTo?:string; idempotencyKey?:string }): Promise<OutreachEmailResult> {
  const resendKey=clean(process.env.OUTREACH_RESEND_API_KEY); const from=outreachSenderEmail();
  const headers={ "List-Unsubscribe": `<${input.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  if(resendKey){
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resendKey}`,"Content-Type":"application/json",...(input.idempotencyKey?{"Idempotency-Key":input.idempotencyKey}:{})},body:JSON.stringify({from:outreachSender(),to:[input.to],reply_to:input.replyTo||from,subject:input.subject,text:input.text,...(input.html?{html:input.html}:{}),headers,...(input.idempotencyKey?{tags:[{name:"truefantix_outreach_attempt",value:input.idempotencyKey}]}:{})})});
    const data=await response.json().catch(()=>null);
    if(!response.ok){
      const message=typeof data?.message === "string" ? data.message.slice(0,500) : `Resend returned HTTP ${response.status}.`;
      if(response.status >= 400 && response.status < 500) throw new OutreachEmailRejectedError(message);
      throw new OutreachEmailOutcomeUncertainError(message);
    }
    const messageId=typeof data?.id === "string" ? data.id.trim() : "";
    if(!messageId || messageId.length > 512) throw new OutreachEmailOutcomeUncertainError("Resend accepted the request without a valid message identity.");
    return {provider:"RESEND",messageId};
  }
  throw new OutreachEmailRejectedError("The TrueFanTix outreach email provider is not configured.");
}
