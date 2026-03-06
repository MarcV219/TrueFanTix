import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Coming-soon lockdown
 *
 * When COMING_SOON_MODE=1, we only allow:
 * - GET / (landing page)
 * - /api/early-access (email signup)
 * - Next.js / static assets needed to render the landing page
 *
 * Everything else redirects back to /.
 */
export function middleware(req: NextRequest) {
  const mode = (process.env.COMING_SOON_MODE ?? "").trim().toLowerCase();
  const comingSoonExplicit = mode === "1" || mode === "true" || mode === "yes" || mode === "on";

  const hostname = req.nextUrl.hostname.toLowerCase();
  const isPublicDomain = [
    "truefantix.com",
    "www.truefantix.com",
    "truefantix.ca",
    "www.truefantix.ca",
  ].includes(hostname);

  // Fail-safe: keep public domains locked down unless explicitly disabled.
  const comingSoon = comingSoonExplicit || (isPublicDomain && mode !== "0" && mode !== "false" && mode !== "off");
  if (!comingSoon) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Allow the landing page.
  if (pathname === "/") return NextResponse.next();

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

  // Default: bounce everything back to the landing page.
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  return NextResponse.redirect(url, 307);
}

// Run on everything (we'll early-return for non-coming-soon mode).
export const config = {
  matcher: ["/:path*"],
};
