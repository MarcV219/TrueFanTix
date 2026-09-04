export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { hasInternalCronAuth } from "@/lib/auth/guards";
import { gmailReplyMatchingConfigured, syncGmailOutreachReplies } from "@/lib/gmail-outreach";

export async function POST(req: Request) {
  if (!hasInternalCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!gmailReplyMatchingConfigured()) {
    return NextResponse.json({ ok: false, error: "Gmail reply matching is not configured." }, { status: 503 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await syncGmailOutreachReplies()) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Gmail sync failed." },
      { status: 503 },
    );
  }
}

export async function GET(req: Request) {
  return POST(req);
}
