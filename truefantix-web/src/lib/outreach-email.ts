function clean(value: string | undefined) { return value?.trim().replace(/^['"]|['"]$/g, ""); }
export function outreachSenderEmail() { return (clean(process.env.OUTREACH_FROM_EMAIL) || "marc@truefantix.com").toLowerCase(); }
export function outreachSender() { return `Marc at TrueFanTix <${outreachSenderEmail()}>`; }
export function outreachProviderConfigured() { return Boolean(clean(process.env.OUTREACH_RESEND_API_KEY)); }

export type OutreachEmailResult = { provider: "RESEND"; messageId: string };
export async function sendOutreachEmail(input: { to:string; subject:string; text:string; unsubscribeUrl:string }): Promise<OutreachEmailResult> {
  const resendKey=clean(process.env.OUTREACH_RESEND_API_KEY); const from=outreachSenderEmail();
  const headers={ "List-Unsubscribe": `<${input.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  if(resendKey){
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resendKey}`,"Content-Type":"application/json"},body:JSON.stringify({from:outreachSender(),to:[input.to],reply_to:from,subject:input.subject,text:input.text,headers})});
    const data=await response.json().catch(()=>null); if(!response.ok) throw new Error(data?.message||`Resend rejected the email (${response.status}).`); return {provider:"RESEND",messageId:String(data.id)};
  }
  throw new Error("The TrueFanTix outreach email provider is not configured.");
}
