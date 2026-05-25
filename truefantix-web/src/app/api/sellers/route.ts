export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";

export async function GET() {
  try {
    const sellers = await prisma.seller.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        rating: true,
        reviews: true,
        badges: {
          select: {
            name: true,
          },
        },
      },
    });

    const normalized = sellers.map((s: any) => ({
      id: s.id,
      name: s.name,
      rating: s.rating,
      reviews: s.reviews,
      accessTokenBalance: 0,
      createdAt: null,
      updatedAt: null,
      badges: s.badges.map((b: any) => b.name),
    }));

    return NextResponse.json({ ok: true, sellers: normalized });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: "SELLERS_FETCH_FAILED", message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

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
        accessTokenBalance: 0,
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
        accessTokenBalance: seller.accessTokenBalance,
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
