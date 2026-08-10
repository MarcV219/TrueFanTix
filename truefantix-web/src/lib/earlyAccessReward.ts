import type { Prisma } from "@prisma/client";

export const EARLY_ACCESS_REWARD_TOKENS = 4;

type RewardUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  sellerId: string | null;
};

export async function grantEarlyAccessReward(
  tx: Prisma.TransactionClient,
  user: RewardUser
) {
  const email = user.email.trim().toLowerCase();
  const lead = await tx.earlyAccessLead.findUnique({ where: { email } });
  if (!lead || lead.accessTokenRewardedAt || lead.accessTokenReward <= 0) {
    return { granted: false, sellerId: user.sellerId, amount: 0 };
  }

  // Claiming inside the same transaction makes concurrent registration/backfill
  // attempts safe. A rollback also rolls back the claim.
  const claimed = await tx.earlyAccessLead.updateMany({
    where: { id: lead.id, accessTokenRewardedAt: null },
    data: { accessTokenRewardedAt: new Date(), accessTokenRewardUserId: user.id },
  });
  if (claimed.count !== 1) {
    return { granted: false, sellerId: user.sellerId, amount: 0 };
  }

  let sellerId = user.sellerId;
  if (!sellerId) {
    const seller = await tx.seller.create({
      data: {
        name: `${user.firstName} ${user.lastName}`.trim(),
        status: "NOT_STARTED",
      },
      select: { id: true },
    });
    sellerId = seller.id;
    await tx.user.update({
      where: { id: user.id },
      data: { sellerId, canSell: false },
    });
  }

  const updated = await tx.seller.update({
    where: { id: sellerId },
    data: { accessTokenBalance: { increment: lead.accessTokenReward } },
    select: { accessTokenBalance: true },
  });

  await tx.accessTokenTransaction.create({
    data: {
      sellerId,
      type: "EARNED",
      source: "ADMIN",
      amountAccessTokens: lead.accessTokenReward,
      balanceAfterAccessTokens: updated.accessTokenBalance,
      referenceType: "EARLY_ACCESS_WAITLIST",
      referenceId: lead.id,
      note: "Early Access waitlist reward",
    },
  });

  return { granted: true, sellerId, amount: lead.accessTokenReward };
}
