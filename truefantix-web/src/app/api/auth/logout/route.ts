export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { deleteCurrentSession } from "@/lib/auth/session";
import { enforceOriginAndCsrf } from "@/lib/security/csrf";

const COOKIE_NAME = "tft_session";

function appendSessionCookieClears(res: NextResponse) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  for (const path of ["/auth", "/api", "/"]) {
    res.headers.append(
      "Set-Cookie",
      `${COOKIE_NAME}=; Path=${path}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
    );
  }
}

/**
 * Bulletproof cookie clear:
 * - Deletes DB session if present (via helper)
 * - Explicitly clears the cookie on the RESPONSE (most reliable)
 * - Clears common path variants to handle attribute drift
 */
export async function POST(req: Request) {
  const csrf = await enforceOriginAndCsrf(req);
  if (!csrf.ok) return csrf.res;

  // Best-effort: delete DB session + (your helper may also try clearing cookie)
  await deleteCurrentSession();

  const res = NextResponse.json({ ok: true }, { status: 200 });

  appendSessionCookieClears(res);

  return res;
}
