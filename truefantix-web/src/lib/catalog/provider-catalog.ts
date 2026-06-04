import { prisma } from "@/lib/prisma";
import { LIVE_EVENT_CATALOG, searchCatalogSuggestions, type CatalogSuggestionType } from "@/lib/catalog/live-event-catalog";

export type ProviderCatalogSuggestion = {
  type: CatalogSuggestionType;
  value: string;
  label: string;
  canonicalName: string;
  catalogEntityId?: string;
  provider: string;
  providerId: string;
  subtitle?: string;
  address?: string;
  city?: string;
  region?: string;
  country?: string;
  aliases?: string[];
  sourceUrl?: string;
  metadata?: string | null;
};

const USER_AGENT = "TrueFanTix/0.1 (catalog sync; https://truefantix-web.vercel.app)";

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueByKey<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function parseAliases(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function staticProviderId(item: { type: string; value: string }) {
  return `${item.type}:${item.value}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function cacheSuggestions(items: ProviderCatalogSuggestion[]) {
  const cached: ProviderCatalogSuggestion[] = [];

  for (const item of items) {
    const entity = await prisma.catalogEntity.upsert({
      where: {
        provider_providerId_type: {
          provider: item.provider,
          providerId: item.providerId,
          type: item.type,
        },
      },
      create: {
        type: item.type,
        canonicalName: item.canonicalName,
        provider: item.provider,
        providerId: item.providerId,
        aliases: item.aliases?.length ? JSON.stringify(item.aliases) : null,
        subtitle: item.subtitle ?? null,
        address: item.address ?? null,
        city: item.city ?? null,
        region: item.region ?? null,
        country: item.country ?? null,
        sourceUrl: item.sourceUrl ?? null,
        metadata: item.metadata ?? null,
        lastSeenAt: new Date(),
      },
      update: {
        canonicalName: item.canonicalName,
        aliases: item.aliases?.length ? JSON.stringify(item.aliases) : null,
        subtitle: item.subtitle ?? null,
        address: item.address ?? null,
        city: item.city ?? null,
        region: item.region ?? null,
        country: item.country ?? null,
        sourceUrl: item.sourceUrl ?? null,
        metadata: item.metadata ?? null,
        lastSeenAt: new Date(),
      },
    });

    cached.push({ ...item, catalogEntityId: entity.id });
  }

  return cached;
}

function fromCatalogEntity(entity: any): ProviderCatalogSuggestion {
  return {
    type: entity.type,
    value: entity.canonicalName,
    label: entity.canonicalName,
    canonicalName: entity.canonicalName,
    catalogEntityId: entity.id,
    provider: entity.provider,
    providerId: entity.providerId,
    subtitle: entity.subtitle ?? undefined,
    address: entity.address ?? undefined,
    city: entity.city ?? undefined,
    region: entity.region ?? undefined,
    country: entity.country ?? undefined,
    aliases: parseAliases(entity.aliases),
    sourceUrl: entity.sourceUrl ?? undefined,
  };
}

function fromStaticCatalog(query: string, type: CatalogSuggestionType | "ALL", limit: number) {
  return searchCatalogSuggestions({ query, type, limit }).map((item) => ({
    ...item,
    canonicalName: item.value,
    provider: "static",
    providerId: staticProviderId(item),
  }));
}

async function searchLocalCatalog(query: string, type: CatalogSuggestionType | "ALL", limit: number) {
  const whereType = type === "ALL" ? {} : { type };
  const entities = await prisma.catalogEntity.findMany({
    where: {
      ...whereType,
      OR: [
        { canonicalName: { contains: query, mode: "insensitive" } },
        { aliases: { contains: query, mode: "insensitive" } },
        { subtitle: { contains: query, mode: "insensitive" } },
        { city: { contains: query, mode: "insensitive" } },
        { region: { contains: query, mode: "insensitive" } },
        { country: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: [{ popularity: "desc" }, { canonicalName: "asc" }],
    take: limit,
  });

  return entities.map(fromCatalogEntity);
}

function ticketmasterType(raw: any): CatalogSuggestionType | null {
  const segment = cleanText(raw?.classifications?.[0]?.segment?.name).toLowerCase();
  const subType = cleanText(raw?.classifications?.[0]?.subType?.name).toLowerCase();
  const type = cleanText(raw?.classifications?.[0]?.type?.name).toLowerCase();
  if (segment === "sports" || subType.includes("team") || type.includes("team")) return "TEAM";
  if (segment === "music") return "ARTIST";
  return null;
}

async function fetchTicketmasterSuggestions(query: string, type: CatalogSuggestionType | "ALL", limit: number) {
  const key = process.env.TICKETMASTER_API_KEY?.trim();
  if (!key || query.length < 2) return [];

  const url = new URL("https://app.ticketmaster.com/discovery/v2/suggest.json");
  url.searchParams.set("apikey", key);
  url.searchParams.set("keyword", query);
  url.searchParams.set("size", String(Math.min(limit, 20)));
  url.searchParams.set("locale", "*");

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, next: { revalidate: 3600 } });
  if (!res.ok) return [];
  const data = await res.json();

  const attractions = Array.isArray(data?._embedded?.attractions) ? data._embedded.attractions : [];
  const venues = Array.isArray(data?._embedded?.venues) ? data._embedded.venues : [];
  const out: ProviderCatalogSuggestion[] = [];

  for (const attraction of attractions) {
    const resolvedType = ticketmasterType(attraction);
    if (!resolvedType || (type !== "ALL" && type !== resolvedType)) continue;
    const name = cleanText(attraction.name);
    const id = cleanText(attraction.id);
    if (!name || !id) continue;
    const classification = attraction.classifications?.[0];
    const genre = cleanText(classification?.genre?.name);
    const segment = cleanText(classification?.segment?.name);
    out.push({
      type: resolvedType,
      value: name,
      label: name,
      canonicalName: name,
      provider: "ticketmaster",
      providerId: id,
      subtitle: [segment, genre].filter(Boolean).join(" · ") || "Ticketmaster attraction",
      aliases: Array.isArray(attraction.aliases) ? attraction.aliases.map(cleanText).filter(Boolean) : [],
      sourceUrl: cleanText(attraction.url) || undefined,
    });
  }

  if (type === "ALL" || type === "VENUE" || type === "CITY") {
    for (const venue of venues) {
      const name = cleanText(venue.name);
      const id = cleanText(venue.id);
      if (!name || !id) continue;
      const city = cleanText(venue.city?.name);
      const region = cleanText(venue.state?.stateCode || venue.state?.name);
      const country = cleanText(venue.country?.countryCode || venue.country?.name);
      const address = cleanText(venue.address?.line1);
      if (type === "ALL" || type === "VENUE") {
        out.push({
          type: "VENUE",
          value: name,
          label: name,
          canonicalName: name,
          provider: "ticketmaster",
          providerId: id,
          subtitle: [address, city, region].filter(Boolean).join(", ") || "Ticketmaster venue",
          address: address || undefined,
          city: city || undefined,
          region: region || undefined,
          country: country || undefined,
          sourceUrl: cleanText(venue.url) || undefined,
        });
      }
      if (city && (type === "ALL" || type === "CITY")) {
        out.push({
          type: "CITY",
          value: city,
          label: city,
          canonicalName: city,
          provider: "ticketmaster-city",
          providerId: [country, region, city].filter(Boolean).join(":").toLowerCase(),
          subtitle: [region, country, "Ticketmaster event city"].filter(Boolean).join(", "),
          city,
          region: region || undefined,
          country: country || undefined,
        });
      }
    }
  }

  return cacheSuggestions(uniqueByKey(out, (item) => `${item.provider}:${item.providerId}:${item.type}`).slice(0, limit));
}

async function fetchMusicBrainzArtists(query: string, limit: number) {
  if (query.length < 2) return [];
  const url = new URL("https://musicbrainz.org/ws/2/artist");
  url.searchParams.set("query", `artist:${query}`);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", String(Math.min(limit, 10)));

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, next: { revalidate: 86400 } });
  if (!res.ok) return [];
  const data = await res.json();
  const artists = Array.isArray(data?.artists) ? data.artists : [];

  const items = artists
    .map((artist: any) => {
      const name = cleanText(artist?.name);
      const id = cleanText(artist?.id);
      if (!name || !id) return null;
      const aliases = Array.isArray(artist?.aliases)
        ? artist.aliases.map((alias: any) => cleanText(alias?.name)).filter(Boolean)
        : [];
      const country = cleanText(artist?.country);
      const disambiguation = cleanText(artist?.disambiguation);
      return {
        type: "ARTIST" as const,
        value: name,
        label: name,
        canonicalName: name,
        provider: "musicbrainz",
        providerId: id,
        subtitle: [disambiguation, country, "MusicBrainz artist"].filter(Boolean).join(" · "),
        country: country || undefined,
        aliases,
        sourceUrl: `https://musicbrainz.org/artist/${id}`,
      };
    })
    .filter(Boolean) as ProviderCatalogSuggestion[];

  return cacheSuggestions(items);
}

