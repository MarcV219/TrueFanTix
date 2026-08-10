import { grantEarlyAccessReward } from "@/lib/earlyAccessReward";

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    earlyAccessLead: {
      findUnique: jest.fn().mockResolvedValue({
        id: "lead-1",
        accessTokenReward: 4,
        accessTokenRewardedAt: null,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    seller: {
      create: jest.fn().mockResolvedValue({ id: "seller-1" }),
      update: jest.fn().mockResolvedValue({ accessTokenBalance: 4 }),
    },
    user: { update: jest.fn().mockResolvedValue({}) },
    accessTokenTransaction: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  } as any;
}

const user = {
  id: "user-1",
  email: " Waitlist@Example.com ",
  firstName: "Wait",
  lastName: "Listed",
  sellerId: null,
};

describe("Early Access waitlist reward", () => {
  it("creates a buyer wallet and grants four tokens once", async () => {
    const tx = transaction();

    await expect(grantEarlyAccessReward(tx, user)).resolves.toEqual({
      granted: true,
      sellerId: "seller-1",
      amount: 4,
    });

    expect(tx.earlyAccessLead.findUnique).toHaveBeenCalledWith({
      where: { email: "waitlist@example.com" },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { sellerId: "seller-1", canSell: false },
    });
    expect(tx.seller.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "seller-1" },
      data: { accessTokenBalance: { increment: 4 } },
    }));
    expect(tx.accessTokenTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sellerId: "seller-1",
        amountAccessTokens: 4,
        referenceType: "EARLY_ACCESS_WAITLIST",
        referenceId: "lead-1",
      }),
    });
  });

  it("does nothing after the reward has already been claimed", async () => {
    const tx = transaction({
      earlyAccessLead: {
        findUnique: jest.fn().mockResolvedValue({
          id: "lead-1",
          accessTokenReward: 4,
          accessTokenRewardedAt: new Date(),
        }),
        updateMany: jest.fn(),
      },
    });

    await expect(grantEarlyAccessReward(tx, user)).resolves.toEqual({
      granted: false,
      sellerId: null,
      amount: 0,
    });
    expect(tx.seller.create).not.toHaveBeenCalled();
    expect(tx.accessTokenTransaction.create).not.toHaveBeenCalled();
  });

  it("uses an existing token wallet without creating another", async () => {
    const tx = transaction();
    const existingWalletUser = { ...user, sellerId: "seller-existing" };

    await grantEarlyAccessReward(tx, existingWalletUser);

    expect(tx.seller.create).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.seller.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "seller-existing" },
    }));
  });
});
