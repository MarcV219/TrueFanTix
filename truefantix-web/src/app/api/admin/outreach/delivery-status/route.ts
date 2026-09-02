import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { outreachProviderConfigured, outreachSenderEmail } from "@/lib/outreach-email";
export async function GET(req:Request){const gate=await requireAdmin(req);if(!gate.ok)return gate.res;return NextResponse.json({ok:true,configured:outreachProviderConfigured(),sender:outreachSenderEmail()});}
