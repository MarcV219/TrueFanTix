export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { PENDING_PAYOUT_WHERE, SELLER_STRIPE_ATTENTION_WHERE } from "@/lib/adminQueueCounts";

function normalizeQuery(value: string | null) {
  return String(value ?? "").trim();
}

function normalizeFilter(value: string | null) {
  const filter = String(value ?? "all").trim().toLowerCase();
  return ["all", "sellers", "seller-stripe-attention", "pending-payouts"].includes(filter) ? filter : "all";
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const url = new URL(req.url);
  const q = normalizeQuery(url.searchParams.get("q"));
  const filter = normalizeFilter(url.searchParams.get("filter"));
  const take = Math.min(Math.max(Number(url.searchParams.get("take") || 25), 1), 50);

  const searchWhere: Prisma.UserWhereInput | null = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q, mode: "insensitive" as const } },
          { firstName: { contains: q, mode: "insensitive" as const } },
          { lastName: { contains: q, mode: "insensitive" as const } },
          { displayName: { contains: q, mode: "insensitive" as const } },
          { seller: { is: { name: { contains: q, mode: "insensitive" as const } } } },
        ],
      }
    : null;
  const filterWhere: Prisma.UserWhereInput | null =
    filter === "sellers"
      ? { seller: { isNot: null } }
      : filter === "seller-stripe-attention"
        ? {
            seller: {
              is: SELLER_STRIPE_ATTENTION_WHERE,
            },
          }
        : filter === "pending-payouts"
          ? { seller: { is: { payouts: { some: PENDING_PAYOUT_WHERE } } } }
          : null;
  const clauses = [searchWhere, filterWhere].filter((clause): clause is Prisma.UserWhereInput => !!clause);
  const where: Prisma.UserWhereInput = clauses.length ? { AND: clauses } : {};

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      createdAt: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      displayName: true,
      role: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      canBuy: true,
      canComment: true,
      canSell: true,
      isBanned: true,
      banReason: true,
      city: true,
      region: true,
      country: true,
      sellerId: true,
      seller: {
        select: {
          id: true,
          name: true,
          status: true,
          stripeAccountId: true,
          stripeDetailsSubmitted: true,
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
          payoutHold: true,
          payoutHoldReason: true,
          payouts: {
            where: PENDING_PAYOUT_WHERE,
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              amountCents: true,
              feeCents: true,
              netCents: true,
              status: true,
              provider: true,
              providerRef: true,
              createdAt: true,
              updatedAt: true,
              stripeTransferId: true,
              failureReason: true,
              attemptCount: true,
              lastAttemptAt: true,
              paidAt: true,
            },
          },
        },
      },
      _count: {
        select: {
          sessions: true,
          notificationPreferences: true,
        },
      },
    },
  });

  const orderIds = Array.from(new Set(users.flatMap((user) =>
    (user.seller?.payouts || [])
      .map((payout) => payout.providerRef?.startsWith("order:") ? payout.providerRef.slice("order:".length) : null)
      .filter((orderId): orderId is string => !!orderId)
  )));
  const payoutOrders = orderIds.length ? await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      currency: true,
      createdAt: true,
      buyerConfirmationAt: true,
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          ticket: {
            select: { id: true, title: true, venue: true, date: true, section: true, row: true, seat: true },
          },
        },
      },
    },
  }) : [];
  const ordersById = new Map(payoutOrders.map((order) => [order.id, order]));

  return NextResponse.json({
    ok: true,
    q,
    filter,
    users: users.map((user) => ({
      ...user,
      seller: user.seller ? {
        ...user.seller,
        payouts: user.seller.payouts.map((payout) => {
          const orderId = payout.providerRef?.startsWith("order:") ? payout.providerRef.slice("order:".length) : null;
          return { ...payout, orderId, order: orderId ? ordersById.get(orderId) || null : null };
        }),
      } : null,
      isVerified: !!user.emailVerifiedAt && !!user.phoneVerifiedAt,
    })),
  });
}
