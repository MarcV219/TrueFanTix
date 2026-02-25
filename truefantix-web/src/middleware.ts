import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Simple in-memory rate limiter (use Redis in production)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const DEFAULT_LIMIT: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
};

const STRICT_LIMIT: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10,
};

const API_LIMITS: Record<string, RateLimitConfig> = {
  "/api/auth": { windowMs: 60 * 1000, maxRequests: 5 },
  "/api/orders/checkout": { windowMs: 60 * 1000, maxRequests: 3 },
  "/api/payments": { windowMs: 60 * 1000, maxRequests: 5 },
  "/api/tickets": { windowMs: 60 * 1000, maxRequests: 20 },
};

function getClientId(req: NextRequest): string {
  // Use IP + user agent hash, or authenticated user ID
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  const ua = req.headers.get("user-agent") || "";
  return `${ip}:${ua.slice(0, 50)}`;
}

function isRateLimited(clientId: string, config: RateLimitConfig): { limited: boolean; retryAfter: number } {
  const now = Date.now();
  const key = `${clientId}:${config.windowMs}`;
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetTime) {
    // New window
    rateLimitMap.set(key, {
      count: 1,
      resetTime: now + config.windowMs,
    });
    return { limited: false, retryAfter: 0 };
  }

  if (record.count >= config.maxRequests) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);
    return { limited: true, retryAfter };
  }

  record.count++;
  return { limited: false, retryAfter: 0 };
}

export function middleware(req: NextRequest) {
  // Skip rate limiting for health checks and static assets
  if (req.nextUrl.pathname.startsWith("/_next") || 
      req.nextUrl.pathname === "/api/health") {
    return NextResponse.next();
  }

  // Get rate limit config for this path
  let config = DEFAULT_LIMIT;
  for (const [path, pathConfig] of Object.entries(API_LIMITS)) {
    if (req.nextUrl.pathname.startsWith(path)) {
      config = pathConfig;
      break;
    }
  }

  const clientId = getClientId(req);
  const { limited, retryAfter } = isRateLimited(clientId, config);

  if (limited) {
    return NextResponse.json(
      {
        ok: false,
        error: "RATE_LIMIT_EXCEEDED",
        message: `Too many requests. Please try again in ${retryAfter} seconds.`,
        retryAfter,
      },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(config.maxRequests),
          "X-RateLimit-Reset": String(Math.ceil(Date.now() / 1000) + retryAfter),
          "Retry-After": String(retryAfter),
        },
      }
    );
  }

  // Add security headers
  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
