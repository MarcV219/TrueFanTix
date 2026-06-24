import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export type WebVenueCandidate = {
  type: "VENUE";
  label: string;
  canonicalName: string;
  provider: "web-search" | "openstreetmap";
  providerId: string;
  subtitle?: string;
  address?: string;
  city?: string;
  region?: string;
  country?: string;
  sourceUrl?: string;
  confidence: number;
  sourceName?: string;
  metadata?: Record<string, unknown>;
};

const USER_AGENT = "TrueFanTix/0.1 (admin catalog venue search; https://truefantix-web.vercel.app)";

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function wordsForSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function normalizedName(value: string) {
  return wordsForSearch(value).join(" ");
}

function stableId(parts: Array<string | undefined>) {
  return crypto
    .createHash("sha1")
    .update(parts.map((part) => cleanText(part).toLowerCase()).filter(Boolean).join("|"))
    .digest("hex")
    .slice(0, 24);
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function nameOverlap(query: string, candidate: string) {
  const q = new Set(wordsForSearch(query));
  const c = new Set(wordsForSearch(candidate));
  if (!q.size) return 0;
  let hits = 0;
  for (const word of q) {
    if (c.has(word)) hits += 1;
  }
  return hits / q.size;
}

function titleToVenueName(title: string, query: string) {
  const parts = title
    .split(/\s+[-|–—]\s+|:/)
    .map(cleanText)
    .filter(Boolean);
  const best = parts.sort((a, b) => nameOverlap(query, b) - nameOverlap(query, a))[0];
  return cleanText(best || title).replace(/\s+\|\s+.*$/, "");
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value: string) {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonLd(html: string) {
  const blocks: unknown[] = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match = regex.exec(html);
  while (match) {
    try {
      blocks.push(JSON.parse(decodeHtml(match[1]).trim()));
    } catch {
      // Ignore malformed site metadata.
    }
    match = regex.exec(html);
  }
  return blocks;
}

function walkJson(value: unknown, visit: (item: Record<string, unknown>) => void) {
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, visit);
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  visit(obj);
  for (const nested of Object.values(obj)) {
    walkJson(nested, visit);
  }
}

type ExtractedVenueAddress = {
  name?: string;
  address?: string;
  city?: string;
  region?: string;
  country?: string;
};

function schemaAddressFromJsonLd(blocks: unknown[]): ExtractedVenueAddress | null {
  const found: ExtractedVenueAddress[] = [];

  for (const block of blocks) {
    walkJson(block, (obj) => {
      const rawAddress = obj.address;
      if (!rawAddress || typeof rawAddress !== "object" || Array.isArray(rawAddress)) return;
      const address = rawAddress as Record<string, unknown>;
      const street = cleanText(address.streetAddress);
      const city = cleanText(address.addressLocality);
      const region = cleanText(address.addressRegion);
      const country = cleanText(address.addressCountry);
      if (!street && !city) return;
      found.push({
        name: cleanText(obj.name),
        address: street || undefined,
        city: city || undefined,
        region: region || undefined,
        country: country || undefined,
      });
    });
  }

  return found[0] ?? null;
}

function visibleAddressFromText(text: string) {
  const decoded = decodeHtml(text);
  const streetMatch = decoded.match(
    /\b(\d{1,6}\s+[A-Z0-9][A-Za-z0-9'.\-\s]{2,80}\s(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Highway|Hwy\.?|Way|Court|Ct\.?|Place|Pl\.?))\b/
  );
  const afterStreet = streetMatch?.[0]
    ? decoded.slice(decoded.indexOf(streetMatch[0]) + streetMatch[0].length, decoded.indexOf(streetMatch[0]) + streetMatch[0].length + 180)
    : "";
  const addressCityRegionMatch = afterStreet.match(
    /,\s*(?:PO Box\s+\d+\s*,\s*)?([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,2})\s*,\s*([A-Z]{2}|Ontario|Canada|USA|United States)\b/
  );
  const cityRegionMatch = decoded.match(/\b(?:in|at|near)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})(?:,\s*(Ontario|ON|Canada|USA|United States))?\b/);
  return {
    address: cleanText(streetMatch?.[1]) || undefined,
    city: cleanText(addressCityRegionMatch?.[1]) || cleanText(cityRegionMatch?.[1]) || undefined,
    region: cleanText(addressCityRegionMatch?.[2]) || cleanText(cityRegionMatch?.[2]) || undefined,
  };
}

async function enrichWebVenueCandidate(candidate: WebVenueCandidate, query: string): Promise<WebVenueCandidate> {
  if (!candidate.sourceUrl || candidate.sourceUrl.includes("facebook.com")) return candidate;

  try {
    const res = await fetch(candidate.sourceUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    const contentType = res.headers.get("content-type") || "";
    if (!res.ok || !contentType.includes("text/html")) return candidate;

    const html = (await res.text()).slice(0, 250_000);
    const jsonLdAddress = schemaAddressFromJsonLd(extractJsonLd(html));
    const visibleAddress = visibleAddressFromText(`${candidate.metadata?.description || ""} ${stripHtml(html).slice(0, 20_000)}`);
    const name = jsonLdAddress?.name && nameOverlap(query, jsonLdAddress.name) >= 0.5 ? jsonLdAddress.name : candidate.canonicalName;

    const next: WebVenueCandidate = {
      ...candidate,
      canonicalName: name,
      label: name,
      address: candidate.address || jsonLdAddress?.address || visibleAddress.address,
      city: candidate.city || jsonLdAddress?.city || visibleAddress.city,
      region: candidate.region || jsonLdAddress?.region || visibleAddress.region,
      country: candidate.country || jsonLdAddress?.country,
      confidence: Math.min(100, candidate.confidence + (jsonLdAddress?.address || visibleAddress.address ? 8 : visibleAddress.city ? 4 : 0)),
      metadata: {
        ...(candidate.metadata ?? {}),
        enrichedFromPage: true,
      },
    };
    next.subtitle = subtitle(next) || candidate.subtitle;
    return next;
  } catch {
    return candidate;
  }
}

function addressLine(address: Record<string, unknown>) {
  return [
    cleanText(address.house_number),
    cleanText(address.road),
  ].filter(Boolean).join(" ");
}

function addressCity(address: Record<string, unknown>) {
  return (
    cleanText(address.city) ||
    cleanText(address.town) ||
    cleanText(address.village) ||
    cleanText(address.hamlet) ||
    cleanText(address.municipality) ||
    cleanText(address.suburb)
  );
}

function addressRegion(address: Record<string, unknown>) {
  return cleanText(address.state) || cleanText(address.province) || cleanText(address.region) || cleanText(address.county);
}

function addressCountry(address: Record<string, unknown>) {
  const code = cleanText(address.country_code).toUpperCase();
  if (code === "CA") return "Canada";
  if (code === "US") return "USA";
  return cleanText(address.country) || code;
}

function subtitle(candidate: Pick<WebVenueCandidate, "address" | "city" | "region" | "sourceName" | "provider">) {
  return [candidate.address, candidate.city, candidate.region, candidate.sourceName || candidate.provider].filter(Boolean).join(", ");
}

function dedupeCandidates(candidates: WebVenueCandidate[], query: string, limit: number) {
  const byKey = new Map<string, WebVenueCandidate>();

  for (const candidate of candidates) {
    const key = [
      normalizedName(candidate.canonicalName),
      normalizedName(candidate.address ?? ""),
      normalizedName(candidate.city ?? ""),
      normalizedName(candidate.region ?? ""),
      normalizedName(candidate.country ?? ""),
    ].join(":");
    const existing = byKey.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      byKey.set(key, candidate);
    }
  }

  return Array.from(byKey.values())
    .filter((candidate) => {
      const searchable = [candidate.canonicalName, candidate.label, candidate.subtitle, candidate.sourceUrl].filter(Boolean).join(" ");
      return nameOverlap(query, searchable) >= 0.5;
    })
    .sort((a, b) => {
      const confidenceDiff = b.confidence - a.confidence;
      if (confidenceDiff !== 0) return confidenceDiff;
      return a.canonicalName.localeCompare(b.canonicalName);
    })
    .slice(0, limit);
}

async function fetchOpenStreetMapVenueCandidates(query: string, limit: number): Promise<WebVenueCandidate[]> {
  if (query.length < 3 || limit <= 0) return [];

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("extratags", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 10)));
  url.searchParams.set("accept-language", "en");

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(6000),
    next: { revalidate: 86400 },
  });
  if (!res.ok) return [];

  const data = await res.json();
  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((row: any) => {
      const rawAddress = row?.address && typeof row.address === "object" ? row.address as Record<string, unknown> : {};
      const namedetails = row?.namedetails && typeof row.namedetails === "object" ? row.namedetails as Record<string, unknown> : {};
      const name = cleanText(row?.name) || cleanText(namedetails.name) || titleToVenueName(cleanText(row?.display_name), query);
      const placeId = cleanText(row?.place_id ? String(row.place_id) : "");
      if (!name || !placeId) return null;

      const osmType = cleanText(row?.osm_type);
      const osmId = cleanText(row?.osm_id ? String(row.osm_id) : "");
      const address = addressLine(rawAddress);
      const city = addressCity(rawAddress);
      const region = addressRegion(rawAddress);
      const country = addressCountry(rawAddress);
      const sourceUrl = osmType && osmId ? `https://www.openstreetmap.org/${osmType}/${osmId}` : undefined;
      const sourceName = `OpenStreetMap ${cleanText(row?.type) || cleanText(row?.category) || "venue"}`;
      const confidence = 80 + Math.round(nameOverlap(query, [name, cleanText(row?.display_name)].join(" ")) * 15) + (address ? 5 : 0);

      const candidate: WebVenueCandidate = {
        type: "VENUE",
        label: name,
        canonicalName: name,
        provider: "openstreetmap",
        providerId: placeId,
        address: address || undefined,
        city: city || undefined,
        region: region || undefined,
        country: country || undefined,
        sourceUrl,
        sourceName,
        confidence,
        metadata: {
          lat: cleanText(row?.lat) || null,
          lon: cleanText(row?.lon) || null,
          displayName: cleanText(row?.display_name) || null,
          osmType: osmType || null,
          osmId: osmId || null,
          category: cleanText(row?.category) || null,
          placeType: cleanText(row?.type) || null,
        },
      };
      candidate.subtitle = subtitle(candidate);
      return candidate;
    })
    .filter(Boolean) as WebVenueCandidate[];
}

