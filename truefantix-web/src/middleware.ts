import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "tft_session";

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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // COMING SOON MODE: Only allow homepage and early access API
  if (pathname === "/") {
    return NextResponse.next();
  }

  if (pathname === "/api/early-access") {
    return NextResponse.next();
  }

  // Block all other routes during coming soon mode
  // (Remove this redirect when ready to launch)
  return NextResponse.redirect(new URL("/", request.url));

  // LAUNCH MODE: Uncomment below and remove the redirect above when ready
  /*
  // Allow static files
  if (
    pathname.startsWith("/_next/") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Public routes
  if (pathname === "/login" || pathname === "/register") {
    return NextResponse.next();
  }

  // Protected routes - check session
  const protectedPaths = [
    "/checkout",
    "/account",
    "/community/new",
    "/community/reply",
    "/sell",
    "/admin",
  ];

  const isProtected = protectedPaths.some(p => pathname.startsWith(p));
  
  if (isProtected) {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token || !token.trim()) {
      return redirectToLogin(request);
    }
  }

  return NextResponse.next();
  */
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
