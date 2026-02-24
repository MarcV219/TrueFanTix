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

  // Allow static files and Next.js internals
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") === false && pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Block all other routes - redirect to homepage
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