async function fetchBraveVenueCandidates(query: string, limit: number): Promise<WebVenueCandidate[]> {
  const key = process.env.BRAVE_API_KEY?.trim();
  if (!key || query.length < 3 || limit <= 0) return [];

  const searches = [`"${query}" venue address`, `"${query}" official venue`, `${query} live music venue address`];
  const out: WebVenueCandidate[] = [];

  for (const search of searches) {
    if (out.length >= limit) break;
    const params = new URLSearchParams({
      q: search,
      count: "8",
      search_lang: "en",
    });
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
      signal: AbortSignal.timeout(7000),
      cache: "no-store",
    });
    if (!res.ok) continue;

    const data = await res.json();
    const rows = Array.isArray(data?.web?.results) ? data.web.results : [];
    for (const row of rows) {
      const url = cleanText(row?.url);
      const title = cleanText(row?.title);
      const description = cleanText(row?.description);
      const name = titleToVenueName(title || query, query);
      const host = hostname(url);
      const searchable = [title, description, url].join(" ");
      const overlap = nameOverlap(query, searchable);
      if (!url || !name || overlap < 0.5) continue;

      const sourceName = host || "Web search";
      const candidate: WebVenueCandidate = {
        type: "VENUE",
        label: name,
        canonicalName: name,
        provider: "web-search",
        providerId: stableId([url, name, query]),
        sourceUrl: url,
        sourceName,
        confidence: 60 + Math.round(overlap * 20) + (host.includes(normalizedName(query).replace(/\s+/g, "")) ? 10 : 0),
        metadata: {
          title,
          description,
          search,
          host,
        },
      };
      candidate.subtitle = subtitle(candidate) || description || sourceName;
      out.push(await enrichWebVenueCandidate(candidate, query));
    }
  }

  return out.slice(0, limit);
}

