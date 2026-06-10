export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

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
              is: {
                OR: [
                  { status: "PENDING" as const },
                  { stripeDetailsSubmitted: false },
                  { stripeChargesEnabled: false },
                  { stripePayoutsEnabled: false },
                ],
              },
            },
          }
        : filter === "pending-payouts"
          ? { seller: { is: { payouts: { some: { status: "PENDING" as const } } } } }
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

  return NextResponse.json({
    ok: true,
    q,
    filter,
    users: users.map((user) => ({
      ...user,
      isVerified: !!user.emailVerifiedAt && !!user.phoneVerifiedAt,
    })),
  });
}
