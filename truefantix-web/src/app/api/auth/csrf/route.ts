export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { ensureCsrfCookie, csrfCookieName } from "@/lib/security/csrf";

export async function GET() {
  const token = await ensureCsrfCookie();
  return NextResponse.json(
    { ok: true, csrfToken: token, csrfCookie: csrfCookieName() },
    { status: 200 }
  );
}
