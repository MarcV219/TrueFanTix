export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { searchProviderCatalog } from "@/lib/catalog/provider-catalog";
import type { CatalogSuggestionType } from "@/lib/catalog/live-event-catalog";

const TYPES = new Set(["ARTIST", "TEAM", "VENUE", "CITY", "SPORT", "SHOW", "OTHER", "ALL"]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") || "";
  const rawType = (searchParams.get("type") || "ALL").toUpperCase();
  const type = TYPES.has(rawType) ? (rawType as CatalogSuggestionType | "ALL") : "ALL";
  const rawLimit = Number(searchParams.get("limit") || 12);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 12;
  const includeProviders = searchParams.get("providers") !== "0";

  const suggestions = await searchProviderCatalog({ query, type, limit, includeProviders });

  return NextResponse.json({ ok: true, suggestions }, { status: 200 });
}
