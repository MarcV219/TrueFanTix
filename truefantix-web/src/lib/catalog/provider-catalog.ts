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

function wordsForSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function normalizedDisplayName(value: string) {
  return wordsForSearch(value).join(" ");
}

function providerRank(provider: string) {
  if (provider === "ticketmaster" || provider === "ticketmaster-city") return 400;
  if (provider === "static") return 300;
  if (provider === "openstreetmap" || provider === "openstreetmap-place") return 285;
  if (provider === "wikidata") return 275;
  if (provider === "geonames") return 250;
  if (provider === "musicbrainz") return 200;
  return 100;
}

function typedMatchRank(item: ProviderCatalogSuggestion, query: string) {
  const names = [item.canonicalName || item.label, item.label, item.value, ...(item.aliases ?? [])]
    .map((value) => normalizedDisplayName(value))
    .filter(Boolean);
  const q = normalizedDisplayName(query);
  if (!q) return 0;
  if (names.some((name) => name === q)) return 1000;
  if (names.some((name) => name.startsWith(q))) return 800;
  return 0;
}

function suggestionRank(item: ProviderCatalogSuggestion, query: string) {
  const exactCuratedBoost =
    item.provider === "static" && normalizedDisplayName(item.canonicalName || item.label) === normalizedDisplayName(query)
      ? 500
      : 0;
  const canadaBoost = item.country === "Canada" || item.country === "CA" ? 100 : 0;
  const ontarioBoost = item.region === "ON" ? 75 : 0;
  const locationBoost = [item.address, item.city, item.region, item.country].filter(Boolean).length * 80;
  return (
    typedMatchRank(item, query) +
    providerRank(item.provider) +
    exactCuratedBoost +
    canadaBoost +
    ontarioBoost +
    locationBoost +
    Math.min(item.aliases?.length ?? 0, 20)
  );
}

function dedupeDisplaySuggestions(items: ProviderCatalogSuggestion[], query: string) {
  const bestByName = new Map<string, ProviderCatalogSuggestion>();
  const locatedVenueNames = new Set<string>();

  for (const item of items) {
    const nameKey = `${item.type}:${normalizedDisplayName(item.canonicalName || item.label)}`;
    const hasLocation = Boolean(item.address || item.city || item.region || item.country);
    if ((item.type === "VENUE" || item.type === "CITY") && hasLocation) {
      locatedVenueNames.add(nameKey);
    }
  }

  for (const item of items) {
    const nameKey = `${item.type}:${normalizedDisplayName(item.canonicalName || item.label)}`;
    const hasLocation = Boolean(item.address || item.city || item.region || item.country);
    if ((item.type === "VENUE" || item.type === "CITY") && !hasLocation && locatedVenueNames.has(nameKey)) {
      continue;
    }

    const locationKey =
      item.type === "VENUE" || item.type === "CITY"
        ? [item.city, item.region, item.country].map((part) => normalizedDisplayName(part ?? "")).join(":")
        : "";
    const key = `${nameKey}:${locationKey}`;
    const existing = bestByName.get(key);
    if (!existing || suggestionRank(item, query) > suggestionRank(existing, query)) {
      bestByName.set(key, item);
    }
  }

  return Array.from(bestByName.values()).sort((a, b) => {
    const rankDiff = suggestionRank(b, query) - suggestionRank(a, query);
    if (rankDiff !== 0) return rankDiff;
    return a.label.localeCompare(b.label);
  });
}

function suggestionSearchWords(item: ProviderCatalogSuggestion) {
  return [
    item.label,
    item.value,
    item.canonicalName,
    item.subtitle,
    item.address,
    item.city,
    item.region,
    item.country,
    ...(item.aliases ?? []),
  ].flatMap((value) => wordsForSearch(value ?? ""));
}

function matchesTypedQuery(item: ProviderCatalogSuggestion, query: string) {
  const queryWords = wordsForSearch(query);
  if (queryWords.length === 0) return true;

  const candidateWords = suggestionSearchWords(item);
  return queryWords.every((queryWord) => candidateWords.some((candidateWord) => candidateWord.startsWith(queryWord)));
}

