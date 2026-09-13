/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { awardLaunchSale } from "@/lib/launchPromotion";
import { POST } from "@/app/api/admin/orders/[id]/complete/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    order: { findUnique: jest.fn(), updateMany: jest.fn() },
    sellerMetrics: { upsert: jest.fn() },
    payout: { create: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth/guards", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/accessTokenHolds", () => ({ consumeOrderAccessTokenHolds: jest.fn() }));
jest.mock("@/lib/launchPromotion", () => ({ awardLaunchSale: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  order: { findUnique: jest.Mock; updateMany: jest.Mock };
  sellerMetrics: { upsert: jest.Mock };
  payout: { create: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockedAwardLaunchSale = awardLaunchSale as jest.MockedFunction<typeof awardLaunchSale>;

const orderId = "cm1234567890abcdefghijkl";
const ordinaryAdmin = {
  email: "admin@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
  emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  phoneVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  isBanned: false,
  role: "ADMIN",
};
const managedAdmin = {
  ...ordinaryAdmin,
  email: "admin@primary-staging.example.invalid",
  phone: "+15550001002",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
};

function request() {
  return new Request(`http://localhost/api/admin/orders/${orderId}/complete`, {
    method: "POST",
  });
}

describe("admin order completion staging-persona boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireAdmin.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryAdmin);
    mockedPrisma.order.findUnique
      .mockResolvedValueOnce({
        id: orderId,
        status: "DELIVERED",
        buyerConfirmationStatus: "CONFIRMED",
        buyerConfirmationAt: new Date("2026-01-01T00:02:00.000Z"),
        buyerSellerId: "buyer-seller-1",
        sellerId: "seller-1",
        amountCents: 5495,
        items: [{
          id: "item-1",
          ticketId: "ticket-1",
          ticket: { status: "SOLD", event: { selloutStatus: "AVAILABLE" } },
        }],
        payment: { id: "payment-1", status: "SUCCEEDED" },
      })
      .mockResolvedValueOnce({
        id: orderId,
        status: "COMPLETED",
        items: [{ id: "item-1", ticketId: "ticket-1" }],
        payment: { id: "payment-1", status: "SUCCEEDED" },
      });
    mockedPrisma.order.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.sellerMetrics.upsert.mockResolvedValue({ sellerId: "seller-1" });
    mockedPrisma.payout.create.mockResolvedValue({
      id: "payout-1",
      status: "PENDING",
      netCents: 5495,
    });
    mockedAwardLaunchSale.mockResolvedValue({ granted: false, amount: 0 });
  });

  it("refuses a restored managed administrator before payout mutation", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedAdmin);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.order.updateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.payout.create).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedAdmin);
    mockedPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" }),
    );

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.payout.create).not.toHaveBeenCalled();
  });

  it("refuses an ordinary role downgrade before payout mutation", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryAdmin, role: "USER" });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "FORBIDDEN" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.payout.create).not.toHaveBeenCalled();
  });

  it("completes and creates its pending payout through one serializable transaction", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      order: { id: orderId, status: "COMPLETED" },
      escrowRelease: { payoutId: "payout-1", payoutStatus: "PENDING", netCents: 5495 },
    });
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockedPrisma.order.updateMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.sellerMetrics.upsert).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.payout.create).toHaveBeenCalledTimes(1);
  });
});
