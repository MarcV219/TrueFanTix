import { RateLimitConfigs } from "./rate-limit-config";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";

type Entry = { count: number; resetAt: number };

const buckets = new Map<string, Entry>();

function nowMs() {
  return Date.now();
}

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || req.headers.get("remote-addr") || "unknown";
}

function checkMemoryRateLimit(params: {
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

async function checkUpstashRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<{ ok: true } | { ok: false; retryAfterSec: number } | null> {
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!baseUrl || !token) return null;

  const windowSeconds = Math.max(1, Math.ceil(params.windowMs / 1000));
  const script = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
if ttl < 0 then ttl = ARGV[1] end
if count > tonumber(ARGV[2]) then
  return {0, ttl}
end
return {1, ttl}
`;

  try {
    const res = await fetch(`${baseUrl}/eval`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        script,
        keys: [params.key],
        args: [String(windowSeconds), String(params.limit)],
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn("[RateLimit] Upstash call failed, falling back to memory store.", res.status);
      return null;
    }

    const payload = await res.json() as { result?: unknown };
    const result = payload?.result;
    if (!Array.isArray(result) || result.length < 2) return null;

    const allowed = Number(result[0]) === 1;
    const retryAfterSec = Math.max(1, Number(result[1]) || 1);
    if (!allowed) return { ok: false, retryAfterSec };
    return { ok: true };
  } catch (err) {
    console.warn("[RateLimit] Upstash error, falling back to memory store.", err);
    return null;
  }
}

export async function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const upstash = await checkUpstashRateLimit(params);
  if (upstash) return upstash;
  return checkMemoryRateLimit(params);
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

export async function applyRateLimit(req: Request, configKey: string): Promise<{ ok: true } | { ok: false; response: Response }> {
  const config = RateLimitConfigs[configKey];
  if (!config) {
    console.warn(`[RateLimit] No configuration found for key: ${configKey}. Using default.`);
    const defaultLimit = { limit: 5, windowMs: 60 * 1000 };
    const key = `default:${getClientIp(req)}`;
    const rl = await checkRateLimit({ key, ...defaultLimit });
    if (!rl.ok) return { ok: false, response: rateLimitError(rl.retryAfterSec) };
    return { ok: true };
  }

  let rateLimitIdentifier: string;
  const userId = await getUserIdFromSessionCookie();
  if (userId) {
    rateLimitIdentifier = `user:${userId}`;
  } else {
    rateLimitIdentifier = `ip:${getClientIp(req)}`;
  }

  const key = `rl:${configKey}:${rateLimitIdentifier}`;
  const rl = await checkRateLimit({ key, ...config });

  if (!rl.ok) {
    return { ok: false, response: rateLimitError(rl.retryAfterSec) };
  }

  return { ok: true };
}
