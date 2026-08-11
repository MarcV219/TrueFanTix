export async function releaseOrderAccessTokenHolds(tx: any, orderId: string) {
  const holds = await tx.accessTokenTransaction.findMany({
    where: { orderId, type: "HELD", source: "SOLD_OUT_PURCHASE" },
    select: { id: true, sellerId: true },
  });

  if (!holds.length) return 0;

  const sellerIds = Array.from(new Set(holds.map((hold: any) => hold.sellerId)));
  let released = 0;

  for (const sellerId of sellerIds) {
    const sellerHolds = holds.filter((hold: any) => hold.sellerId === sellerId);
    const updated = await tx.accessTokenTransaction.updateMany({
      where: { id: { in: sellerHolds.map((hold: any) => hold.id) }, type: "HELD" },
      data: {
        type: "RELEASED",
        amountAccessTokens: 1,
        note: `Access token hold released because order ${orderId} did not complete`,
      },
    });

    if (updated.count > 0) {
      const seller = await tx.seller.update({
        where: { id: sellerId },
        data: { accessTokenBalance: { increment: updated.count } },
        select: { accessTokenBalance: true },
      });
      await tx.accessTokenTransaction.updateMany({
        where: { id: { in: sellerHolds.map((hold: any) => hold.id) }, type: "RELEASED" },
        data: { balanceAfterAccessTokens: seller.accessTokenBalance },
      });
      released += updated.count;
    }
  }

  return released;
}

export async function consumeOrderAccessTokenHolds(tx: any, orderId: string) {
  const result = await tx.accessTokenTransaction.updateMany({
    where: { orderId, type: "HELD", source: "SOLD_OUT_PURCHASE" },
    data: {
      type: "SPENT",
      note: `Access token consumed when order ${orderId} completed`,
    },
  });
  return result.count;
}
