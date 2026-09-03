function clean(value: string | undefined) { return value?.trim().replace(/^['"]|['"]$/g, ""); }
export function outreachSenderEmail() { return (clean(process.env.OUTREACH_FROM_EMAIL) || "marc@truefantix.com").toLowerCase(); }
export function outreachSender() { return `Marc at TrueFanTix <${outreachSenderEmail()}>`; }
export function outreachProviderConfigured() { return Boolean(clean(process.env.OUTREACH_RESEND_API_KEY)); }
export function outreachReplyDomain() { return clean(process.env.OUTREACH_REPLY_DOMAIN) || "replies.truefantix.com"; }
export function outreachReplyAddress(token: string) { return `reply+${token}@${outreachReplyDomain()}`; }
export function outreachReplyCaptureConfigured() { return Boolean(clean(process.env.OUTREACH_RESEND_INBOUND_API_KEY) && clean(process.env.OUTREACH_RESEND_INBOUND_WEBHOOK_SECRET) && clean(process.env.OUTREACH_REPLY_FORWARD_TO)); }

export type OutreachEmailResult = { provider: "RESEND"; messageId: string };
export async function sendOutreachEmail(input: { to:string; subject:string; text:string; html?:string; unsubscribeUrl:string; replyTo?:string }): Promise<OutreachEmailResult> {
  const resendKey=clean(process.env.OUTREACH_RESEND_API_KEY); const from=outreachSenderEmail();
  const headers={ "List-Unsubscribe": `<${input.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  if(resendKey){
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resendKey}`,"Content-Type":"application/json"},body:JSON.stringify({from:outreachSender(),to:[input.to],reply_to:input.replyTo||from,subject:input.subject,text:input.text,...(input.html?{html:input.html}:{}),headers})});
    const data=await response.json().catch(()=>null); if(!response.ok) throw new Error(data?.message||`Resend rejected the email (${response.status}).`); return {provider:"RESEND",messageId:String(data.id)};
  }
  throw new Error("The TrueFanTix outreach email provider is not configured.");
}
