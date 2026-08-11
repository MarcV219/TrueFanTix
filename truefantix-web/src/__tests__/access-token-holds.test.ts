import { consumeOrderAccessTokenHolds, releaseOrderAccessTokenHolds } from "@/lib/accessTokenHolds";

describe("access token holds", () => {
  it("converts pending holds to final spends without changing the wallet again", async () => {
    const tx = {
      accessTokenTransaction: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };

    await expect(consumeOrderAccessTokenHolds(tx, "order-1")).resolves.toBe(2);
    expect(tx.accessTokenTransaction.updateMany).toHaveBeenCalledWith({
      where: { orderId: "order-1", type: "HELD", source: "SOLD_OUT_PURCHASE" },
      data: {
        type: "SPENT",
        note: "Access token consumed when order order-1 completed",
      },
    });
  });

  it("returns held tokens exactly once when an order does not complete", async () => {
    const tx = {
      accessTokenTransaction: {
        findMany: jest.fn().mockResolvedValue([
          { id: "hold-1", sellerId: "buyer-1" },
          { id: "hold-2", sellerId: "buyer-1" },
        ]),
        updateMany: jest.fn()
          .mockResolvedValueOnce({ count: 2 })
          .mockResolvedValueOnce({ count: 2 }),
      },
      seller: {
        update: jest.fn().mockResolvedValue({ accessTokenBalance: 4 }),
      },
    };

    await expect(releaseOrderAccessTokenHolds(tx, "order-1")).resolves.toBe(2);
    expect(tx.seller.update).toHaveBeenCalledWith({
      where: { id: "buyer-1" },
      data: { accessTokenBalance: { increment: 2 } },
      select: { accessTokenBalance: true },
    });
  });

  it("is idempotent after holds have already been finalized", async () => {
    const tx = {
      accessTokenTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      seller: { update: jest.fn() },
    };

    await expect(releaseOrderAccessTokenHolds(tx, "order-1")).resolves.toBe(0);
    expect(tx.seller.update).not.toHaveBeenCalled();
  });
});