export async function searchWebVenueCandidates({ query, limit = 8 }: { query: string; limit?: number }) {
  const q = cleanText(query);
  const max = Math.min(Math.max(limit, 1), 20);
  if (q.length < 2) return [];

  const [osm, brave] = await Promise.all([
    fetchOpenStreetMapVenueCandidates(q, max),
    fetchBraveVenueCandidates(q, max),
  ]);

  return dedupeCandidates([...osm, ...brave], q, max);
}

export async function saveWebVenueCandidate(candidate: WebVenueCandidate) {
  const canonicalName = cleanText(candidate.canonicalName || candidate.label);
  if (!canonicalName) {
    throw new Error("Venue name is required.");
  }

  const provider = candidate.provider === "openstreetmap" ? "openstreetmap" : "web-search";
  const providerId = cleanText(candidate.providerId) || stableId([candidate.sourceUrl, canonicalName, candidate.address, candidate.city]);

  return prisma.catalogEntity.upsert({
    where: {
      provider_providerId_type: {
        provider,
        providerId,
        type: "VENUE",
      },
    },
    create: {
      type: "VENUE",
      canonicalName,
      provider,
      providerId,
      aliases: null,
      subtitle: cleanText(candidate.subtitle) || null,
      address: cleanText(candidate.address) || null,
      city: cleanText(candidate.city) || null,
      region: cleanText(candidate.region) || null,
      country: cleanText(candidate.country) || null,
      sourceUrl: cleanText(candidate.sourceUrl) || null,
      metadata: safeJson({
        sourceName: cleanText(candidate.sourceName) || null,
        confidence: candidate.confidence,
        ...(candidate.metadata ?? {}),
      }),
      lastSeenAt: new Date(),
    },
    update: {
      canonicalName,
      subtitle: cleanText(candidate.subtitle) || null,
      address: cleanText(candidate.address) || null,
      city: cleanText(candidate.city) || null,
      region: cleanText(candidate.region) || null,
      country: cleanText(candidate.country) || null,
      sourceUrl: cleanText(candidate.sourceUrl) || null,
      metadata: safeJson({
        sourceName: cleanText(candidate.sourceName) || null,
        confidence: candidate.confidence,
        ...(candidate.metadata ?? {}),
      }),
      lastSeenAt: new Date(),
    },
  });
}
