export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { hasInternalCronAuth } from "@/lib/auth/guards";
import { searchProviderCatalog, seedStaticCatalog } from "@/lib/catalog/provider-catalog";
import type { CatalogSuggestionType } from "@/lib/catalog/live-event-catalog";

const DEFAULT_QUERIES: Array<{ type: CatalogSuggestionType; q: string }> = [
  { type: "ARTIST", q: "a" },
  { type: "ARTIST", q: "the" },
  { type: "ARTIST", q: "dr" },
  { type: "ARTIST", q: "radio" },
  { type: "ARTIST", q: "metal" },
  { type: "TEAM", q: "toronto" },
  { type: "TEAM", q: "montreal" },
  { type: "TEAM", q: "new york" },
  { type: "VENUE", q: "toronto" },
  { type: "VENUE", q: "montreal" },
  { type: "VENUE", q: "new york" },
  { type: "CITY", q: "tor" },
  { type: "CITY", q: "mon" },
  { type: "CITY", q: "new" },
  { type: "SPORT", q: "base" },
  { type: "SPORT", q: "hock" },
  { type: "SPORT", q: "mma" },
];

const TYPES = new Set(["ARTIST", "TEAM", "VENUE", "CITY", "SPORT"]);

export async function POST(req: Request) {
  if (!hasInternalCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 12), 1), 30);
  const queryParam = url.searchParams.get("q");
  const rawType = url.searchParams.get("type")?.toUpperCase();
  const typeParam = rawType && TYPES.has(rawType) ? (rawType as CatalogSuggestionType) : undefined;
  const queries = queryParam && typeParam
    ? [{ type: typeParam, q: queryParam }]
    : DEFAULT_QUERIES;

  const staticItems = await seedStaticCatalog();
  const rows: Array<{ type: string; query: string; count: number }> = [];
  let providerCount = 0;

  for (const item of queries) {
    const suggestions = await searchProviderCatalog({
      query: item.q,
      type: item.type,
      limit,
      includeProviders: true,
    });
    rows.push({ type: item.type, query: item.q, count: suggestions.length });
    providerCount += suggestions.filter((suggestion) => suggestion.provider !== "static").length;
  }

  return NextResponse.json({
    ok: true,
    staticSeeded: staticItems.length,
    providerCount,
    rows,
    notes: [
      "Uses free/provider APIs when configured: TICKETMASTER_API_KEY, GEONAMES_USERNAME, OpenStreetMap Overpass, and MusicBrainz public API.",
      "MusicBrainz public API is rate-limited; this route keeps the query set intentionally small.",
      "Notification preferences should save catalogEntityId plus canonical value from user-selected suggestions.",
    ],
  });
}

export async function GET(req: Request) {
  return POST(req);
}
