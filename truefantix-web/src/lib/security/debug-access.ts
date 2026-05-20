import { NextResponse } from "next/server";

export function requireDebugAccess(req: Request): { ok: true } | { ok: false; res: NextResponse } {
  const secret = process.env.DEBUG_API_SECRET?.trim();
  const provided = req.headers.get("x-debug-secret")?.trim();

  if (process.env.NODE_ENV === "production") {
    if (secret && provided && provided === secret) {
      return { ok: true };
    }

    // Hide debug endpoints in production instead of revealing that they exist.
    return { ok: false, res: NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 }) };
  }

  return { ok: true };
}
