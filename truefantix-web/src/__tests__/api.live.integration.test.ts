import { execSync } from "child_process";

const BASE_URL = process.env.LIVE_BASE_URL || "https://truefantix-web.vercel.app";

type CurlResult = { status: number; body: any };

function curlJson(method: string, path: string, body?: unknown): CurlResult {
  const dataArg = body !== undefined ? `--data '${JSON.stringify(body).replace(/'/g, "'\\''")}'` : "";
  const cmd = `curl -sS -X ${method} '${BASE_URL}${path}' -H 'content-type: application/json' ${dataArg} -w '\n%{http_code}'`;
  const out = execSync(cmd, { encoding: "utf8" });
  const lines = out.trimEnd().split("\n");
  const status = Number(lines.pop() || "0");
  const rawBody = lines.join("\n").trim();
  let parsed: any = {};
  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    parsed = { raw: rawBody };
  }
  return { status, body: parsed };
}

describe("live API integration (dev env)", () => {
  jest.setTimeout(30000);

  it("POST /api/orders/checkout is protected before reservation", () => {
    const res = curlJson("POST", "/api/orders/checkout", { ticketIds: [], buyerSellerId: "bad" });
    // 400 = older deployed validation-first behavior; 401/403 = hardened auth/CSRF-first behavior.
    expect([400, 401, 403]).toContain(res.status);
  });

  it("POST /api/auth/register rejects invalid payload", () => {
    const res = curlJson("POST", "/api/auth/register", { email: "not-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("POST /api/auth/forgot-password rejects malformed email or rate limits", () => {
    const res = curlJson("POST", "/api/auth/forgot-password", { email: "not-an-email" });
    expect([400, 429]).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toBe("VALIDATION_ERROR");
    }
  });

  it("POST /api/payments/create-intent is protected", () => {
    const res = curlJson("POST", "/api/payments/create-intent", { orderId: "ckx1234567890abcdef123458" });
    expect([401, 403]).toContain(res.status);
  });

  it("POST /api/tickets/:id/purchase is protected", () => {
    const res = curlJson(
      "POST",
      "/api/tickets/ckx1234567890abcdef123458/purchase?buyerSellerId=ckx1234567890abcdef123459&idempotencyKey=idem_1234567890",
      {}
    );
    expect([401, 403]).toContain(res.status);
  });

  it("GET /api/tickets/search returns the search page contract", () => {
    const res = curlJson("GET", "/api/tickets/search?q=Toronto&limit=2");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.tickets)).toBe(true);
    expect(res.body.tickets.length).toBeGreaterThan(0);
    expect(res.body).toHaveProperty("nextCursor");
    expect(typeof res.body.hasMore).toBe("boolean");

    // Back-compat for older callers that used the first route shape.
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.pagination).toEqual(
      expect.objectContaining({
        total: expect.any(Number),
        limit: expect.any(Number),
        hasMore: expect.any(Boolean),
      })
    );
  });

  it("GET /api/sellers returns stable JSON instead of broad Prisma drift failures", () => {
    const res = curlJson("GET", "/api/sellers");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.sellers)).toBe(true);
    expect(res.body.sellers.length).toBeGreaterThan(0);
    expect(res.body.sellers[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        name: expect.any(String),
        rating: expect.any(Number),
        reviews: expect.any(Number),
        badges: expect.any(Array),
      })
    );
  });
});
