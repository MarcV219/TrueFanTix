export const runtime = "nodejs";
import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { gmailAuthorizeUrl, gmailConfigured } from "@/lib/integrations/gmail";

const COOKIE = "tft_gmail_oauth_state";
export async function GET(req: Request) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  if (!gmailConfigured()) return NextResponse.redirect(new URL("/admin/outreach?gmail=not_configured", req.url));
  const nonce = crypto.randomBytes(24).toString("hex");
  const state = `${gate.user.id}.${nonce}`;
  const response = NextResponse.redirect(gmailAuthorizeUrl(state));
  response.cookies.set(COOKIE, state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return response;
}
