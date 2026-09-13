/** @jest-environment node */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { getPriceRecommendation } from "@/lib/pricing";
import { GET } from "@/app/api/pricing/recommendation/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    ticket: { findMany: jest.fn() },
    seller: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth/guards", () => ({ requireUser: jest.fn() }));
jest.mock("@/lib/pricing", () => ({
  getPriceRecommendation: jest.fn(),
  getPriceTrends: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  ticket: { findMany: jest.Mock };
  seller: { findUnique: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireUser = requireUser as jest.MockedFunction<typeof requireUser>;
const mockedRecommendation = getPriceRecommendation as jest.MockedFunction<typeof getPriceRecommendation>;

const ordinaryUser = {
  id: "user-1",
  email: "ordinary@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
  seller: { id: "seller-current" },
};

const managedUser = {
  ...ordinaryUser,
  email: "admin@primary-staging.example.invalid",
  phone: "+15550001002",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
  seller: null,
};

const recommendation = {
  recommendedPriceCents: 10000,
  priceRange: { min: 8000, max: 12000 },
  confidence: 80,
  reasoning: [],
  marketData: {
    averagePrice: 10000,
    medianPrice: 10000,
    lowestPrice: 9000,
    highestPrice: 11000,
    totalListings: 3,
    soldInLast30Days: 1,
    demandScore: 50,
  },
  factors: [],
};

function request() {
  return new Request(
    "https://preview.example/api/pricing/recommendation?eventTitle=Test%20Event&venue=Test%20Venue&date=2026-10-01&faceValue=80",
  );
}

describe("pricing recommendation staging-persona boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRequireUser.mockResolvedValue({ ok: true, user: ordinaryUser } as never);
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedRecommendation.mockResolvedValue(recommendation);
  });

  afterEach(() => jest.restoreAllMocks());

  it("returns the authorization refusal before validation or pricing work", async () => {
    const refusal = NextResponse.json(
      { ok: false, error: "STAGING_CONSOLE_ONLY" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
    mockedRequireUser.mockResolvedValue({ ok: false, res: refusal });

    const response = await GET(request());

    expect(response).toBe(refusal);
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedRecommendation).not.toHaveBeenCalled();
  });

  it("locks the current user and passes the current seller plus transaction client", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 30_000,
    });
    expect(mockedRecommendation).toHaveBeenCalledWith(expect.objectContaining({
      sellerId: "seller-current",
      faceValueCents: 8000,
      db: mockedPrisma,
    }));
  });

  it("refuses a restored managed user before pricing data access", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedRecommendation).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" }),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mockedRecommendation).not.toHaveBeenCalled();
  });

  it("retains the existing server-error response for unrelated pricing failures", async () => {
    mockedRecommendation.mockRejectedValue(new Error("pricing unavailable"));

    const response = await GET(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "SERVER_ERROR" });
  });
});
