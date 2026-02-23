type Entry = { count: number; resetAt: number };

const buckets = new Map<string, Entry>();

function nowMs() {
  return Date.now();
}

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
}

export function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): { ok: true } | { ok: false; retryAfterSec: number } {
  const t = nowMs();
  const curr = buckets.get(params.key);

  if (!curr || t >= curr.resetAt) {
    buckets.set(params.key, { count: 1, resetAt: t + params.windowMs });
    return { ok: true };
  }

  if (curr.count >= params.limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((curr.resetAt - t) / 1000)) };
  }

  curr.count += 1;
  buckets.set(params.key, curr);
  return { ok: true };
}

export function rateLimitError(retryAfterSec: number) {
  return new Response(
    JSON.stringify({ ok: false, error: "RATE_LIMITED", message: "Too many requests. Please try again soon." }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(retryAfterSec),
      },
    }
  );
}
