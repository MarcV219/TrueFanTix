import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeInput, schemas } from "@/lib/validation";

// Full-text search with relevance scoring
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    
    const query = searchParams.get("q") || "";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);
    const sortBy = searchParams.get("sortBy") || "relevance";
    
    // Filters
    const minPrice = searchParams.get("minPrice");
    const maxPrice = searchParams.get("maxPrice");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const venue = searchParams.get("venue");
    const status = searchParams.get("status") || "AVAILABLE";

    if (!query && !minPrice && !maxPrice && !dateFrom && !dateTo && !venue) {
      return NextResponse.json(
        { ok: false, error: "MISSING_QUERY", message: "Please provide a search query or filters." },
        { status: 400 }
      );
    }

    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {
      status: status as any,
      withdrawnAt: null,
    };

    // Full-text search on multiple fields
    if (query) {
      where.OR = [
        { title: { contains: query, mode: "insensitive" } },
        { venue: { contains: query, mode: "insensitive" } },
        { event: { title: { contains: query, mode: "insensitive" } } },
        { barcodeText: { contains: query, mode: "insensitive" } },
        { primaryVendor: { contains: query, mode: "insensitive" } },
      ];
    }

    // Price filters
    if (minPrice) {
      where.priceCents = { ...(where.priceCents || {}), gte: parseInt(minPrice) * 100 };
    }
    if (maxPrice) {
      where.priceCents = { ...(where.priceCents || {}), lte: parseInt(maxPrice) * 100 };
    }

    // Date filters
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = dateFrom;
      if (dateTo) where.date.lte = dateTo;
    }

    // Venue filter
    if (venue) {
      where.venue = { contains: venue, mode: "insensitive" };
    }

    // Determine order by
    let orderBy: any = {};
    switch (sortBy) {
      case "price_asc":
        orderBy = { priceCents: "asc" };
        break;
      case "price_desc":
        orderBy = { priceCents: "desc" };
        break;
      case "date_asc":
        orderBy = { date: "asc" };
        break;
      case "date_desc":
        orderBy = { date: "desc" };
        break;
      case "newest":
        orderBy = { createdAt: "desc" };
        break;
      default:
        // For relevance, we'll use a combination of factors
        orderBy = { viewCount: "desc" };
    }

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          event: {
            select: {
              id: true,
              title: true,
              venue: true,
              date: true,
            },
          },
          seller: {
            select: {
              id: true,
              name: true,
              rating: true,
              reviews: true,
            },
          },
        },
      }),
      prisma.ticket.count({ where }),
    ]);

    // Calculate relevance scores if searching by query
    let results = tickets.map(ticket => ({
      ...ticket,
      price: ticket.priceCents / 100,
      faceValue: ticket.faceValueCents ? ticket.faceValueCents / 100 : null,
      relevanceScore: query ? calculateRelevanceScore(ticket, query) : null,
    }));

    // Sort by relevance if that's the sort criteria
    if (sortBy === "relevance" && query) {
      results = results.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    }

    return NextResponse.json({
      ok: true,
      results,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + limit < total,
      },
      facets: {
        priceRange: await getPriceFacets(where),
        venues: await getVenueFacets(where),
        dateRange: await getDateFacets(where),
      },
    }, { status: 200 });

  } catch (err) {
    console.error("Search error:", err);
    return NextResponse.json(
      { ok: false, error: "SEARCH_ERROR", message: "Could not perform search." },
      { status: 500 }
    );
  }
}

function calculateRelevanceScore(ticket: any, query: string): number {
  const queryLower = query.toLowerCase();
  let score = 0;

  // Exact matches get highest scores
  if (ticket.title?.toLowerCase() === queryLower) score += 100;
  if (ticket.event?.title?.toLowerCase() === queryLower) score += 90;

  // Partial matches
  if (ticket.title?.toLowerCase().includes(queryLower)) score += 50;
  if (ticket.event?.title?.toLowerCase().includes(queryLower)) score += 45;
  if (ticket.venue?.toLowerCase().includes(queryLower)) score += 30;
  if (ticket.primaryVendor?.toLowerCase().includes(queryLower)) score += 20;

  // Boost verified tickets
  if (ticket.verificationStatus === "VERIFIED") score += 25;

  // Boost highly-rated sellers
  if (ticket.seller?.rating > 4) score += 15;

  // Boost tickets with images
  if (ticket.verificationImage) score += 10;

  // Penalize old listings slightly
  const daysSinceCreated = Math.floor((Date.now() - new Date(ticket.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  score -= Math.min(daysSinceCreated * 0.5, 20); // Max penalty of 20

  return Math.max(0, score);
}

async function getPriceFacets(where: any) {
  const ranges = [
    { label: "Under $50", min: 0, max: 4999 },
    { label: "$50 - $100", min: 5000, max: 9999 },
    { label: "$100 - $200", min: 10000, max: 19999 },
    { label: "$200 - $500", min: 20000, max: 49999 },
    { label: "$500+", min: 50000, max: null },
  ];

  const facets = await Promise.all(
    ranges.map(async (range) => {
      const count = await prisma.ticket.count({
        where: {
          ...where,
          priceCents: {
            gte: range.min,
            ...(range.max && { lte: range.max }),
          },
        },
      });
      return { ...range, count };
    })
  );

  return facets.filter(f => f.count > 0);
}

async function getVenueFacets(where: any) {
  const venues = await prisma.ticket.groupBy({
    by: ["venue"],
    where: {
      ...where,
      venue: { not: null },
    },
    _count: { venue: true },
    orderBy: { _count: { venue: "desc" } },
    take: 10,
  });

  return venues.map(v => ({
    venue: v.venue,
    count: v._count.venue,
  }));
}

async function getDateFacets(where: any) {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const thisWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const thisMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const ranges = [
    { label: "Today", from: today, to: today },
    { label: "This Week", from: today, to: thisWeek },
    { label: "This Month", from: today, to: thisMonth },
  ];

  const facets = await Promise.all(
    ranges.map(async (range) => {
      const count = await prisma.ticket.count({
        where: {
          ...where,
          date: {
            gte: range.from,
            lte: range.to,
          },
        },
      });
      return { ...range, count };
    })
  );

  return facets.filter(f => f.count > 0);
}
