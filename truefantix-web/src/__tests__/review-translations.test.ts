/** @jest-environment node */
jest.mock("@/lib/auth/guards", () => ({ requireVerifiedUser: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    review: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

import { POST } from "@/app/api/account/reviews/translations/route";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

const requireVerifiedUserMock = requireVerifiedUser as jest.Mock;
const findManyMock = prisma.review.findMany as jest.Mock;
const findUserMock = prisma.user.findUnique as jest.Mock;
const queryRawMock = prisma.$queryRaw as jest.Mock;
const transactionMock = prisma.$transaction as jest.Mock;

const ordinaryUser = {
  id: "user-1",
  email: "ordinary@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
  seller: { id: "seller-1" },
};

const managedUser = {
  ...ordinaryUser,
  email: "reviewer@primary-staging.example.invalid",
  phone: "+15550001003",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
  seller: null,
};

function request() {
  return new Request("https://truefantix.ca/api/account/reviews/translations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewIds: ["review-1", "review-not-visible"] }),
  });
}

describe("review translations", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    requireVerifiedUserMock.mockResolvedValue({
      ok: true,
      user: ordinaryUser,
    });
    findUserMock.mockResolvedValue(ordinaryUser);
    findManyMock.mockResolvedValue([{ id: "review-1", content: "Quick delivery of tickets!" }]);
    queryRawMock.mockResolvedValue([]);
    transactionMock.mockImplementation(async (work: (tx: typeof prisma) => unknown) => work(prisma));
  });

  afterAll(() => {
    global.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalKey;
  });

  it("translates only reviews the signed-in customer can access", async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ translations: [{ id: "review-1", text: "Livraison rapide des billets!" }] }),
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      translations: { "review-1": "Livraison rapide des billets!" },
    });
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ["review-1", "review-not-visible"] },
        OR: [{ reviewerId: "user-1" }, { sellerId: "seller-1" }],
      }),
    }));
    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
  });

  it("uses the current seller binding rather than the session snapshot", async () => {
    findUserMock.mockResolvedValue({ ...ordinaryUser, seller: { id: "seller-current" } });
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ translations: [] }),
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ reviewerId: "user-1" }, { sellerId: "seller-current" }],
      }),
    }));
  });

  it("refuses a restored managed account before review lookup or provider use", async () => {
    findUserMock.mockResolvedValue(managedUser);
    global.fetch = jest.fn();

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(findManyMock).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    transactionMock.mockRejectedValue(Object.assign(new Error("serialization failure"), { code: "P2034" }));
    findUserMock.mockResolvedValue(managedUser);
    global.fetch = jest.fn();

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(findManyMock).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps unrelated provider failures classified as translation failures", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    global.fetch = jest.fn().mockResolvedValue(new Response("upstream failed", { status: 503 }));

    const response = await POST(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "TRANSLATION_FAILED" });
  });

  it("does not mask an unrelated transaction failure", async () => {
    const failure = new Error("database unavailable");
    transactionMock.mockRejectedValue(failure);
    findUserMock.mockResolvedValue(ordinaryUser);

    await expect(POST(request())).rejects.toBe(failure);
  });
});