function filterTypedMatches(items: ProviderCatalogSuggestion[], query: string) {
  return items.filter((item) => matchesTypedQuery(item, query));
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
    metadata: entity.metadata ?? undefined,
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
  if (subType.includes("team") || type.includes("team")) return "TEAM";
  if (segment === "sports") return "SPORT";
  if (segment === "music") return "ARTIST";
  if (segment || subType || type) return "SHOW";
  return null;
}

function ticketmasterVenueSuggestion(venue: any): ProviderCatalogSuggestion | null {
  const name = cleanText(venue.name);
  const id = cleanText(venue.id);
  if (!name || !id) return null;

  const city = cleanText(venue.city?.name);
  const region = cleanText(venue.state?.stateCode || venue.state?.name);
  const country = cleanText(venue.country?.countryCode || venue.country?.name);
  const address = cleanText(venue.address?.line1);
  return {
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
    metadata: safeJson({
      latitude: cleanText(venue.location?.latitude) || null,
      longitude: cleanText(venue.location?.longitude) || null,
      timezone: cleanText(venue.timezone) || null,
    }),
  };
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
    const baseType = ticketmasterType(attraction);
    const resolvedType = type === "SHOW" && baseType && baseType !== "ARTIST" && baseType !== "TEAM" ? "SHOW" : baseType;
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
      const venueSuggestion = ticketmasterVenueSuggestion(venue);
      if (!venueSuggestion) continue;
      const name = venueSuggestion.canonicalName;
      const city = cleanText(venue.city?.name);
      const region = cleanText(venue.state?.stateCode || venue.state?.name);
      const country = cleanText(venue.country?.countryCode || venue.country?.name);
      if (type === "ALL" || type === "VENUE") {
        out.push(venueSuggestion);
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

  return cacheSuggestions(
    uniqueByKey(filterTypedMatches(out, query), (item) => `${item.provider}:${item.providerId}:${item.type}`).slice(0, limit)
  );
}

async function fetchTicketmasterVenueSearch(query: string, type: CatalogSuggestionType | "ALL", limit: number) {
  const key = process.env.TICKETMASTER_API_KEY?.trim();
  if (!key || query.length < 2 || limit <= 0 || (type !== "ALL" && type !== "VENUE")) return [];

  const countries = ["CA", "US", "MX"];
  const venues: any[] = [];

  for (const countryCode of countries) {
    const url = new URL("https://app.ticketmaster.com/discovery/v2/venues.json");
    url.searchParams.set("apikey", key);
    url.searchParams.set("keyword", query);
    url.searchParams.set("countryCode", countryCode);
    url.searchParams.set("size", String(Math.min(limit, 20)));
    url.searchParams.set("locale", "*");

    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, next: { revalidate: 3600 } });
    if (!res.ok) continue;
    const data = await res.json();
    venues.push(...(Array.isArray(data?._embedded?.venues) ? data._embedded.venues : []));
  }

  const items = venues
    .map(ticketmasterVenueSuggestion)
    .filter(Boolean) as ProviderCatalogSuggestion[];

  return cacheSuggestions(
    uniqueByKey(filterTypedMatches(items, query), (item) => `${item.provider}:${item.providerId}:${item.type}`).slice(0, limit)
  );
}

async function fetchMusicBrainzArtists(query: string, limit: number) {
  if (query.length < 2) return [];
  const queryWords = wordsForSearch(query);
  const queries = uniqueByKey(
    [
      `artist:${query}`,
      queryWords.length === 1 && queryWords[0].length <= 4 ? `artist:${queryWords[0]}*` : null,
    ].filter(Boolean) as string[],
    (item) => item
  );
  const artists: any[] = [];

  for (const musicBrainzQuery of queries) {
    const url = new URL("https://musicbrainz.org/ws/2/artist");
    url.searchParams.set("query", musicBrainzQuery);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", String(Math.min(limit, 10)));

    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, next: { revalidate: 86400 } });
    if (!res.ok) continue;
    const data = await res.json();
    artists.push(...(Array.isArray(data?.artists) ? data.artists : []));
  }

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

  return cacheSuggestions(filterTypedMatches(items, query).slice(0, limit));
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
        metadata: safeJson({
          population: city?.population ?? null,
          lat: city?.lat == null ? null : String(city.lat),
          lon: city?.lng == null ? null : String(city.lng),
        }),
        sourceUrl: `https://www.geonames.org/${id}`,
      };
    })
    .filter(Boolean) as ProviderCatalogSuggestion[];

  return cacheSuggestions(filterTypedMatches(items, query).slice(0, limit));
}

