export type RateLimitConfig = {
  limit: number;
  windowMs: number; // in milliseconds
};

export const RateLimitConfigs: Record<string, RateLimitConfig> = {
  // Default lenient limit for most authenticated reads (e.g., fetching user data)
  DEFAULT_AUTH_READ: { limit: 100, windowMs: 60 * 1000 }, // 100 requests per minute
  // Default for unauthenticated reads
  DEFAULT_UNAUTH_READ: { limit: 200, windowMs: 60 * 1000 }, // 200 requests per minute

  // --- Authentication & Account --- //
  "auth:login": { limit: 10, windowMs: 5 * 60 * 1000 }, // 10 requests per 5 minutes per IP
  "auth:register": { limit: 5, windowMs: 15 * 60 * 1000 }, // 5 requests per 15 minutes per IP
  "auth:forgot-password-request": { limit: 3, windowMs: 10 * 60 * 1000 }, // 3 requests per 10 minutes per IP
  "auth:forgot-password-reset": { limit: 5, windowMs: 5 * 60 * 1000 }, // 5 requests per 5 minutes per IP
  "account:delete": { limit: 1, windowMs: 60 * 60 * 1000 }, // 1 request per hour
  "account:profile-update": { limit: 15, windowMs: 60 * 1000 }, // 15 requests per minute
  "account:security-password-change": { limit: 5, windowMs: 10 * 60 * 1000 }, // 5 requests per 10 minutes

  // --- Verification (Email/Phone) --- //
  "verify:email:send": { limit: 3, windowMs: 10 * 60 * 1000 }, // 3 sends per 10 minutes per user
  "verify:email:confirm": { limit: 10, windowMs: 5 * 60 * 1000 }, // 10 attempts per 5 minutes per user
  "verify:phone:send": { limit: 3, windowMs: 10 * 60 * 1000 }, // 3 sends per 10 minutes per user
  "verify:phone:confirm": { limit: 10, windowMs: 5 * 60 * 1000 }, // 10 attempts per 5 minutes per user

  // --- Tickets --- //
  "tickets:create": { limit: 10, windowMs: 60 * 60 * 1000 }, // 10 ticket listings per hour per seller
  "tickets:purchase": { limit: 5, windowMs: 5 * 60 * 1000 }, // 5 purchases per 5 minutes per buyer
  "tickets:search": { limit: 60, windowMs: 60 * 1000 }, // 60 searches per minute (can be higher, heavy traffic)
  "tickets:view": { limit: 200, windowMs: 60 * 1000 }, // 200 views per minute per IP for a specific ticket

  // --- Orders & Payments --- //
  "orders:checkout": { limit: 5, windowMs: 5 * 60 * 1000 }, // 5 checkouts per 5 minutes per user
  "payments:create-intent": { limit: 10, windowMs: 5 * 60 * 1000 }, // 10 payment intents per 5 minutes per user

  // --- Seller specific actions --- //
  "seller:onboarding:start": { limit: 3, windowMs: 60 * 60 * 1000 }, // 3 attempts per hour for onboarding start
  "seller:dashboard:view": { limit: 30, windowMs: 60 * 1000 }, // 30 dashboard views per minute

  // --- Community & Forum --- //
  "forum:create-thread": { limit: 3, windowMs: 10 * 60 * 1000 }, // 3 threads per 10 minutes per user
  "forum:create-post": { limit: 10, windowMs: 5 * 60 * 1000 }, // 10 posts per 5 minutes per user
  "community:comments:create": { limit: 10, windowMs: 5 * 60 * 1000 }, // 10 comments per 5 minutes per user

  // --- Admin actions (should be much stricter) --- //
  "admin:user-action": { limit: 5, windowMs: 60 * 1000 }, // 5 admin actions per minute
  "admin:order-capture": { limit: 10, windowMs: 60 * 1000 }, // 10 capture attempts per minute
  "admin:reservation-expire": { limit: 6, windowMs: 60 * 1000 }, // 6 forced expire runs per minute
  "admin:data-export": { limit: 1, windowMs: 60 * 60 * 1000 }, // 1 export per hour

  // --- Debug/Internal (should be very strict or completely blocked in prod) --- //
  "debug:general": { limit: 1, windowMs: 60 * 60 * 1000 }, // 1 request per hour for debug endpoints
  "health:check": { limit: 300, windowMs: 60 * 1000 }, // very high limit for health checks
};