async function fetchGeoNamesCities(query: string, limit: number) {
  const username = process.env.GEONAMES_USERNAME?.trim();
  if (!username || query.length < 2) return [];

  const url = new URL("https://secure.geonames.org/searchJSON");
  url.searchParams.set("username", username);
  url.searchParams.set("name_startsWith", query);
  url.searchParams.set("featureClass", "P");
  url.searchParams.set("country", "CA");
  url.searchParams.append("country", "US");
  url.searchParams.set("maxRows", String(Math.min(limit, 20)));
  url.searchParams.set("style", "MEDIUM");
  url.searchParams.set("orderby", "population");

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, next: { revalidate: 86400 } });
  if (!res.ok) return [];
  const data = await res.json();
  const rows = Array.isArray(data?.geonames) ? data.geonames : [];

  const items = rows
    .map((city: any) => {
      const name = cleanText(city?.name);
      const id = cleanText(city?.geonameId ? String(city.geonameId) : "");
      if (!name || !id) return null;
      const region = cleanText(city?.adminCode1 || city?.adminName1);
      const country = cleanText(city?.countryCode || city?.countryName);
      return {
        type: "CITY" as const,
        value: name,
        label: name,
        canonicalName: name,
        provider: "geonames",
        providerId: id,
        subtitle: [region, country, "GeoNames city"].filter(Boolean).join(", "),
        city: name,
        region: region || undefined,
        country: country || undefined,
        metadata: safeJson({ population: city?.population ?? null }),
        sourceUrl: `https://www.geonames.org/${id}`,
      };
    })
    .filter(Boolean) as ProviderCatalogSuggestion[];

  return cacheSuggestions(items);
}