function osmPlaceName(address: Record<string, unknown>) {
  return (
    cleanText(address.city) ||
    cleanText(address.town) ||
    cleanText(address.village) ||
    cleanText(address.hamlet) ||
    cleanText(address.municipality) ||
    cleanText(address.suburb)
  );
}

function osmPlaceRegion(address: Record<string, unknown>) {
  return cleanText(address.state) || cleanText(address.province) || cleanText(address.region) || cleanText(address.county);
}

async function fetchOpenStreetMapPlaces(query: string, limit: number) {
  if (query.length < 5 || limit <= 0) return [];

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(Math.min(limit, 10)));
  url.searchParams.set("accept-language", "en");

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(5000),
    next: { revalidate: 86400 },
  });
  if (!res.ok) return [];

  const data = await res.json();
  const rows = Array.isArray(data) ? data : [];
  const placeTypes = new Set([
    "city",
    "town",
    "village",
    "hamlet",
    "municipality",
    "suburb",
    "locality",
    "administrative",
  ]);

  const items = rows
    .map((row: any) => {
      const address = row?.address && typeof row.address === "object" ? row.address as Record<string, unknown> : {};
      const rawType = cleanText(row?.addresstype || row?.type).toLowerCase();
      if (!placeTypes.has(rawType)) return null;

      const name = cleanText(row?.name) || osmPlaceName(address);
      const id = cleanText(row?.place_id ? String(row.place_id) : "");
      if (!name || !id) return null;

      const region = osmPlaceRegion(address);
      const country = cleanText(address.country_code).toUpperCase() || cleanText(address.country);
      const countryName = cleanText(address.country);
      const osmType = cleanText(row?.osm_type);
      const osmId = row?.osm_id == null ? "" : String(row.osm_id).trim();
      return {
        type: "CITY" as const,
        value: name,
        label: name,
        canonicalName: name,
        provider: "openstreetmap-place",
        providerId: id,
        subtitle: [region, country || countryName, `OpenStreetMap ${rawType || "place"}`].filter(Boolean).join(", "),
        city: name,
        region: region || undefined,
        country: country || countryName || undefined,
        aliases: cleanText(row?.display_name) ? [cleanText(row.display_name)] : [],
        sourceUrl: osmType && osmId ? `https://www.openstreetmap.org/${osmType}/${osmId}` : undefined,
        metadata: safeJson({
          lat: cleanText(row?.lat) || null,
          lon: cleanText(row?.lon) || null,
          osmType: osmType || null,
          osmId: osmId || null,
          displayName: cleanText(row?.display_name) || null,
        }),
      };
    })
    .filter(Boolean) as ProviderCatalogSuggestion[];

  return cacheSuggestions(filterTypedMatches(items, query).slice(0, limit));
}

function overpassRegexLiteral(value: string) {
  return normalizedDisplayName(value)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, ".*");
}

function osmAddress(tags: Record<string, unknown>) {
  return [
    cleanText(tags["addr:housenumber"]),
    cleanText(tags["addr:street"]),
  ].filter(Boolean).join(" ");
}

function osmCity(tags: Record<string, unknown>) {
  return cleanText(tags["addr:city"]) || cleanText(tags["addr:town"]) || cleanText(tags["addr:village"]);
}

function osmRegion(tags: Record<string, unknown>) {
  return cleanText(tags["addr:province"]) || cleanText(tags["addr:state"]);
}

