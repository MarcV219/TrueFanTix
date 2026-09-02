export const runtime = "nodejs";
import crypto from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { exchangeGmailCode, storeGmailConnection } from "@/lib/integrations/gmail";
import { auditLog, createAuditContext } from "@/lib/audit";

const COOKIE = "tft_gmail_oauth_state";
function redirect(req: Request, status: string) { return NextResponse.redirect(new URL(`/admin/outreach?gmail=${status}`, req.url)); }
function equal(a: string, b: string) { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); }
export async function GET(req: Request) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  const url = new URL(req.url); const jar = await cookies(); const saved = jar.get(COOKIE)?.value || "";
  const state = url.searchParams.get("state") || ""; const code = url.searchParams.get("code") || "";
  let response: NextResponse;
  if (url.searchParams.get("error")) response = redirect(req, "denied");
  else if (!state || !saved || !equal(state, saved) || !state.startsWith(`${gate.user.id}.`) || !code) response = redirect(req, "invalid_state");
  else { try { await storeGmailConnection(gate.user.id, await exchangeGmailCode(code)); await auditLog({ action: "ADMIN_OUTREACH_CONNECT", userId: gate.user.id, targetType: "ConnectedAccount", metadata: { provider: "gmail" }, ...createAuditContext(req) }); response = redirect(req, "connected"); } catch (error) { console.error("Gmail OAuth callback failed", error instanceof Error ? error.message : "unknown"); response = redirect(req, "failed"); } }
  response.cookies.set(COOKIE, "", { path: "/", maxAge: 0 }); return response;
}
