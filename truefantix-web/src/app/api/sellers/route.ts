export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { schemas, validateRequest } from "@/lib/validation";

export async function GET() {
  const sellers = await prisma.seller.findMany({
    orderBy: { name: "asc" },
    include: { badges: true },
  });

  const normalized = sellers.map((s: any) => ({
    id: s.id,
    name: s.name,
    rating: s.rating,
    reviews: s.reviews,
    accessTokenBalance: s.creditBalanceCredits,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    badges: s.badges.map((b: any) => b.name),
  }));

  return NextResponse.json(normalized);
}

export async function POST(req: Request) {
  try {
    const validation = await validateRequest(schemas.sellerCreateApi)(req);
    if (!validation.success) return validation.response;

    const { name, rating, reviews, badges: badgesInput = [] } = validation.data;

    const badges = badgesInput
      .map((b: unknown) => String(b).trim())
      .filter(Boolean);

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
        badges: seller.badges.map((b: any) => b.name),
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