function osmCountry(tags: Record<string, unknown>) {
  const code = cleanText(tags["addr:country"]).toUpperCase();
  if (code === "CA") return "Canada";
  if (code === "US") return "USA";
  if (code === "MX") return "Mexico";
  return code || undefined;
}

function osmVenueSubtitle({
  tags,
  address,
  city,
  region,
}: {
  tags: Record<string, unknown>;
  address?: string;
  city?: string;
  region?: string;
}) {
  const category =
    cleanText(tags.amenity) ||
    cleanText(tags.leisure) ||
    cleanText(tags.tourism) ||
    cleanText(tags.building) ||
    "OpenStreetMap venue";
  return [address, city, region, category === "OpenStreetMap venue" ? category : `OpenStreetMap ${category}`]
    .filter(Boolean)
    .join(", ");
}

async function fetchOpenStreetMapVenues(query: string, limit: number) {
  if (query.length < 4 || limit <= 0) return [];

  const regex = overpassRegexLiteral(query);
  if (!regex || regex.length < 4) return [];

  const endpoint = process.env.OPENSTREETMAP_OVERPASS_URL?.trim() || "https://overpass-api.de/api/interpreter";
  const boundedLimit = Math.min(Math.max(limit, 1), 12);
  const overpassQuery = `
[out:json][timeout:8];
area["ISO3166-1"="CA"][admin_level=2]->.ca;
area["ISO3166-1"="US"][admin_level=2]->.us;
area["ISO3166-1"="MX"][admin_level=2]->.mx;
(
  nwr(area.ca)["name"~"${regex}",i]["amenity"~"^(theatre|cinema|arts_centre|events_venue|conference_centre|community_centre|music_venue|nightclub)$"];
  nwr(area.us)["name"~"${regex}",i]["amenity"~"^(theatre|cinema|arts_centre|events_venue|conference_centre|community_centre|music_venue|nightclub)$"];
  nwr(area.mx)["name"~"${regex}",i]["amenity"~"^(theatre|cinema|arts_centre|events_venue|conference_centre|community_centre|music_venue|nightclub)$"];
  nwr(area.ca)["name"~"${regex}",i]["leisure"~"^(stadium|sports_centre|track)$"];
  nwr(area.us)["name"~"${regex}",i]["leisure"~"^(stadium|sports_centre|track)$"];
  nwr(area.mx)["name"~"${regex}",i]["leisure"~"^(stadium|sports_centre|track)$"];
  nwr(area.ca)["name"~"${regex}",i]["building"~"^(stadium|theatre|civic)$"];
  nwr(area.us)["name"~"${regex}",i]["building"~"^(stadium|theatre|civic)$"];
  nwr(area.mx)["name"~"${regex}",i]["building"~"^(stadium|theatre|civic)$"];
  nwr(area.ca)["name"~"${regex}",i]["tourism"="attraction"];
  nwr(area.us)["name"~"${regex}",i]["tourism"="attraction"];
  nwr(area.mx)["name"~"${regex}",i]["tourism"="attraction"];
);
out center tags ${boundedLimit};
`.trim();

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({ data: overpassQuery }).toString(),
    signal: AbortSignal.timeout(5000),
    next: { revalidate: 86400 },
  });
  if (!res.ok) return [];

  const data = await res.json();
  const rows = Array.isArray(data?.elements) ? data.elements : [];
  const items = rows
    .map((row: any) => {
      const tags = row?.tags && typeof row.tags === "object" ? row.tags as Record<string, unknown> : {};
      const name = cleanText(tags.name);
      const id = cleanText(row?.id ? String(row.id) : "");
      const elementType = cleanText(row?.type);
      if (!name || !id || !elementType) return null;

      const address = osmAddress(tags);
      const city = osmCity(tags);
      const region = osmRegion(tags);
      const country = osmCountry(tags);
      const lat = typeof row?.lat === "number" ? row.lat : typeof row?.center?.lat === "number" ? row.center.lat : null;
      const lon = typeof row?.lon === "number" ? row.lon : typeof row?.center?.lon === "number" ? row.center.lon : null;

      return {
        type: "VENUE" as const,
        value: name,
        label: name,
        canonicalName: name,
        provider: "openstreetmap",
        providerId: `${elementType}:${id}`,
        subtitle: osmVenueSubtitle({ tags, address: address || undefined, city: city || undefined, region: region || undefined }),
        address: address || undefined,
        city: city || undefined,
        region: region || undefined,
        country,
        sourceUrl: `https://www.openstreetmap.org/${elementType}/${id}`,
        metadata: safeJson({
          osmType: elementType,
          osmId: id,
          lat,
          lon,
          category: cleanText(tags.amenity) || cleanText(tags.leisure) || cleanText(tags.building) || null,
        }),
      };
    })
    .filter(Boolean) as ProviderCatalogSuggestion[];

  return cacheSuggestions(filterTypedMatches(items, query).slice(0, boundedLimit));
}

