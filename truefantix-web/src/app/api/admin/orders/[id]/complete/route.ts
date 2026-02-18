export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OrderStatus, Prisma } from "@prisma/client";

const CREDIT_AWARD_PER_SOLDOUT_SALE = 1; // seller earns per sold-out ticket
const CREDIT_COST_PER_SOLDOUT_PURCHASE = 1; // buyer spends per sold-out ticket

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

function parseOrderIdFromUrl(req: Request): string {
  // /api/admin/orders/<id>/complete
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const ordersIndex = parts.indexOf("orders");
  if (ordersIndex !== -1 && parts.length > ordersIndex + 1) {
    return normalizeId(parts[ordersIndex + 1]);
  }
  return "";
}

function uniqStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function createCreditTxnIdempotent(
  tx: Prisma.TransactionClient,
  data: Prisma.CreditTransactionCreateInput
) {
  try {
    await tx.creditTransaction.create({ data });
    return true; // created now
  } catch (e: any) {
    // Unique constraint violation => already exists => idempotent success
    if (e?.code === "P2002") return false;
    throw e;
  }
}

export async function POST(req: Request) {
  try {
    const orderId = parseOrderIdFromUrl(req);
    if (!orderId) {
      return NextResponse.json(
        { ok: false, error: "Missing order id", debug: { url: req.url } },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Load order + items + tickets + event sellout
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { ticket: { include: { event: true } } } },
          payment: true,
        },
      });

      if (!order) {
        return {
          ok: false as const,
          status: 404 as const,
          body: { ok: false, error: "Order not found" },
        };
      }

      // Idempotent replay shortcut
      if (order.status === OrderStatus.COMPLETED) {
        return {
          ok: true as const,
          status: 200 as const,
          body: { ok: true, replay: true, order },
        };
      }

      if (order.status !== OrderStatus.DELIVERED) {
        return {
          ok: false as const,
          status: 409 as const,
          body: {
            ok: false,
            error: "Order must be DELIVERED before it can be COMPLETED",
            debug: { orderId, status: order.status },
          },
        };
      }

      if (!order.payment || order.payment.status !== "SUCCEEDED") {
        return {
          ok: false as const,
          status: 409 as const,
          body: {
            ok: false,
            error: "Cannot complete: payment is not SUCCEEDED",
            debug: { payment: order.payment ?? null },
          },
        };
      }

      // Validate all tickets are SOLD (delivery step should have done this)
      const notSold = order.items
        .filter((i) => i.ticket?.status !== "SOLD")
        .map((i) => ({ ticketId: i.ticketId, status: i.ticket?.status ?? null }));

      if (notSold.length) {
        return {
          ok: false as const,
          status: 409 as const,
          body: {
            ok: false,
            error: "Cannot complete: one or more tickets are not SOLD",
            debug: { notSold },
          },
        };
      }

      /**
       * ✅ CONCURRENCY GATE / LOCK
       * Only one caller can transition DELIVERED -> COMPLETED.
       * Everyone else becomes replay.
       *
       * This also prevents double-increment of sellerMetrics under concurrent completes.
       */
      const gate = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.DELIVERED },
        data: { status: OrderStatus.COMPLETED },
      });

      if (gate.count === 0) {
        // Someone else got there first, or status changed unexpectedly.
        const fresh = await tx.order.findUnique({
          where: { id: orderId },
          include: { items: true, payment: true },
        });

        if (fresh?.status === OrderStatus.COMPLETED) {
          return {
            ok: true as const,
            status: 200 as const,
            body: { ok: true, replay: true, order: fresh },
          };
        }

        return {
          ok: false as const,
          status: 409 as const,
          body: {
            ok: false,
            error: "Order status changed before completion could be finalized",
            debug: { orderId, status: fresh?.status ?? null },
          },
        };
      }

      // Sold-out items => credits apply per sold-out ticket
      const soldOutItems = order.items.filter(
        (i) => i.ticket?.event?.selloutStatus === "SOLD_OUT"
      );
      const soldOutTicketIds = uniqStrings(soldOutItems.map((i) => i.ticketId));
      const soldOutCount = soldOutTicketIds.length;

      let creditsSpentByBuyer = 0;
      let creditsAwardedToSeller = 0;

      if (soldOutCount > 0) {
        const spendPerTicket = CREDIT_COST_PER_SOLDOUT_PURCHASE;
        const earnPerTicket = CREDIT_AWARD_PER_SOLDOUT_SALE;

        // Load buyer + seller balances up front
        const buyer = await tx.seller.findUnique({
          where: { id: order.buyerSellerId },
          select: { id: true, creditBalanceCredits: true },
        });

        if (!buyer) {
          return {
            ok: false as const,
            status: 409 as const,
            body: {
              ok: false,
              error: "Cannot complete: buyer seller record missing",
              debug: { buyerSellerId: order.buyerSellerId },
            },
          };
        }

        const seller = await tx.seller.findUnique({
          where: { id: order.sellerId },
          select: { id: true, creditBalanceCredits: true },
        });

        if (!seller) {
          return {
            ok: false as const,
            status: 409 as const,
            body: {
              ok: false,
              error: "Cannot complete: seller record missing",
              debug: { sellerId: order.sellerId },
            },
          };
        }

        // Determine which buyer SPENT txns already exist (idempotency safety)
        const existingBuyerSpend = await tx.creditTransaction.findMany({
          where: {
            sellerId: order.buyerSellerId,
            orderId: order.id,
            type: "SPENT",
            source: "SOLD_OUT_PURCHASE",
            ticketId: { in: soldOutTicketIds },
          },
          select: { ticketId: true },
        });

        const existingBuyerTicketIds = new Set(
          existingBuyerSpend.map((t) => t.ticketId).filter(Boolean) as string[]
        );
        const candidateBuyerCreates = soldOutTicketIds.filter(
          (ticketId) => !existingBuyerTicketIds.has(ticketId)
        );

        // Buyer must have enough credits for missing spends
        const buyerStartBal = buyer.creditBalanceCredits ?? 0;
        const buyerMaxRequired = candidateBuyerCreates.length * spendPerTicket;

        if (buyerStartBal < buyerMaxRequired) {
          return {
            ok: false as const,
            status: 409 as const,
            body: {
              ok: false,
              error: "Cannot complete: buyer has insufficient credits for sold-out items",
              debug: {
                buyerCredits: buyerStartBal,
                required: buyerMaxRequired,
                missingSpendTxns: candidateBuyerCreates.length,
              },
            },
          };
        }

        // --- BUYER SPEND (step balances, write balanceAfterCredits on each txn) ---
        let buyerBal = buyerStartBal;

        for (const ticketId of candidateBuyerCreates) {
          const nextBal = buyerBal - spendPerTicket;

          const created = await createCreditTxnIdempotent(tx, {
            seller: { connect: { id: order.buyerSellerId } },
            type: "SPENT",
            source: "SOLD_OUT_PURCHASE",
            amountCredits: -spendPerTicket,
            balanceAfterCredits: nextBal,
            note: `Credit spent for sold-out ticket ${ticketId}`,
            referenceType: "Order",
            referenceId: order.id,
            order: { connect: { id: order.id } },
            ticket: { connect: { id: ticketId } },
          });

          if (created) {
            buyerBal = nextBal;
            creditsSpentByBuyer += spendPerTicket;
          }
        }

        if (creditsSpentByBuyer > 0) {
          await tx.seller.update({
            where: { id: order.buyerSellerId },
            data: { creditBalanceCredits: buyerBal },
          });
        }

        // --- SELLER EARN (step balances, write balanceAfterCredits on each txn) ---
        const existingSellerEarn = await tx.creditTransaction.findMany({
          where: {
            sellerId: order.sellerId,
            orderId: order.id,
            type: "EARNED",
            source: "SOLD_OUT_PURCHASE",
            ticketId: { in: soldOutTicketIds },
          },
          select: { ticketId: true },
        });

        const existingSellerTicketIds = new Set(
          existingSellerEarn.map((t) => t.ticketId).filter(Boolean) as string[]
        );
        const candidateSellerCreates = soldOutTicketIds.filter(
          (ticketId) => !existingSellerTicketIds.has(ticketId)
        );

        let sellerBal = seller.creditBalanceCredits ?? 0;

        for (const ticketId of candidateSellerCreates) {
          const nextBal = sellerBal + earnPerTicket;

          const created = await createCreditTxnIdempotent(tx, {
            seller: { connect: { id: order.sellerId } },
            type: "EARNED",
            source: "SOLD_OUT_PURCHASE",
            amountCredits: earnPerTicket,
            balanceAfterCredits: nextBal,
            note: `Credit earned for sold-out ticket ${ticketId}`,
            referenceType: "Order",
            referenceId: order.id,
            order: { connect: { id: order.id } },
            ticket: { connect: { id: ticketId } },
          });

          if (created) {
            sellerBal = nextBal;
            creditsAwardedToSeller += earnPerTicket;
          }
        }

        if (creditsAwardedToSeller > 0) {
          await tx.seller.update({
            where: { id: order.sellerId },
            data: { creditBalanceCredits: sellerBal },
          });
        }
      }

      // Update seller metrics (lifetime totals)
      const ticketsSoldCount = order.items.length;

      await tx.sellerMetrics.upsert({
        where: { sellerId: order.sellerId },
        create: {
          sellerId: order.sellerId,
          lifetimeSalesCents: order.amountCents,
          lifetimeOrders: 1,
          lifetimeTicketsSold: ticketsSoldCount,
        },
        update: {
          lifetimeSalesCents: { increment: order.amountCents },
          lifetimeOrders: { increment: 1 },
          lifetimeTicketsSold: { increment: ticketsSoldCount },
        },
      });

      // Return the now-completed order (we already set status via gate)
      const completed = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, payment: true },
      });

      return {
        ok: true as const,
        status: 200 as const,
        body: {
          ok: true,
          order: completed,
          soldOutCount,
          creditsSpentByBuyer,
          creditsAwardedToSeller,
          next: "Payout eligibility can now be evaluated (seller kept whole = amountCents).",
        },
      };
    });

    if ((result as any).ok === false) {
      return NextResponse.json((result as any).body, { status: (result as any).status });
    }

    return NextResponse.json((result as any).body, { status: (result as any).status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: "Complete failed", details: message },
      { status: 500 }
    );
  }
}
