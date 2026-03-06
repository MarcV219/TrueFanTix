import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Coming-soon lockdown (Next.js 16 Proxy)
 *
 * When COMING_SOON_MODE=1, we only allow:
 * - GET /coming-soon (landing page)
 * - /api/early-access (email signup)
 * - Next.js / static assets needed to render the landing page
 *
 * Everything else redirects back to /coming-soon.
 */
export function proxy(req: NextRequest) {
  const comingSoon = process.env.COMING_SOON_MODE === "1";
  if (!comingSoon) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Ensure apex shows Coming Soon while keeping the real app homepage at /.
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/coming-soon";
    return NextResponse.rewrite(url);
  }

  // Allow the Coming Soon page itself.
  if (pathname === "/coming-soon") return NextResponse.next();

  // Allow early-access signup API.
  if (pathname === "/api/early-access") return NextResponse.next();

  // Allow assets required to render the landing page.
  if (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname.startsWith("/brand/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/fonts/")
  ) {
    return NextResponse.next();
  }

  // Default: bounce everything back to the Coming Soon page.
  const url = req.nextUrl.clone();
  url.pathname = "/coming-soon";
  url.search = "";
  return NextResponse.redirect(url, 307);
}

// Run on everything (we'll early-return for non-coming-soon mode).
export const config = {
  matcher: ["/:path*"],
};