const WIKIDATA_REJECT_TERMS = [
  "wikimedia",
  "wikinews",
  "disambiguation",
  "article",
  "defunct",
  "season",
  "statistics",
  "records",
  "match",
  "game",
  "film",
  "television series",
  "album",
  "song",
];

const WIKIDATA_ARTIST_TERMS = [
  "musician",
  "singer",
  "rapper",
  "band",
  "musical group",
  "music group",
  "record producer",
  "disc jockey",
  "dj",
  "composer",
  "songwriter",
  "vocalist",
  "guitarist",
  "pianist",
  "drummer",
  "bassist",
  "violinist",
  "orchestra",
  "choir",
  "music artist",
  "recording artist",
];

const WIKIDATA_TEAM_TERMS = [
  "team",
  "club",
  "franchise",
  "football",
  "baseball",
  "basketball",
  "hockey",
  "soccer",
  "lacrosse",
  "rugby",
  "volleyball",
  "softball",
  "curling",
];

const WIKIDATA_VENUE_TERMS = [
  "venue",
  "stadium",
  "arena",
  "theatre",
  "theater",
  "amphitheatre",
  "amphitheater",
  "ballpark",
  "field",
  "centre",
  "center",
  "coliseum",
  "auditorium",
  "hall",
  "racetrack",
  "speedway",
];

const WIKIDATA_NORTH_AMERICA_TERMS = [
  "canada",
  "canadian",
  "united states",
  "usa",
  "u.s.",
  "american",
  "mexico",
  "mexican",
  "north america",
  "cfl",
  "nfl",
  "nba",
  "nhl",
  "mlb",
  "mls",
  "nll",
  "ahl",
  "ohl",
  "whl",
  "qmjhl",
  "pwhl",
  "ncaa",
];

function includesAnyTerm(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function includesAnyWholeTerm(text: string, terms: string[]) {
  return terms.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
  });
}

function isExactOrPrefixName(label: string, query: string) {
  const name = normalizedDisplayName(label);
  const q = normalizedDisplayName(query);
  return Boolean(q && (name === q || name.startsWith(`${q} `) || q.startsWith(`${name} `)));
}

function wikidataTypeMatches(type: CatalogSuggestionType, label: string, description: string) {
  const searchable = `${label} ${description}`.toLowerCase();
  if (includesAnyWholeTerm(searchable, WIKIDATA_REJECT_TERMS)) return false;
  if (type === "ARTIST") return includesAnyTerm(searchable, WIKIDATA_ARTIST_TERMS);
  if (type === "TEAM") return includesAnyTerm(searchable, WIKIDATA_TEAM_TERMS);
  if (type === "VENUE") return includesAnyTerm(searchable, WIKIDATA_VENUE_TERMS);
  return false;
}

function wikidataNorthAmericaConfidence(label: string, description: string, query: string) {
  const searchable = `${label} ${description}`.toLowerCase();
  if (includesAnyTerm(searchable, WIKIDATA_NORTH_AMERICA_TERMS)) return true;
  return isExactOrPrefixName(label, query);
}

