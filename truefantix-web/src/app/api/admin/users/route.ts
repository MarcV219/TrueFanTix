export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

function normalizeQuery(value: string | null) {
  return String(value ?? "").trim();
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const url = new URL(req.url);
  const q = normalizeQuery(url.searchParams.get("q"));
  const take = Math.min(Math.max(Number(url.searchParams.get("take") || 25), 1), 50);

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q, mode: "insensitive" as const } },
          { firstName: { contains: q, mode: "insensitive" as const } },
          { lastName: { contains: q, mode: "insensitive" as const } },
          { displayName: { contains: q, mode: "insensitive" as const } },
          { seller: { name: { contains: q, mode: "insensitive" as const } } },
        ],
      }
    : {};

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
    users: users.map((user) => ({
      ...user,
      isVerified: !!user.emailVerifiedAt && !!user.phoneVerifiedAt,
    })),
  });
}
