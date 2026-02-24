import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow the homepage (landing page)
  if (pathname === "/") {
    return NextResponse.next();
  }

  // Allow early access API endpoint
  if (pathname === "/api/early-access") {
    return NextResponse.next();
  }

  // Allow cron endpoints
  if (pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  // Allow static assets
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/fonts/") ||
    pathname.match(/\.(ico|png|jpg|jpeg|gif|svg|css|js|woff|woff2)$/)
  ) {
    return NextResponse.next();
  }

  // Block all other routes during coming soon mode
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: "/:path*",
};