async function fetchWikidataSuggestions(query: string, type: CatalogSuggestionType | "ALL", limit: number) {
  if (query.length < 3 || (type !== "ALL" && type !== "ARTIST" && type !== "TEAM" && type !== "VENUE")) return [];

  const url = new URL("https://www.wikidata.org/w/api.php");
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("search", query);
  url.searchParams.set("language", "en");
  url.searchParams.set("uselang", "en");
  url.searchParams.set("type", "item");
  url.searchParams.set("limit", String(Math.min(limit * 2, 20)));
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, next: { revalidate: 86400 } });
  if (!res.ok) return [];
  const data = await res.json();
  const rows = Array.isArray(data?.search) ? data.search : [];
  const wantedTypes: CatalogSuggestionType[] = type === "ALL" ? ["ARTIST", "TEAM", "VENUE"] : [type];
  const items: ProviderCatalogSuggestion[] = [];

  for (const row of rows) {
    const id = cleanText(row?.id);
    const label = cleanText(row?.label);
    const description = cleanText(row?.description);
    if (!id || !label) continue;

    for (const wantedType of wantedTypes) {
      if (!wikidataTypeMatches(wantedType, label, description)) continue;
      if (wantedType !== "ARTIST" && !wikidataNorthAmericaConfidence(label, description, query)) continue;

      items.push({
        type: wantedType,
        value: label,
        label,
        canonicalName: label,
        provider: "wikidata",
        providerId: `${id}:${wantedType.toLowerCase()}`,
        subtitle: [description, "Wikidata"].filter(Boolean).join(" · "),
        aliases: Array.isArray(row?.aliases) ? row.aliases.map(cleanText).filter(Boolean) : [],
        sourceUrl: `https://www.wikidata.org/wiki/${id}`,
        metadata: safeJson({ wikidataId: id, description }),
      });
    }
  }

  return cacheSuggestions(
    uniqueByKey(filterTypedMatches(items, query), (item) => `${item.provider}:${item.providerId}:${item.type}`).slice(0, limit)
  );
}

async function fetchProviderSuggestions(query: string, type: CatalogSuggestionType | "ALL", limit: number) {
  const out: ProviderCatalogSuggestion[] = [];

  try {
    out.push(...await fetchTicketmasterSuggestions(query, type, limit));
  } catch {
    // Provider failures should not break autocomplete.
  }

  if (out.length < limit && (type === "ALL" || type === "VENUE")) {
    try {
      out.push(...await fetchTicketmasterVenueSearch(query, type, limit - out.length));
    } catch {
      // Provider failures should not break autocomplete.
    }
  }

  if (out.length < limit && (type === "ALL" || type === "VENUE")) {
    try {
      out.push(...await fetchOpenStreetMapVenues(query, limit - out.length));
    } catch {
      // OpenStreetMap provider failures should not break autocomplete.
    }
  }

  if ((type === "ARTIST" || out.length < limit) && (type === "ALL" || type === "ARTIST" || type === "TEAM" || type === "VENUE" || type === "SHOW")) {
    try {
      out.push(...await fetchWikidataSuggestions(query, type, type === "ARTIST" ? limit : limit - out.length));
    } catch {
      // Wikidata is broad public data; stale/local/static results are acceptable fallback.
    }
  }

  if (out.length < limit && (type === "ALL" || type === "CITY")) {
    try {
      out.push(...await fetchGeoNamesCities(query, limit - out.length));
    } catch {
      // Provider failures should not break autocomplete.
    }
  }

  if (out.length < limit && type === "CITY") {
    try {
      out.push(...await fetchOpenStreetMapPlaces(query, limit - out.length));
    } catch {
      // Public place lookup is best-effort; local/static results remain acceptable fallback.
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
  const providerItems = includeProviders ? await fetchProviderSuggestions(q, resolvedType, max) : [];
  const staticItems = await cacheSuggestions(filterTypedMatches(fromStaticCatalog(q, resolvedType, max), q));

  return dedupeDisplaySuggestions(
    uniqueByKey(
      filterTypedMatches([...providerItems, ...local, ...staticItems], q),
      (item) => `${item.provider}:${item.providerId}:${item.type}`
    ),
    q
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
