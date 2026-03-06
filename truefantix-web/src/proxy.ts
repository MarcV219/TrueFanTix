import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Coming-soon lockdown
 *
 * In Next.js 16, Proxy is the supported request guard entrypoint.
 * When coming soon mode is active, allow only:
 * - GET /
 * - /api/early-access
 * - required static assets
 *
 * Everything else redirects back to /.
 */
export function proxy(req: NextRequest) {
  const mode = (process.env.COMING_SOON_MODE ?? "").trim().toLowerCase();
  const comingSoonExplicit =
    mode === "1" || mode === "true" || mode === "yes" || mode === "on";

  const hostname = req.nextUrl.hostname.toLowerCase();
  const isPublicDomain = [
    "truefantix.com",
    "www.truefantix.com",
    "truefantix.ca",
    "www.truefantix.ca",
  ].includes(hostname);

  // Fail-safe: keep public domains locked down unless explicitly disabled.
  const comingSoon =
    comingSoonExplicit ||
    (isPublicDomain && mode !== "0" && mode !== "false" && mode !== "off");

  if (!comingSoon) return NextResponse.next();

  const { pathname } = req.nextUrl;

  if (pathname === "/") return NextResponse.next();
  if (pathname === "/api/early-access") return NextResponse.next();

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

  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  return NextResponse.redirect(url, 307);
}

export const config = {
  matcher: ["/:path*"],
};
