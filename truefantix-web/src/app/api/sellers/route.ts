export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const sellers = await prisma.seller.findMany({
    orderBy: { name: "asc" },
    include: { badges: true },
  });

  const normalized = sellers.map((s) => ({
    id: s.id,
    name: s.name,
    rating: s.rating,
    reviews: s.reviews,
    accessTokenBalance: s.creditBalanceCredits,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    badges: s.badges.map((b) => b.name),
  }));

  return NextResponse.json(normalized);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const name = String(body?.name ?? "").trim();
    const rating = body?.rating == null ? undefined : Number(body.rating);
    const reviews = body?.reviews == null ? undefined : Number(body.reviews);

    const badgesInput = Array.isArray(body?.badges) ? body.badges : [];
    const badges = badgesInput
      .map((b: unknown) => String(b).trim())
      .filter(Boolean);

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    if (rating != null && (!Number.isFinite(rating) || rating < 0 || rating > 5)) {
      return NextResponse.json(
        { error: "rating must be a number between 0 and 5" },
        { status: 400 }
      );
    }

    if (reviews != null && (!Number.isFinite(reviews) || reviews < 0)) {
      return NextResponse.json(
        { error: "reviews must be a non-negative number" },
        { status: 400 }
      );
    }

    const seller = await prisma.seller.create({
      data: {
        name,
        creditBalanceCredits: 0,
        ...(rating == null ? {} : { rating }),
        ...(reviews == null ? {} : { reviews }),
        badges: badges.length
          ? { create: badges.map((name: string) => ({ name })) }
          : undefined,
      },
      include: { badges: true },
    });

    return NextResponse.json(
      {
        id: seller.id,
        name: seller.name,
        rating: seller.rating,
        reviews: seller.reviews,
        accessTokenBalance: seller.creditBalanceCredits,
        createdAt: seller.createdAt,
        updatedAt: seller.updatedAt,
        badges: seller.badges.map((b) => b.name),
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
