const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

let csrfTokenCache: string | null = null;
let csrfFetchInFlight: Promise<string | null> | null = null;

function isMutatingMethod(method?: string) {
  const upper = (method || "GET").toUpperCase();
  return !SAFE_METHODS.has(upper);
}

type JsonLike = { error?: string; message?: string; csrfToken?: string } | null;

async function readJsonSafe(res: Response): Promise<JsonLike> {
  try {
    return (await res.clone().json()) as JsonLike;
  } catch {
    return null;
  }
}

async function ensureCsrfToken(forceRefresh = false): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!forceRefresh && csrfTokenCache) return csrfTokenCache;
  if (!forceRefresh && csrfFetchInFlight) return csrfFetchInFlight;

  const run = (async () => {
    try {
      const res = await fetch("/api/auth/csrf", {
        method: "GET",
        cache: "no-store",
      });
      const data = await readJsonSafe(res);
      const token = typeof data?.csrfToken === "string" ? data.csrfToken : null;
      csrfTokenCache = token;
      return token;
    } catch {
      return null;
    } finally {
      csrfFetchInFlight = null;
    }
  })();

  csrfFetchInFlight = run;
  return run;
}

function isCsrfFailure(res: Response, data: JsonLike) {
  if (res.status !== 403) return false;
  const err = String(data?.error || "").toUpperCase();
  return err === "CSRF_MISSING" || err === "CSRF_INVALID";
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();
  const isMutating = isMutatingMethod(method);

  const headers = new Headers(init?.headers || undefined);

  if (isMutating && !headers.has("x-csrf-token")) {
    const token = await ensureCsrfToken(false);
    if (token) headers.set("x-csrf-token", token);
  }

  const send = (h: Headers) =>
    fetch(input, {
      ...init,
      method,
      headers: h,
      cache: init?.cache ?? "no-store",
    });

  let res = await send(headers);

  if (!isMutating) return res;

  const firstJson = await readJsonSafe(res);
  if (!isCsrfFailure(res, firstJson)) return res;

  const refreshed = await ensureCsrfToken(true);
  if (!refreshed) return res;

  const retryHeaders = new Headers(init?.headers || undefined);
  retryHeaders.set("x-csrf-token", refreshed);
  res = await send(retryHeaders);
  return res;
}

export async function fetchJson(path: string, init?: RequestInit) {
  const res = await apiFetch(path, init);
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { res, data, text };
}
