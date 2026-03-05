# Security Hardening Notes (TASK: TFTX-prod-hardening-batch-001)

## New environment variables

Set these in production:

- `PASSWORD_RESET_SECRET` (required, min 32 chars)
- `APP_ORIGIN` (recommended, full origin, e.g. `https://app.truefantix.com`)
- `CRON_SECRET` (required if using internal cron trigger for reservation expiry)
- `UPSTASH_REDIS_REST_URL` (recommended for durable rate limit across Vercel instances)
- `UPSTASH_REDIS_REST_TOKEN` (paired with `UPSTASH_REDIS_REST_URL`)

## Admin reservation expiry invocation

`POST /api/admin/reservations/expire`

Auth options:

1. Admin session + CSRF header (browser/admin tooling)
2. Internal cron header:

```bash
curl -X POST "https://<your-domain>/api/admin/reservations/expire" \
  -H "x-cron-secret: ${CRON_SECRET}"
```

Without one of the above, the route returns 401/403 and will not mutate order/ticket state.

## CSRF strategy

Implemented **double-submit cookie** pattern:

- CSRF cookie: `tft_csrf` (SameSite=Strict, non-httpOnly)
- State-changing requests must include `x-csrf-token` header matching cookie value
- Origin/referer check compares request origin to `APP_ORIGIN` / `NEXT_PUBLIC_APP_URL`

Token acquisition:

- Login response returns `{ csrfToken, csrfCookie }`
- Optional endpoint `GET /api/auth/csrf` returns/rotates token and sets cookie

## Rate limiting in production

Rate limiting now supports Upstash Redis REST (durable across serverless instances).

- If Upstash env vars are set, limiter uses Redis `INCR + EXPIRE` via Lua script.
- If unset (local/dev), it safely falls back to in-memory limiter.
