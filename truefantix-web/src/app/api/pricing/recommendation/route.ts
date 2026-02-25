import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { getPriceRecommendation, getPriceTrends } from "@/lib/pricing";

// GET /api/pricing/recommendation
// Get AI-powered price recommendation
export async function GET(req: Request) {
  try {
    const gate = await requireUser();
    
    const { searchParams } = new URL(req.url);
    const eventTitle = searchParams.get("eventTitle");
    const venue = searchParams.get("venue");
    const date = searchParams.get("date");
    const row = searchParams.get("row");
    const seat = searchParams.get("seat");
    const faceValue = searchParams.get("faceValue");

    if (!eventTitle || !venue || !date) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "eventTitle, venue, and date required." },
        { status: 400 }
      );
    }

    const recommendation = await getPriceRecommendation({
      eventTitle,
      venue,
      date,
      row: row || undefined,
      seat: seat || undefined,
      faceValueCents: faceValue ? parseInt(faceValue) * 100 : undefined,
      sellerId: gate.user?.id,
    });

    return NextResponse.json({
      ok: true,
      recommendation: {
        ...recommendation,
        recommendedPrice: recommendation.recommendedPriceCents / 100,
        priceRange: {
          min: recommendation.priceRange.min / 100,
          max: recommendation.priceRange.max / 100,
        },
        marketData: {
          ...recommendation.marketData,
          averagePrice: recommendation.marketData.averagePrice / 100,
          medianPrice: recommendation.marketData.medianPrice / 100,
          lowestPrice: recommendation.marketData.lowestPrice / 100,
          highestPrice: recommendation.marketData.highestPrice / 100,
        },
      },
    }, { status: 200 });

  } catch (err) {
    console.error("GET /api/pricing/recommendation failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not generate price recommendation." },
      { status: 500 }
    );
  }
}

// GET /api/pricing/trends?eventTitle=xxx
// Get price trends for an event
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      eventTitle?: string;
      days?: number;
    } | null;

    if (!body?.eventTitle) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "eventTitle required." },
        { status: 400 }
      );
    }

    const trends = await getPriceTrends(body.eventTitle, body.days || 30);

    return NextResponse.json({
      ok: true,
      trends,
    }, { status: 200 });

  } catch (err) {
    console.error("POST /api/pricing/trends failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not get price trends." },
      { status: 500 }
    );
  }
}
