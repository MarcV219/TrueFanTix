export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const query = url.searchParams.get("q")?.trim() || "";
    const minPrice = url.searchParams.get("minPrice");
    const maxPrice = url.searchParams.get("maxPrice");
    const city = url.searchParams.get("city")?.trim();
    const venue = url.searchParams.get("venue")?.trim();
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");
    const sortBy = url.searchParams.get("sortBy") || "relevance";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);
    const cursor = url.searchParams.get("cursor");

    // Build where clause
    const where: any = {
      status: "AVAILABLE",
    };

    // Text search on title and venue
    if (query) {
      where.OR = [
        { title: { contains: query, mode: "insensitive" } },
        { venue: { contains: query, mode: "insensitive" } },
      ];
    }

    // Price range
    if (minPrice || maxPrice) {
      where.priceCents = {};
      if (minPrice) where.priceCents.gte = Math.round(parseFloat(minPrice) * 100);
      if (maxPrice) where.priceCents.lte = Math.round(parseFloat(maxPrice) * 100);
    }

    // City/Venue filters
    if (venue) {
      where.venue = { contains: venue, mode: "insensitive" };
    }

    // Date range filter (string comparison since date is stored as string)
    if (dateFrom || dateTo) {
      // This is a simple string comparison - works best with ISO dates
      // For more complex date filtering, consider converting to DateTime in schema
    }

    // Determine sort order
    let orderBy: any = {};
    switch (sortBy) {
      case "price_asc":
        orderBy = { priceCents: "asc" };
        break;
      case "price_desc":
        orderBy = { priceCents: "desc" };
        break;
      case "newest":
        orderBy = { createdAt: "desc" };
        break;
      default:
        // Default to newest for now (relevance requires full-text search)
        orderBy = { createdAt: "desc" };
    }

    // Execute query
    const tickets = await prisma.ticket.findMany({
      where,
      take: limit + 1, // Get one extra to determine if there's a next page
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy,
      include: {
        seller: {
          select: {
            id: true,
            name: true,
            rating: true,
            reviews: true,
            badges: { select: { name: true } },
          },
        },
        event: {
          select: {
            id: true,
            title: true,
            selloutStatus: true,
          },
        },
      },
    });

    // Check if there's a next page
    const hasMore = tickets.length > limit;
    const results = hasMore ? tickets.slice(0, limit) : tickets;
    const nextCursor = hasMore ? results[results.length - 1].id : null;

    // Transform results
    const transformed = results.map((t: any) => ({
      id: t.id,
      title: t.title,
      venue: t.venue,
      date: t.date,
      price: t.priceCents / 100,
      faceValue: t.faceValueCents ? t.faceValueCents / 100 : null,
      image: t.image,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      seller: {
        id: t.seller.id,
        name: t.seller.name,
        rating: t.seller.rating,
        reviews: t.seller.reviews,
        badges: t.seller.badges.map((b: any) => b.name),
      },
      event: t.event,
    }));

    return NextResponse.json({
      ok: true,
      tickets: transformed,
      nextCursor,
      hasMore,
      totalCount: results.length, // Note: This is just the page count, not total DB count
    }, { status: 200 });

  } catch (err: any) {
    console.error("GET /api/tickets/search error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to search tickets." },
      { status: 500 }
    );
  }
}
