import sgMail from "@sendgrid/mail";

function clean(value: string | undefined) { return value?.trim().replace(/^['"]|['"]$/g, ""); }
export function outreachSenderEmail() { return (clean(process.env.OUTREACH_FROM_EMAIL) || "marc@truefantix.com").toLowerCase(); }
export function outreachSender() { return `Marc at TrueFanTix <${outreachSenderEmail()}>`; }
export function outreachProviderConfigured() { return Boolean(clean(process.env.RESEND_API_KEY) || clean(process.env.SENDGRID_API_KEY)); }

export type OutreachEmailResult = { provider: "RESEND" | "SENDGRID"; messageId: string };
export async function sendOutreachEmail(input: { to:string; subject:string; text:string; unsubscribeUrl:string }): Promise<OutreachEmailResult> {
  const resendKey=clean(process.env.RESEND_API_KEY); const sendgridKey=clean(process.env.SENDGRID_API_KEY); const from=outreachSenderEmail();
  const headers={ "List-Unsubscribe": `<${input.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  if(resendKey){
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resendKey}`,"Content-Type":"application/json"},body:JSON.stringify({from:outreachSender(),to:[input.to],reply_to:from,subject:input.subject,text:input.text,headers})});
    const data=await response.json().catch(()=>null); if(!response.ok) throw new Error(data?.message||`Resend rejected the email (${response.status}).`); return {provider:"RESEND",messageId:String(data.id)};
  }
  if(sendgridKey){
    sgMail.setApiKey(sendgridKey); const [response]=await sgMail.send({to:input.to,from:{email:from,name:"Marc at TrueFanTix"},replyTo:from,subject:input.subject,text:input.text,headers});
    return {provider:"SENDGRID",messageId:String(response?.headers?.["x-message-id"]||response?.statusCode||"ACCEPTED")};
  }
  throw new Error("The TrueFanTix outreach email provider is not configured.");
}
