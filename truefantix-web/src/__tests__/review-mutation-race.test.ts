/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { validateRequest } from "@/lib/validation";
import { updateSellerBadges } from "@/lib/reputation";
import { DELETE, PATCH, POST } from "@/app/api/reviews/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), findFirst: jest.fn() },
    order: { findUnique: jest.fn() },
    review: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
    },
    seller: { update: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({ requireUser: jest.fn() }));

jest.mock("@/lib/validation", () => ({
  schemas: {
    reviewCreateApi: { kind: "create" },
    reviewUpdateApi: { kind: "update" },
    reviewDeleteQuery: { safeParse: jest.fn(() => ({ success: true, data: { id: "review-1" } })) },
  },
  validateRequest: jest.fn(),
}));

jest.mock("@/lib/reputation", () => ({ updateSellerBadges: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; findFirst: jest.Mock };
  order: { findUnique: jest.Mock };
  review: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    aggregate: jest.Mock;
  };
  seller: { update: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireUser = requireUser as jest.MockedFunction<typeof requireUser>;
const mockedValidateRequest = validateRequest as jest.Mock;
const mockedUpdateSellerBadges = updateSellerBadges as jest.MockedFunction<typeof updateSellerBadges>;

const ordinaryUser = {
  id: "user-1",
  email: "ordinary@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
};

const managedUser = {
  ...ordinaryUser,
  email: "admin@primary-staging.example.invalid",
  phone: "+15550001002",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
};

const review = {
  id: "review-1",
  orderId: "order-1",
  sellerId: "seller-1",
  reviewerId: ordinaryUser.id,
  rating: 4,
  title: "Good",
  content: "Worked well",
  createdAt: new Date(),
};

function request(method: "POST" | "PATCH" | "DELETE") {
  return new Request("https://preview.example/api/reviews?id=review-1", { method });
}

describe("review mutation staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRequireUser.mockResolvedValue({ ok: true, user: ordinaryUser } as never);
    mockedValidateRequest.mockImplementation((schema: { kind: string }) => jest.fn().mockResolvedValue({
      success: true,
      data: schema.kind === "create"
        ? { orderId: "order-1", rating: 5, title: "Great", content: "Excellent", aspects: null }
        : { reviewId: "review-1", rating: 5, title: "Updated", content: "Even better" },
    }));
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.user.findFirst.mockResolvedValue({ id: ordinaryUser.id });
    mockedPrisma.order.findUnique.mockResolvedValue({
      id: "order-1",
      status: "COMPLETED",
      sellerId: "seller-1",
      buyerSellerId: "buyer-seller-1",
      seller: {},
      buyerSeller: {},
      items: [],
    });
    mockedPrisma.review.findUnique.mockResolvedValue(null);
    mockedPrisma.review.findFirst.mockResolvedValue(review);
    mockedPrisma.review.create.mockResolvedValue(review);
    mockedPrisma.review.update.mockResolvedValue({ ...review, rating: 5 });
    mockedPrisma.review.delete.mockResolvedValue(review);
    mockedPrisma.review.aggregate.mockResolvedValue({ _avg: { rating: 5 }, _count: { id: 1 } });
    mockedPrisma.seller.update.mockResolvedValue({ id: "seller-1" });
    mockedPrisma.$queryRaw.mockResolvedValue([{ id: ordinaryUser.id }]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedUpdateSellerBadges.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ["create", POST, "POST"],
    ["update", PATCH, "PATCH"],
    ["delete", DELETE, "DELETE"],
  ] as const)("locks and rechecks the reviewer before a %s mutation", async (_name, handler, method) => {
    const response = await handler(request(method));

    expect(response.status).toBe(method === "POST" ? 201 : 200);
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: ordinaryUser.id },
      select: {
        email: true,
        phone: true,
        termsVersion: true,
        privacyVersion: true,
      },
    });
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
  });

  it.each([
    ["create", POST, "POST"],
    ["update", PATCH, "PATCH"],
    ["delete", DELETE, "DELETE"],
  ] as const)("refuses a persona restored before the locked %s mutation", async (_name, handler, method) => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await handler(request(method));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
    });
    expect(mockedPrisma.review.create).not.toHaveBeenCalled();
    expect(mockedPrisma.review.update).not.toHaveBeenCalled();
    expect(mockedPrisma.review.delete).not.toHaveBeenCalled();
    expect(mockedPrisma.seller.update).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization loss after persona restoration", async () => {
    mockedPrisma.$transaction.mockRejectedValue(new Error("serialization conflict"));
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await POST(request("POST"));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
  });

  it("does not misclassify an unrelated review failure as staging", async () => {
    mockedPrisma.$transaction.mockRejectedValue(new Error("review write failed"));

    const response = await POST(request("POST"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "SERVER_ERROR" });
  });
});
