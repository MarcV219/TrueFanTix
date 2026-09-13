/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { POST } from "@/app/api/tickets/[id]/purchase/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    order: { findUnique: jest.fn() },
    ticket: { findUnique: jest.fn(), updateMany: jest.fn() },
    orderItem: { findFirst: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({ requireVerifiedUser: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({
  checkRateLimit: jest.fn(),
  getClientIp: jest.fn(() => "127.0.0.1"),
  rateLimitError: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  order: { findUnique: jest.Mock };
  ticket: { findUnique: jest.Mock; updateMany: jest.Mock };
  orderItem: { findFirst: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireVerifiedUser = requireVerifiedUser as jest.MockedFunction<
  typeof requireVerifiedUser
>;
const mockedCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;

const ordinaryUser = {
  id: "user-1",
  email: "buyer@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
  emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  phoneVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  isBanned: false,
  canBuy: true,
  seller: { id: "cm1234567890abcdefghijkl", accessTokenBalance: 2 },
};

const managedUser = {
  ...ordinaryUser,
  email: "admin@primary-staging.example.invalid",
  phone: "+15550001002",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
  canBuy: false,
  seller: null,
};

function request(buyerSellerId = "cm1234567890abcdefghijkl") {
  return new Request(
    `http://localhost/api/tickets/ticket-1/purchase?buyerSellerId=${buyerSellerId}&idempotencyKey=purchase-key-1`,
    {
      method: "POST",
      headers: { "idempotency-key": "purchase-key-1" },
    },
  );
}

describe("ticket purchase staging-persona boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckRateLimit.mockResolvedValue({ ok: true });
    mockedRequireVerifiedUser.mockResolvedValue({
      ok: true,
      user: { id: ordinaryUser.id, sellerId: "stale-wallet", canBuy: true },
    } as never);
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
  });

  it("refuses a restored managed user before order or ticket access", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await POST(request(), {});

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.ticket.findUnique).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);
    mockedPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" }),
    );

    const response = await POST(request(), {});

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
  });

  it("uses the current locked wallet for idempotency authorization", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.order.findUnique.mockResolvedValue({
      id: "order-1",
      buyerSellerId: ordinaryUser.seller.id,
      amountCents: 5000,
      adminFeeCents: 438,
      adminFeeTaxCents: 57,
      totalCents: 5495,
    });

    const response = await POST(request(), {});

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      replay: true,
      order: { id: "order-1", total: 54.95 },
    });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.ticket.findUnique).not.toHaveBeenCalled();
  });

  it("refuses an ordinary buying-capability downgrade beneath the lock", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryUser, canBuy: false });

    const response = await POST(request(), {});

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "BUYING_DISABLED" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
  });
});
