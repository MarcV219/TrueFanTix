export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

type MetricRow = {
  source: string;
  medium: string | null;
  campaign: string | null;
  visitors: number;
  pageViews: number;
  signups: number;
  verifiedUsers: number;
  followers: number;
  firstListings: number;
  completedTransactions: number;
};

function parseDate(value: string | null, fallback: Date, endOfDay = false): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function key(source: string | null, medium: string | null, campaign: string | null): string {
  return [source || "unattributed", medium || "", campaign || ""].join("\u001f");
}

function ensureRow(rows: Map<string, MetricRow>, source: string | null, medium: string | null, campaign: string | null) {
  const rowKey = key(source, medium, campaign);
  let row = rows.get(rowKey);
  if (!row) {
    row = {
      source: source || "unattributed",
      medium: medium || null,
      campaign: campaign || null,
      visitors: 0,
      pageViews: 0,
      signups: 0,
      verifiedUsers: 0,
      followers: 0,
      firstListings: 0,
      completedTransactions: 0,
    };
    rows.set(rowKey, row);
  }
  return row;
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  const url = new URL(req.url);
  const from = parseDate(url.searchParams.get("from"), defaultFrom);
  const to = parseDate(url.searchParams.get("to"), now, true);

  if (from > to || to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
    return NextResponse.json(
      { ok: false, error: "INVALID_RANGE", message: "Choose a valid date range of 366 days or less." },
      { status: 400 }
    );
  }

  const [traffic, users] = await Promise.all([
    prisma.trafficVisitorDay.groupBy({
      by: ["source", "medium", "campaign"],
      where: { day: { gte: from, lte: to } },
      _count: { _all: true },
      _sum: { pageViews: true },
    }),
    prisma.user.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: {
        acquisitionSource: true,
        acquisitionMedium: true,
        acquisitionCampaign: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        sellerId: true,
        notificationPreferences: {
          where: { status: "ACTIVE" },
          select: { id: true },
          take: 1,
        },
      },
    }),
  ]);

  const sellerIds = users.flatMap((user) => user.sellerId ? [user.sellerId] : []);
  const [listedSellers, completedSellerOrders, completedBuyerOrders] = sellerIds.length
    ? await Promise.all([
        prisma.ticket.findMany({ where: { sellerId: { in: sellerIds } }, distinct: ["sellerId"], select: { sellerId: true } }),
        prisma.order.findMany({ where: { sellerId: { in: sellerIds }, status: "COMPLETED" }, distinct: ["sellerId"], select: { sellerId: true } }),
        prisma.order.findMany({ where: { buyerSellerId: { in: sellerIds }, status: "COMPLETED" }, distinct: ["buyerSellerId"], select: { buyerSellerId: true } }),
      ])
    : [[], [], []];

  const listingSet = new Set(listedSellers.map((item) => item.sellerId));
  const completedSet = new Set([
    ...completedSellerOrders.map((item) => item.sellerId),
    ...completedBuyerOrders.map((item) => item.buyerSellerId),
  ]);
  const rows = new Map<string, MetricRow>();

  for (const item of traffic) {
    const row = ensureRow(rows, item.source, item.medium, item.campaign);
    row.visitors += item._count._all;
    row.pageViews += item._sum.pageViews || 0;
  }

  for (const user of users) {
    const row = ensureRow(rows, user.acquisitionSource, user.acquisitionMedium, user.acquisitionCampaign);
    row.signups += 1;
    if (user.emailVerifiedAt && user.phoneVerifiedAt) row.verifiedUsers += 1;
    if (user.notificationPreferences.length > 0) row.followers += 1;
    if (user.sellerId && listingSet.has(user.sellerId)) row.firstListings += 1;
    if (user.sellerId && completedSet.has(user.sellerId)) row.completedTransactions += 1;
  }

  const items = [...rows.values()].sort((a, b) =>
    b.signups - a.signups || b.visitors - a.visitors || a.source.localeCompare(b.source)
  );
  const totals = items.reduce(
    (sum, item) => ({
      visitors: sum.visitors + item.visitors,
      pageViews: sum.pageViews + item.pageViews,
      signups: sum.signups + item.signups,
      verifiedUsers: sum.verifiedUsers + item.verifiedUsers,
      followers: sum.followers + item.followers,
      firstListings: sum.firstListings + item.firstListings,
      completedTransactions: sum.completedTransactions + item.completedTransactions,
    }),
    { visitors: 0, pageViews: 0, signups: 0, verifiedUsers: 0, followers: 0, firstListings: 0, completedTransactions: 0 }
  );

  return NextResponse.json({
    ok: true,
    range: { from: from.toISOString(), to: to.toISOString() },
    totals,
    items,
    privacy: "Aggregate campaign labels only; no email, name, IP address, or full referrer URL is returned.",
  });
}
