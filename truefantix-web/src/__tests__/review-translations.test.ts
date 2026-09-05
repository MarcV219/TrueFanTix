/** @jest-environment node */
jest.mock("@/lib/auth/guards", () => ({ requireVerifiedUser: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { review: { findMany: jest.fn() } } }));

import { POST } from "@/app/api/account/reviews/translations/route";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

const requireVerifiedUserMock = requireVerifiedUser as jest.Mock;
const findManyMock = prisma.review.findMany as jest.Mock;

describe("review translations", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    requireVerifiedUserMock.mockResolvedValue({
      ok: true,
      user: { id: "user-1", seller: { id: "seller-1" } },
    });
    findManyMock.mockResolvedValue([{ id: "review-1", content: "Quick delivery of tickets!" }]);
  });

  afterAll(() => {
    global.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalKey;
  });

  it("translates only reviews the signed-in customer can access", async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ translations: [{ id: "review-1", text: "Livraison rapide des billets!" }] }),
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await POST(new Request("https://truefantix.ca/api/account/reviews/translations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewIds: ["review-1", "review-not-visible"] }),
    }));

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
  });
});
