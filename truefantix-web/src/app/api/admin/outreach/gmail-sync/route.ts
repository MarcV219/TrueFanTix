import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { gmailReplyMatchingConfigured, syncGmailOutreachReplies } from "@/lib/gmail-outreach";

export async function GET(req: Request) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  return NextResponse.json({ ok: true, configured: gmailReplyMatchingConfigured() });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  try { return NextResponse.json({ ok: true, ...(await syncGmailOutreachReplies()) }); }
  catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Gmail sync failed." }, { status: 503 }); }
}
