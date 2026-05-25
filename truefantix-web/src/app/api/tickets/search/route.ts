export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyRateLimit } from "@/lib/rate-limit";

const VALID_STATUSES = new Set(["AVAILABLE", "SOLD", "WITHDRAWN"]);
const VALID_SORTS = new Set(["relevance", "price_asc", "price_desc", "date_asc", "date_desc", "newest"]);

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function parseDollarsToCents(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function centsToDollars(cents: number) {
  return Number((cents / 100).toFixed(2));
}

function contains(value: string) {
  return { contains: value };
}

function buildOrderBy(sortBy: string, hasQuery: boolean): any {
  switch (sortBy) {
    case "price_asc":
      return { priceCents: "asc" };
    case "price_desc":
      return { priceCents: "desc" };
    case "date_asc":
      return { date: "asc" };
    case "date_desc":
      return { date: "desc" };
    case "newest":
      return { createdAt: "desc" };
    default:
      return hasQuery ? { viewCount: "desc" } : { createdAt: "desc" };
  }
}

function calculateRelevanceScore(ticket: any, query: string): number {
  const queryLower = query.toLowerCase();
  let score = 0;

  if (ticket.title?.toLowerCase() === queryLower) score += 100;
  if (ticket.event?.title?.toLowerCase() === queryLower) score += 90;
  if (ticket.title?.toLowerCase().includes(queryLower)) score += 50;
  if (ticket.event?.title?.toLowerCase().includes(queryLower)) score += 45;
  if (ticket.venue?.toLowerCase().includes(queryLower)) score += 30;
  if (ticket.primaryVendor?.toLowerCase().includes(queryLower)) score += 20;
  if (ticket.verificationStatus === "VERIFIED") score += 25;
  if (ticket.seller?.rating > 4) score += 15;
  if (ticket.verificationImage) score += 10;

  const daysSinceCreated = Math.floor((Date.now() - new Date(ticket.createdAt).getTime()) / 86_400_000);
  score -= Math.min(daysSinceCreated * 0.5, 20);

  return Math.max(0, score);
}

function normalizeTicket(ticket: any, query: string) {
  return {
    ...ticket,
    price: centsToDollars(ticket.priceCents),
    faceValue: ticket.faceValueCents == null ? null : centsToDollars(ticket.faceValueCents),
    seller: {
      ...ticket.seller,
      badges: ticket.seller?.badges?.map((badge: any) => badge.name) ?? [],
    },
    relevanceScore: query ? calculateRelevanceScore(ticket, query) : null,
  };
}

async function getFacets(where: any) {
  try {
    const [priceRange, venues, dateRange] = await Promise.all([
      getPriceFacets(where),
      getVenueFacets(where),
      getDateFacets(where),
    ]);

    return { priceRange, venues, dateRange };
  } catch (err) {
    console.error("Search facets error:", err);
    return { priceRange: [], venues: [], dateRange: [] };
  }
}

// Search marketplace tickets. Keep response compatible with the search page
// (`tickets`, `nextCursor`, `hasMore`) and older callers (`results`, `pagination`).
export async function GET(req: Request) {
  const rlResult = await applyRateLimit(req, "tickets:search");
  if (!rlResult.ok) return rlResult.response;

  try {
    const { searchParams } = new URL(req.url);

    const query = (searchParams.get("q") || "").trim();
    const limit = parsePositiveInt(searchParams.get("limit"), 20, 50);
    const page = parsePositiveInt(searchParams.get("page"), 1, 10_000);
    const cursor = searchParams.get("cursor") || undefined;
    const requestedSort = searchParams.get("sortBy") || "relevance";
    const sortBy = VALID_SORTS.has(requestedSort) ? requestedSort : "relevance";

    const minPriceCents = parseDollarsToCents(searchParams.get("minPrice"));
    const maxPriceCents = parseDollarsToCents(searchParams.get("maxPrice"));
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const venue = (searchParams.get("venue") || "").trim();
    const requestedStatus = searchParams.get("status") || "AVAILABLE";
    const status = VALID_STATUSES.has(requestedStatus) ? requestedStatus : "AVAILABLE";

    if (!query && minPriceCents == null && maxPriceCents == null && !dateFrom && !dateTo && !venue) {
      return NextResponse.json(
        { ok: false, error: "MISSING_QUERY", message: "Please provide a search query or filters." },
        { status: 400 }
      );
    }

    const where: any = {
      status,
      withdrawnAt: status === "WITHDRAWN" ? { not: null } : null,
    };

    // Match the public marketplace listing policy: search only shows verified
    // tickets unless a caller explicitly asks for a verification state later.
    if (status !== "WITHDRAWN") {
      where.verificationStatus = "VERIFIED";
    }

    if (query) {
      where.OR = [
        { title: contains(query) },
        { venue: contains(query) },
        { event: { title: contains(query) } },
        { barcodeText: contains(query) },
        { primaryVendor: contains(query) },
      ];
    }

    if (minPriceCents != null || maxPriceCents != null) {
      where.priceCents = {};
      if (minPriceCents != null) where.priceCents.gte = minPriceCents;
      if (maxPriceCents != null) where.priceCents.lte = maxPriceCents;
    }

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = dateFrom;
      if (dateTo) where.date.lte = dateTo;
    }

    if (venue) {
      where.venue = contains(venue);
    }

    const orderBy = buildOrderBy(sortBy, !!query);
    const skip = cursor ? 1 : (page - 1) * limit;

    const [rawTickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        orderBy,
        take: limit + 1,
        skip,
        ...(cursor ? { cursor: { id: cursor } } : {}),
        select: {
          id: true,
          title: true,
          priceCents: true,
          faceValueCents: true,
          image: true,
          venue: true,
          date: true,
          primaryVendor: true,
          verificationImage: true,
          verificationStatus: true,
          viewCount: true,
          createdAt: true,
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
              badges: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      }),
      prisma.ticket.count({ where }),
    ]);

    const hasMore = rawTickets.length > limit;
    const pageTickets = hasMore ? rawTickets.slice(0, limit) : rawTickets;
    let tickets = pageTickets.map((ticket) => normalizeTicket(ticket, query));

    if (sortBy === "relevance" && query) {
      tickets = tickets.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    }

    const nextCursor = hasMore ? tickets[tickets.length - 1]?.id ?? null : null;

    return NextResponse.json(
      {
        ok: true,
        tickets,
        nextCursor,
        hasMore,
        results: tickets,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasMore,
        },
        facets: await getFacets(where),
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Search error:", err);
    return NextResponse.json(
      { ok: false, error: "SEARCH_ERROR", message: "Could not perform search." },
      { status: 500 }
    );
  }
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
            ...(range.max != null ? { lte: range.max } : {}),
          },
        },
      });

      return { ...range, count };
    })
  );

  return facets.filter((facet) => facet.count > 0);
}

async function getVenueFacets(where: any) {
  const venues = await prisma.ticket.groupBy({
    by: ["venue"],
    where: {
      ...where,
      venue: { not: "" },
    },
    _count: { venue: true },
    orderBy: { venue: "asc" },
    take: 10,
  });

  return venues.map((venue) => ({
    venue: venue.venue,
    count: venue._count.venue,
  }));
}

async function getDateFacets(where: any) {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const thisWeek = new Date(now.getTime() + 7 * 86_400_000).toISOString().split("T")[0];
  const thisMonth = new Date(now.getTime() + 30 * 86_400_000).toISOString().split("T")[0];

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

  return facets.filter((facet) => facet.count > 0);
}