async function fetchProviderSuggestions(query: string, type: CatalogSuggestionType | "ALL", limit: number) {
  const out: ProviderCatalogSuggestion[] = [];

  try {
    out.push(...await fetchTicketmasterSuggestions(query, type, limit));
  } catch {
    // Provider failures should not break autocomplete.
  }

  if (out.length < limit && (type === "ALL" || type === "CITY")) {
    try {
      out.push(...await fetchGeoNamesCities(query, limit - out.length));
    } catch {
      // Provider failures should not break autocomplete.
    }
  }

  if (out.length < limit && (type === "ALL" || type === "ARTIST")) {
    try {
      out.push(...await fetchMusicBrainzArtists(query, limit - out.length));
    } catch {
      // MusicBrainz is public and rate-limited; stale/local/static results are acceptable fallback.
    }
  }

  return out;
}

export async function searchProviderCatalog({
  query,
  type,
  limit = 12,
  includeProviders = true,
}: {
  query?: string;
  type?: CatalogSuggestionType | "ALL";
  limit?: number;
  includeProviders?: boolean;
}) {
  const q = (query ?? "").trim();
  const resolvedType = type ?? "ALL";
  const max = Math.min(Math.max(limit, 1), 50);
  if (!q) {
    return cacheSuggestions(fromStaticCatalog("", resolvedType, max));
  }

  const local = await searchLocalCatalog(q, resolvedType, max);
  const providerItems = includeProviders && local.length < max ? await fetchProviderSuggestions(q, resolvedType, max) : [];
  const staticItems = await cacheSuggestions(fromStaticCatalog(q, resolvedType, max));

  return uniqueByKey(
    [...local, ...providerItems, ...staticItems],
    (item) => `${item.provider}:${item.providerId}:${item.type}`
  ).slice(0, max);
}

export async function seedStaticCatalog() {
  const items = LIVE_EVENT_CATALOG.map((item) => ({
    ...item,
    canonicalName: item.value,
    provider: "static",
    providerId: staticProviderId(item),
  }));
  return cacheSuggestions(items);
}
