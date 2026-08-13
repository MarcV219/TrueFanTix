import type { Prisma } from "@prisma/client";

export const LAUNCH_PROMOTION_KEY = "PUBLIC_LAUNCH_2026";
export const LAUNCH_PROMOTION_START = new Date("2026-08-13T17:49:47.000Z");
export const LAUNCH_PROMOTION_TOKENS = 4;

export function launchPromotionIsActive(at = new Date()) {
  const configuredEnd = process.env.LAUNCH_PROMOTION_END_AT?.trim();
  const end = configuredEnd ? new Date(configuredEnd) : null;
  return at >= LAUNCH_PROMOTION_START && (!end || Number.isNaN(end.getTime()) || at <= end);
}

type PromotionUser = {
  id: string;
  firstName: string;
  lastName: string;
  sellerId: string | null;
};

async function ensureWallet(tx: Prisma.TransactionClient, user: PromotionUser) {
  if (user.sellerId) return user.sellerId;
  const seller = await tx.seller.create({
    data: { name: `${user.firstName} ${user.lastName}`.trim(), status: "NOT_STARTED" },
    select: { id: true },
  });
  await tx.user.update({ where: { id: user.id }, data: { sellerId: seller.id, canSell: false } });
  return seller.id;
}

async function recordAndAward(tx: Prisma.TransactionClient, params: {
  kind: "SIGNUP" | "SALE";
  referenceId: string;
  userId: string;
  sellerId: string;
  occurredAt: Date;
  ticketCount: number;
  tokens: number;
  orderId?: string;
}) {
  await tx.promotionParticipation.upsert({
    where: { promotionKey_kind_referenceId: { promotionKey: LAUNCH_PROMOTION_KEY, kind: params.kind, referenceId: params.referenceId } },
    create: {
      promotionKey: LAUNCH_PROMOTION_KEY,
      kind: params.kind,
      referenceId: params.referenceId,
      userId: params.userId,
      sellerId: params.sellerId,
      orderId: params.orderId,
      ticketCount: params.ticketCount,
      tokensAwarded: params.tokens,
      occurredAt: params.occurredAt,
    },
    update: {},
  });

  const claimed = await tx.promotionParticipation.updateMany({
    where: { promotionKey: LAUNCH_PROMOTION_KEY, kind: params.kind, referenceId: params.referenceId, awardedAt: null },
    data: { awardedAt: new Date() },
  });
  if (claimed.count !== 1) return { granted: false, amount: 0 };

  const seller = await tx.seller.update({
    where: { id: params.sellerId },
    data: { accessTokenBalance: { increment: params.tokens } },
    select: { accessTokenBalance: true },
  });
  await tx.accessTokenTransaction.create({
    data: {
      sellerId: params.sellerId,
      type: "EARNED",
      source: "PROMOTION",
      amountAccessTokens: params.tokens,
      balanceAfterAccessTokens: seller.accessTokenBalance,
      referenceType: `PROMOTION_${params.kind}`,
      referenceId: params.referenceId,
      orderId: params.orderId,
      note: params.kind === "SIGNUP" ? "Limited-time account signup bonus" : `Limited-time sale bonus (${params.ticketCount} ticket${params.ticketCount === 1 ? "" : "s"})`,
    },
  });
  return { granted: true, amount: params.tokens };
}

export async function awardLaunchSignup(tx: Prisma.TransactionClient, user: PromotionUser, occurredAt = new Date(), alreadyAwarded = 0) {
  if (!launchPromotionIsActive(occurredAt)) return { granted: false, amount: 0 };
  const sellerId = await ensureWallet(tx, user);
  if (alreadyAwarded >= LAUNCH_PROMOTION_TOKENS) {
    await tx.promotionParticipation.upsert({
      where: { promotionKey_kind_referenceId: { promotionKey: LAUNCH_PROMOTION_KEY, kind: "SIGNUP", referenceId: user.id } },
      create: { promotionKey: LAUNCH_PROMOTION_KEY, kind: "SIGNUP", referenceId: user.id, userId: user.id, sellerId, ticketCount: 0, tokensAwarded: LAUNCH_PROMOTION_TOKENS, occurredAt, awardedAt: new Date() },
      update: {},
    });
    return { granted: false, amount: 0 };
  }
  return recordAndAward(tx, { kind: "SIGNUP", referenceId: user.id, userId: user.id, sellerId, occurredAt, ticketCount: 0, tokens: LAUNCH_PROMOTION_TOKENS });
}

export async function awardLaunchSale(tx: Prisma.TransactionClient, params: { orderId: string; sellerId: string; ticketCount: number; occurredAt?: Date }) {
  const occurredAt = params.occurredAt ?? new Date();
  if (!launchPromotionIsActive(occurredAt) || params.ticketCount < 1) return { granted: false, amount: 0 };
  const seller = await tx.seller.findUnique({ where: { id: params.sellerId }, select: { user: { select: { id: true } } } });
  if (!seller?.user?.id) return { granted: false, amount: 0 };
  return recordAndAward(tx, {
    kind: "SALE",
    referenceId: params.orderId,
    userId: seller.user.id,
    sellerId: params.sellerId,
    orderId: params.orderId,
    occurredAt,
    ticketCount: params.ticketCount,
    tokens: params.ticketCount * LAUNCH_PROMOTION_TOKENS,
  });
}
