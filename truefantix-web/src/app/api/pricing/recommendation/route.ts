import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { getPriceRecommendation, getPriceTrends } from "@/lib/pricing";
import { schemas, validateRequest } from "@/lib/validation";

// GET /api/pricing/recommendation
// Get AI-powered price recommendation
export async function GET(req: Request) {
  try {
    const gate = await requireUser(req);
    
    const { searchParams } = new URL(req.url);
    const queryParsed = schemas.pricingRecommendationQuery.safeParse({
      eventTitle: searchParams.get("eventTitle"),
      venue: searchParams.get("venue"),
      date: searchParams.get("date"),
      row: searchParams.get("row") || undefined,
      seat: searchParams.get("seat") || undefined,
      faceValue: searchParams.get("faceValue") ?? undefined,
    });

    if (!queryParsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "VALIDATION_ERROR",
          message: "eventTitle, venue, and date required.",
          details: queryParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        },
        { status: 400 }
      );
    }

    const { eventTitle, venue, date, row, seat, faceValue } = queryParsed.data;

    const recommendation = await getPriceRecommendation({
      eventTitle,
      venue,
      date,
      row: row || undefined,
      seat: seat || undefined,
      faceValueCents: faceValue != null ? Math.round(faceValue * 100) : undefined,
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
    const validation = await validateRequest(schemas.pricingTrendsApi)(req);
    if (!validation.success) return validation.response;

    const body = validation.data;

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
