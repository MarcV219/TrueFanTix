import crypto from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const CSRF_COOKIE = "tft_csrf";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function getAppOrigin() {
  const configured = process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

function isStateChanging(req: Request) {
  return !SAFE_METHODS.has(req.method.toUpperCase());
}

function readOriginOrReferer(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (origin) return origin;

  const referer = req.headers.get("referer");
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

export async function ensureCsrfCookie(res?: NextResponse): Promise<string> {
  const jar = await cookies();
  let token = jar.get(CSRF_COOKIE)?.value;
  if (!token) {
    token = crypto.randomBytes(32).toString("hex");
    const cookieDef = {
      httpOnly: false,
      sameSite: "strict" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
    };

    if (res) {
      res.cookies.set(CSRF_COOKIE, token, cookieDef);
    } else {
      jar.set(CSRF_COOKIE, token, cookieDef);
    }
  }
  return token;
}

export async function enforceOriginAndCsrf(req: Request): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  if (!isStateChanging(req)) return { ok: true };

  const expectedOrigin = getAppOrigin();
  const requestOrigin = readOriginOrReferer(req);
  if (expectedOrigin && requestOrigin !== expectedOrigin) {
    return {
      ok: false,
      res: jsonError(403, "INVALID_ORIGIN", "Cross-site state-changing requests are blocked."),
    };
  }

  const jar = await cookies();
  const cookieToken = jar.get(CSRF_COOKIE)?.value;
  if (!cookieToken) {
    return {
      ok: false,
      res: jsonError(403, "CSRF_MISSING", "Missing CSRF cookie."),
    };
  }

  const headerToken = req.headers.get("x-csrf-token")?.trim();
  if (!headerToken || headerToken !== cookieToken) {
    return {
      ok: false,
      res: jsonError(403, "CSRF_INVALID", "Missing or invalid CSRF token."),
    };
  }

  return { ok: true };
}

export function csrfCookieName() {
  return CSRF_COOKIE;
}
