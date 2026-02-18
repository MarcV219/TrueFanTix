export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { deleteCurrentSession } from "@/lib/auth/session";

const COOKIE_NAME = "tft_session";

/**
 * Bulletproof cookie clear:
 * - Deletes DB session if present (via helper)
 * - Explicitly clears the cookie on the RESPONSE (most reliable)
 * - Clears common path variants to handle attribute drift
 */
export async function POST() {
  // Best-effort: delete DB session + (your helper may also try clearing cookie)
  await deleteCurrentSession();

  const res = NextResponse.json({ ok: true }, { status: 200 });

  const secure = process.env.NODE_ENV === "production";
  const base = {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure,
    expires: new Date(0),
    maxAge: 0,
  };

  // Clear the cookie for common path variants
  res.cookies.set(COOKIE_NAME, "", { ...base, path: "/" });
  res.cookies.set(COOKIE_NAME, "", { ...base, path: "/api" });
  res.cookies.set(COOKIE_NAME, "", { ...base, path: "/auth" });

  return res;
}
