import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { sendOutreachEmail } from "@/lib/outreach-email";
import { auditLog, createAuditContext } from "@/lib/audit";

export async function POST(req:Request){
  const gate=await requireAdmin(req);if(!gate.ok)return gate.res;
  try{
    const result=await sendOutreachEmail({to:gate.user.email,subject:"TrueFanTix outreach delivery test",text:"This is a controlled delivery test from TrueFanTix Admin. No campaign contacts were emailed.",unsubscribeUrl:"https://truefantix.com/privacy"});
    await auditLog({action:"ADMIN_OUTREACH_SEND",userId:gate.user.id,targetType:"OutreachDeliveryTest",metadata:{provider:result.provider},...createAuditContext(req)});
    return NextResponse.json({ok:true,recipient:gate.user.email,provider:result.provider});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Test delivery failed."},{status:502});}
}
