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

export async function refundOrderAccessTokens(tx: any, orderId: string) {
  const released = await releaseOrderAccessTokenHolds(tx, orderId);
  if (released > 0) return released;

  const spends = await tx.accessTokenTransaction.findMany({
    where: { orderId, type: "SPENT", source: "SOLD_OUT_PURCHASE" },
    select: { sellerId: true, ticketId: true },
  });
  if (!spends.length) return 0;

  const existing = await tx.accessTokenTransaction.findMany({
    where: { orderId, type: "REVERSAL", source: "REFUND" },
    select: { ticketId: true },
  });
  const reversedTicketIds = new Set(existing.map((row: any) => row.ticketId).filter(Boolean));
  const missing = spends.filter((row: any) => row.ticketId && !reversedTicketIds.has(row.ticketId));
  if (!missing.length) return 0;

  const sellerId = missing[0].sellerId;
  const seller = await tx.seller.update({
    where: { id: sellerId },
    data: { accessTokenBalance: { increment: missing.length } },
    select: { accessTokenBalance: true },
  });
  await tx.accessTokenTransaction.createMany({
    data: missing.map((row: any, index: number) => ({
      sellerId,
      type: "REVERSAL",
      source: "REFUND",
      amountAccessTokens: 1,
      balanceAfterAccessTokens: seller.accessTokenBalance - missing.length + index + 1,
      note: `Access token returned because order ${orderId} was refunded`,
      referenceType: "Order",
      referenceId: orderId,
      orderId,
      ticketId: row.ticketId,
    })),
  });
  return missing.length;
}
