import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "tft_session";

/**
 * Edge-safe proxy (Next.js middleware replacement):
 * - ONLY checks if a session cookie exists (no Prisma/crypto; proxy runs on Edge).
 * - If missing, redirects to /login?next=<current path+query>
 * - Verified/admin/seller gating must happen in route handlers / pages via /api/auth/me.
 */

function isSafePath(pathname: string) {
  return pathname.startsWith("/") && !pathname.startsWith("//");
}

function currentPathWithQuery(req: NextRequest) {
  const p = req.nextUrl.pathname + (req.nextUrl.search || "");
  return isSafePath(p) ? p : "/";
}

function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", currentPathWithQuery(req));
  return NextResponse.redirect(url);
}

export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Safety guard to prevent accidental loops if matcher expands later
  if (pathname === "/login" || pathname === "/register") {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;

  // No cookie => treat as logged out and require login for matched routes.
  if (!token || !token.trim()) {
    return redirectToLogin(req);
  }

  // Cookie exists => allow through. (Real auth/verification happens server-side elsewhere.)
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/checkout/:path*",
    "/account/:path*",
    "/community/new",
    "/community/reply/:path*",
    "/sell/:path*",
    "/admin/:path*",
  ],
};
