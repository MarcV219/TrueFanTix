export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  try {
    const user = await prisma.user.findUnique({
      where: { id: gate.user.id },
      select: { sellerId: true },
    });

    const [written, received, pending] = await Promise.all([
      prisma.review.findMany({
        where: { reviewerId: gate.user.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          rating: true,
          content: true,
          status: true,
          createdAt: true,
          seller: { select: { id: true, name: true } },
          order: {
            select: {
              id: true,
              items: { take: 1, select: { ticket: { select: { title: true } } } },
            },
          },
        },
      }),
      user?.sellerId
        ? prisma.review.findMany({
            where: { sellerId: user.sellerId, status: "APPROVED" },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              rating: true,
              content: true,
              status: true,
              createdAt: true,
              reviewer: { select: { id: true, firstName: true, displayName: true } },
              order: {
                select: {
                  id: true,
                  items: { take: 1, select: { ticket: { select: { title: true } } } },
                },
              },
            },
          })
        : Promise.resolve([]),
      user?.sellerId
        ? prisma.order.findMany({
            where: {
              buyerSellerId: user.sellerId,
              status: "COMPLETED",
              reviews: { none: {} },
            },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              createdAt: true,
              seller: { select: { id: true, name: true } },
              items: {
                select: {
                  ticket: { select: { id: true, title: true, venue: true, date: true, image: true, status: true } },
                  priceCents: true,
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    return NextResponse.json({ ok: true, reviews: { written, received, pending } });
  } catch (err) {
    console.error("GET /api/account/reviews error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to load account reviews." },
      { status: 500 }
    );
  }
}
