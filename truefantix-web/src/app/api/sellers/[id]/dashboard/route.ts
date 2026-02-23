export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Ctx = { params?: Promise<{ id?: string }> | { id?: string } };

function centsToDollars(cents: number) {
  return Number((cents / 100).toFixed(2));
}

function parseSellerIdFromUrl(req: Request): string {
  // /api/sellers/<id>/dashboard
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const sellersIndex = parts.indexOf("sellers");
  if (sellersIndex !== -1 && parts.length > sellersIndex + 1) {
    return decodeURIComponent(parts[sellersIndex + 1] ?? "").trim();
  }
  return "";
}

async function getSellerId(req: Request, ctx: Ctx): Promise<string> {
  const fromUrl = parseSellerIdFromUrl(req);
  if (fromUrl) return fromUrl;

  const p: any = ctx?.params;
  if (!p) return "";

  const resolved = typeof p?.then === "function" ? await p : p;
  return decodeURIComponent(String(resolved?.id ?? "")).trim();
}

function anonymizeBuyer(buyerSellerId: string) {
  const tail = (buyerSellerId ?? "").slice(-6);
  return `Buyer-${tail || "UNKNOWN"}`;
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const sellerId = await getSellerId(req, ctx);

    if (!sellerId) {
      return NextResponse.json(
        { ok: false, error: "Missing seller id", debug: { url: req.url } },
        { status: 400 }
      );
    }

    const seller = await prisma.seller.findUnique({
      where: { id: sellerId },
      include: { badges: true, metrics: true },
    });

    if (!seller) {
      return NextResponse.json({ ok: false, error: "Seller not found" }, { status: 404 });
    }

    const [availableCount, soldCount, withdrawnCount] = await Promise.all([
      prisma.ticket.count({ where: { sellerId, status: "AVAILABLE" } }),
      prisma.ticket.count({ where: { sellerId, status: "SOLD" } }),
      prisma.ticket.count({ where: { sellerId, status: TicketStatus.WITHDRAWN } }),
    ]);

    const [recentTickets, recentOrders, recentCredits, recentPayouts, earnedSoldOutAgg] =
      await Promise.all([
        prisma.ticket.findMany({
          where: { sellerId },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.order.findMany({
          where: { sellerId },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            buyerSellerId: true,
            amountCents: true,
            adminFeeCents: true,
            totalCents: true,
            status: true,
            createdAt: true,
            items: {
              take: 1,
              select: { ticketId: true },
            },
          },
        }),
        prisma.creditTransaction.findMany({
          where: { sellerId },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.payout.findMany({
          where: { sellerId },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.creditTransaction.aggregate({
          where: {
            sellerId,
            type: "EARNED",
            source: "SOLD_OUT_PURCHASE",
          },
          _sum: { amountCredits: true },
        }),
      ]);

    const lifetimeSalesCents = seller.metrics?.lifetimeSalesCents ?? 0;
    const lifetimeOrders = seller.metrics?.lifetimeOrders ?? 0;
    const lifetimeTicketsSold = seller.metrics?.lifetimeTicketsSold ?? 0;

    const accessTokenBalance = seller.creditBalanceCredits ?? 0;

    const soldOutAccessTokensEarned = earnedSoldOutAgg._sum.amountCredits ?? 0;

    return NextResponse.json({
      ok: true,
      seller: {
        id: seller.id,
        name: seller.name,
        rating: seller.rating,
        reviews: seller.reviews,
        badges: seller.badges.map((b: any) => b.name),

        accessTokenBalance,

        createdAt: seller.createdAt,
        updatedAt: seller.updatedAt,
      },

      summary: {
        accessTokenBalance,

        // Access token detail for UI reinforcement
        soldOutAccessTokensEarned,

        lifetimeSalesCents,
        lifetimeSales: centsToDollars(lifetimeSalesCents),

        lifetimeOrders,
        lifetimeTicketsSold,

        ticketsAvailable: availableCount,
        ticketsWithdrawn: withdrawnCount,
        ticketsSold: soldCount,
        ticketsTotal: availableCount + soldCount + withdrawnCount,
      },

      recent: {
        tickets: recentTickets.map((t: any) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priceCents: t.priceCents,
          price: centsToDollars(t.priceCents),
          venue: t.venue,
          date: t.date,
          createdAt: t.createdAt,
          soldAt: (t as any).soldAt ?? null,
          withdrawnAt: (t as any).withdrawnAt ?? null,
        })),

        orders: recentOrders.map((o: any) => ({
          id: o.id,
          ticketId: o.items?.[0]?.ticketId ?? null,

          buyer: anonymizeBuyer(o.buyerSellerId),

          amountCents: o.amountCents,
          amount: centsToDollars(o.amountCents),
          adminFeeCents: o.adminFeeCents,
          adminFee: centsToDollars(o.adminFeeCents),
          totalCents: o.totalCents,
          total: centsToDollars(o.totalCents),

          status: o.status,
          createdAt: o.createdAt,
        })),

        accessTokens: recentCredits.map((ct: any) => ({
          id: ct.id,
          type: ct.type,
          source: (ct as any).source ?? null,
          amountCredits: ct.amountCredits,
          balanceAfterCredits: ct.balanceAfterCredits ?? null,
          note: ct.note ?? null,
          referenceType: ct.referenceType ?? null,
          referenceId: ct.referenceId ?? null,
          createdAt: ct.createdAt,
        })),

        payouts: recentPayouts.map((p: any) => ({
          id: p.id,
          status: p.status,
          amountCents: p.amountCents,
          amount: centsToDollars(p.amountCents),
          feeCents: p.feeCents,
          fee: centsToDollars(p.feeCents),
          netCents: p.netCents,
          net: centsToDollars(p.netCents),
          createdAt: p.createdAt,
        })),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: "Dashboard fetch failed", details: message },
      { status: 500 }
    );
  }
}
