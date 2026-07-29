import { isTicketEventExpired } from "@/lib/tickets/expiry";

export type EventTypeInfo = { type: string; label: string; placeholder: string };

export type ApiTicketLike = {
  id: string;
  title: string;
  date: string;
  venue: string;
  venueLocation?: {
    address?: string | null;
    city?: string | null;
    region?: string | null;
    country?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  section?: string | null;
  row?: string | null;
  seat?: string | null;
  price?: number;
  priceCents?: number;
  currency?: string | null;
  faceValue?: number | null;
  faceValueCents?: number | null;
  confirmedMaxListPriceCents?: number | null;
  status?: string;
  image?: string;
  sellerId?: string;
  eventTypeOverride?: string | null;
  isAboveConfirmedFaceValue?: boolean;
  isValidationMismatch?: boolean;
  isPriceUnconfirmed?: boolean;
  seller?: {
    badges?: string[];
    rating?: number;
    reviews?: number;
  } | null;
  event?: {
    selloutStatus?: "SOLD_OUT" | "NOT_SOLD_OUT" | string;
  } | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  verifiedAt?: string | Date | null;
};

export type TicketCardView = {
  id: string;
  title: string;
  date: string;
  venue: string;
  venueAddress: string | null;
  city: string;
  province: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  section: string | null;
  row: string | null;
  seat: string | null;
  price: number;
  currency: string;
  faceValue: number | null;
  confirmedMaxListPriceCents: number | null;
  image: string;
  sellerId: string;
  badges: string[];
  rating: number;
  reviews: number;
  priceTag: "Face Value" | "Below Face Value";
  eventType: string;
  eventTypeLabel: string;
  isSoldOut: boolean;
  placeholderImage: string;
  dynamicImage?: string;
  isAboveConfirmedFaceValue: boolean;
  isPastEvent: boolean;
  isValidationMismatch: boolean;
  isPriceUnconfirmed: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  verifiedAt: string | null;
};

export type TicketEventGroup<T extends TicketCardView = TicketCardView> = {
  key: string;
  tickets: T[];
};

export type FeaturedTicketPreference = {
  type: string;
  value: string;
  status?: string | null;
  catalogEntity?: {
    canonicalName?: string | null;
    aliases?: string | null;
    subtitle?: string | null;
  } | null;
};

export type FeaturedTicketRankContext = {
  userCoords?: { lat: number; lon: number } | null;
  notificationRadiusKm?: number | null;
  preferences?: FeaturedTicketPreference[];
};

export type FeaturedTicketReason =
  | "Matches your favorites"
  | "Near you"
  | "In your saved cities"
  | "Venue you follow"
  | "Below face value"
  | "Verified ticket"
  | "New listing"
  | "Coming soon";

export type RankedFeaturedTicket<T> = T & {
  featuredScore: number;
  featuredReasons: FeaturedTicketReason[];
};

const DEFAULT_IMAGE = "/default.jpg";

export function resolveTicketImageSrc(raw: unknown) {
  let s = String(raw ?? "").trim();
  if (!s) return DEFAULT_IMAGE;

  const winPublicIdx = s.toLowerCase().lastIndexOf("\\public\\");
  if (winPublicIdx !== -1) s = s.slice(winPublicIdx + "\\public\\".length).replaceAll("\\", "/");

  if (s.toLowerCase().startsWith("public/")) s = s.slice("public/".length);
  if (s.toLowerCase().startsWith("/public/")) s = s.slice("/public/".length);

  if (s === "/img" || s.startsWith("/img?") || s.startsWith("/img/")) return DEFAULT_IMAGE;
  if (s === "img" || s.startsWith("img?") || s.startsWith("img/")) return DEFAULT_IMAGE;

  if (s === "/seed-image" || s.startsWith("/seed-image?") || s.startsWith("/seed-image/")) return DEFAULT_IMAGE;
  if (s === "seed-image" || s.startsWith("seed-image?") || s.startsWith("seed-image/")) return DEFAULT_IMAGE;

  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (!s.startsWith("/")) s = `/${s}`;
  return s;
}

export function normalizeCurrency(value: unknown): "CAD" | "USD" {
  return String(value || "CAD").trim().toUpperCase() === "USD" ? "USD" : "CAD";
}

export function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: normalizeCurrency(currency),
    currencyDisplay: "narrowSymbol",
  }).format(amount);
}

export function formatCents(cents: number, currency: string) {
  return formatMoney(cents / 100, currency);
}

export function computePriceTag(price: number, faceValue: number | null, isSoldOut = false, maxListPrice: number | null = null): "Face Value" | "Below Face Value" {
  if (isSoldOut) return "Face Value";
  const cap = maxListPrice ?? faceValue;
  if (cap == null) return "Face Value";
  return price < cap ? "Below Face Value" : "Face Value";
}

export function getEventType(title: string): EventTypeInfo {
  const lower = title.toLowerCase();

  if (lower.match(/raptors|basketball/)) return { type: "sports-basketball", label: "Sports: Basketball", placeholder: "/basketball-placeholder.jpg" };
  if (lower.match(/leafs|hockey/)) return { type: "sports-hockey", label: "Sports: Hockey", placeholder: "/hockey-placeholder.jpg" };
  if (lower.match(/blue jays|baseball/)) return { type: "sports-baseball", label: "Sports: Baseball", placeholder: "/sports-placeholder.jpg" };
  if (lower.match(/broncos|nfl|chiefs|packers|patriots|cowboys|steelers|raiders|49ers|seahawks|bills|dolphins|jets|giants|eagles|vikings|bengals|browns|ravens|chargers|rams|lions|falcons|panthers|saints|buccaneers|titans|colts|jaguars|texans|commanders|cardinals|bears/) || (lower.includes("football") && !lower.includes("hockey"))) return { type: "sports-football", label: "Sports: Football", placeholder: "/football-placeholder.jpg" };
  if (lower.includes("soccer")) return { type: "sports-soccer", label: "Sports: Soccer", placeholder: "/sports-placeholder.jpg" };
  if (lower.includes("lacrosse")) return { type: "sports-lacrosse", label: "Sports: Lacrosse", placeholder: "/sports-placeholder.jpg" };
  if (lower.match(/argos|argonauts/)) return { type: "sports-football", label: "Sports: Football", placeholder: "/football-placeholder.jpg" };
  if (lower.match(/tfc|toronto fc/)) return { type: "sports-soccer", label: "Sports: Soccer", placeholder: "/sports-placeholder.jpg" };
  if (lower.match(/sports|vs\.|game/)) return { type: "sports-other", label: "Sports: Other", placeholder: "/sports-placeholder.jpg" };

  if (lower.match(/taylor swift|drake|ice cube|ed sheeran|weeknd|concert|tour|live music/)) return { type: "concert", label: "Concert", placeholder: "/concert-placeholder.jpg" };
  if (lower.match(/hamilton|theatre|theater|broadway|play/)) return { type: "theatre", label: "Theatre", placeholder: "/theatre-placeholder.jpg" };
  if (lower.match(/comedy|stand.up|comedian|funny/)) return { type: "comedy", label: "Comedy", placeholder: "/comedy-placeholder.jpg" };
  if (lower.match(/conference|summit|convention/)) return { type: "conference", label: "Conference", placeholder: "/conference-placeholder.jpg" };
  if (lower.match(/festival|music fest|coachella/)) return { type: "festival", label: "Festival", placeholder: "/festival-placeholder.jpg" };
  if (lower.match(/gala|ball|charity dinner/)) return { type: "gala", label: "Gala", placeholder: "/gala-placeholder.jpg" };
  if (lower.match(/opera|symphony|orchestra/)) return { type: "opera", label: "Opera", placeholder: "/opera-placeholder.jpg" };
  if (lower.match(/workshop|seminar|class|training/)) return { type: "workshop", label: "Workshop", placeholder: "/workshop-placeholder.jpg" };

  return { type: "other", label: "Other", placeholder: "/default.jpg" };
}

const CITY_REGION: Record<string, { province: string; country: string }> = {
  toronto: { province: "ON", country: "Canada" },
  montréal: { province: "QC", country: "Canada" },
  montreal: { province: "QC", country: "Canada" },
  vancouver: { province: "BC", country: "Canada" },
  ottawa: { province: "ON", country: "Canada" },
  calgary: { province: "AB", country: "Canada" },
  edmonton: { province: "AB", country: "Canada" },
  newyork: { province: "NY", country: "USA" },
  "new york": { province: "NY", country: "USA" },
  chicago: { province: "IL", country: "USA" },
  losangeles: { province: "CA", country: "USA" },
  "los angeles": { province: "CA", country: "USA" },
  seattle: { province: "WA", country: "USA" },
  austin: { province: "TX", country: "USA" },
  "las vegas": { province: "NV", country: "USA" },
  miami: { province: "FL", country: "USA" },
  boston: { province: "MA", country: "USA" },
  "orchard park": { province: "NY", country: "USA" },
};

export function parseVenue(venue: string): { city: string; province: string; country: string } {
  const parts = venue.split(",").map((p) => p.trim()).filter(Boolean);
  const tail = parts.length >= 2 ? parts[parts.length - 1] : "";
  const key = tail.toLowerCase();
  const normalizedKey = normalizeCityKey(tail);

  const mapped = CITY_REGION[key] ?? CITY_REGION[normalizedKey];
  if (mapped) {
    return { city: tail, province: mapped.province, country: mapped.country };
  }

  // Handle tail formats like "Denver CO" / "Denver, CO" / "Toronto ON"
  const m = tail.match(/^(.*?)[\s,]+([A-Z]{2})$/);
  if (m) {
    const city = m[1].trim() || tail;
    const code = m[2].toUpperCase();

    const usStates = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","IA","ID","IL","IN","KS","KY","LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM","NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA","WI","WV","WY","DC"]);
    const caProvinces = new Set(["AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"]);

    if (usStates.has(code)) return { city, province: code, country: "USA" };
    if (caProvinces.has(code)) return { city, province: code, country: "Canada" };
  }

  // Last-resort inference from full venue string before defaulting.
  const v = (venue || "").toLowerCase();
  if (v.includes(" usa") || v.includes(" united states") || v.includes(" denver") || v.includes(" york") || v.includes(" angeles") || v.includes(" chicago") || v.includes("seattle")) {
    return { city: tail, province: "", country: "USA" };
  }

  return { city: tail, province: "", country: "" };
}

const US_REGION_CODES = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","IA","ID","IL","IN","KS","KY","LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM","NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA","WI","WV","WY","DC"]);
const CA_REGION_CODES = new Set(["AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"]);

function normalizeCountryLabel(country: string) {
  const upper = country.trim().toUpperCase();
  if (upper === "CA" || upper === "CAN") return "Canada";
  if (upper === "US" || upper === "USA") return "USA";
  return country.trim();
}

function inferCountryFromRegion(region: string) {
  const code = region.trim().toUpperCase();
  if (CA_REGION_CODES.has(code)) return "Canada";
  if (US_REGION_CODES.has(code)) return "USA";
  return "";
}

export function venueInfoFromLocation(
  venue: string,
  venueLocation?: ApiTicketLike["venueLocation"]
): { address: string | null; city: string; province: string; country: string } {
  const parsed = parseVenue(venue);
  const address = String(venueLocation?.address ?? "").trim();
  const city = String(venueLocation?.city ?? "").trim();
  const province = String(venueLocation?.region ?? "").trim();
  const country = String(venueLocation?.country ?? "").trim();

  return {
    address: address || null,
    city: city || parsed.city,
    province: province || parsed.province,
    country: (country && normalizeCountryLabel(country)) || inferCountryFromRegion(province) || parsed.country,
  };
}

const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  toronto: { lat: 43.6532, lon: -79.3832 },
  barrie: { lat: 44.3894, lon: -79.6903 },
  portcarling: { lat: 45.1177, lon: -79.5787 },
  hamilton: { lat: 43.2557, lon: -79.8711 },
  mississauga: { lat: 43.589, lon: -79.6441 },
  brampton: { lat: 43.7315, lon: -79.7624 },
  oshawa: { lat: 43.8971, lon: -78.8658 },
  kingston: { lat: 44.2312, lon: -76.486 },
  london: { lat: 42.9849, lon: -81.2453 },
  kitchener: { lat: 43.4516, lon: -80.4925 },
  guelph: { lat: 43.5448, lon: -80.2482 },
  windsor: { lat: 42.3149, lon: -83.0364 },
  sarnia: { lat: 42.9745, lon: -82.4066 },
  northbay: { lat: 46.3091, lon: -79.4608 },
  peterborough: { lat: 44.3091, lon: -78.3197 },
  saultstemarie: { lat: 46.5136, lon: -84.3358 },
  stcatharines: { lat: 43.1594, lon: -79.2469 },
  montreal: { lat: 45.5017, lon: -73.5673 },
  vancouver: { lat: 49.2827, lon: -123.1207 },
  ottawa: { lat: 45.4215, lon: -75.6972 },
  calgary: { lat: 51.0447, lon: -114.0719 },
  edmonton: { lat: 53.5461, lon: -113.4938 },
  newyork: { lat: 40.7128, lon: -74.006 },
  boston: { lat: 42.3601, lon: -71.0589 },
  buffalo: { lat: 42.8864, lon: -78.8784 },
  orchardpark: { lat: 42.7676, lon: -78.7439 },
  greenbay: { lat: 44.5133, lon: -88.0133 },
  rosemont: { lat: 41.9953, lon: -87.884 },
  southbend: { lat: 41.6764, lon: -86.252 },
  foxborough: { lat: 42.0654, lon: -71.2478 },
  eastrutherford: { lat: 40.8337, lon: -74.0971 },
  arlington: { lat: 32.7357, lon: -97.1081 },
  santaclara: { lat: 37.3541, lon: -121.9552 },
  inglewood: { lat: 33.9617, lon: -118.3531 },
  miami: { lat: 25.7617, lon: -80.1918 },
  chicago: { lat: 41.8781, lon: -87.6298 },
  losangeles: { lat: 34.0522, lon: -118.2437 },
};

export function normalizeCityKey(city: string): string {
  return (city || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]/g, "");
}

export function inferCoordsFromCity(city: string | null | undefined): { lat: number; lon: number } | null {
  const key = normalizeCityKey(city || "");
  return CITY_COORDS[key] ?? null;
}

export function inferCityCoordsFromVenue(venue: string): { lat: number; lon: number } | null {
  const s = (venue || "").toLowerCase();
  if (s.includes("toronto")) return CITY_COORDS.toronto;
  if (s.includes("montréal") || s.includes("montreal")) return CITY_COORDS.montreal;
  if (s.includes("vancouver")) return CITY_COORDS.vancouver;
  if (s.includes("ottawa")) return CITY_COORDS.ottawa;
  if (s.includes("calgary")) return CITY_COORDS.calgary;
  if (s.includes("edmonton")) return CITY_COORDS.edmonton;
  if (s.includes("new york")) return CITY_COORDS.newyork;
  if (s.includes("boston")) return CITY_COORDS.boston;
  if (s.includes("miami")) return CITY_COORDS.miami;
  if (s.includes("chicago")) return CITY_COORDS.chicago;
  if (s.includes("los angeles")) return CITY_COORDS.losangeles;
  return null;
}

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * (Math.PI / 180);
  const dLon = (b.lon - a.lon) * (Math.PI / 180);
  const lat1 = a.lat * (Math.PI / 180);
  const lat2 = b.lat * (Math.PI / 180);
  const x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

export function inferTicketCoords(
  ticket: Pick<TicketCardView, "city" | "venue"> & Partial<Pick<TicketCardView, "latitude" | "longitude">>
): { lat: number; lon: number } | null {
  if (
    typeof ticket.latitude === "number" &&
    Number.isFinite(ticket.latitude) &&
    typeof ticket.longitude === "number" &&
    Number.isFinite(ticket.longitude)
  ) {
    return { lat: ticket.latitude, lon: ticket.longitude };
  }
  return inferCoordsFromCity(ticket.city) ?? inferCityCoordsFromVenue(ticket.venue);
}

export function isTicketWithinRadius(
  ticket: Pick<TicketCardView, "city" | "venue"> & Partial<Pick<TicketCardView, "latitude" | "longitude">>,
  center: { lat: number; lon: number },
  radiusKm: number
): boolean {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return false;
  const ticketCoords = inferTicketCoords(ticket);
  if (!ticketCoords) return false;
  return haversineKm(center, ticketCoords) <= radiusKm;
}

function toIsoString(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function normalizeMatchText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parsePreferenceAliases(value: string | null | undefined): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
  } catch {
    // Legacy rows can store aliases as a delimited string.
  }

  return raw.split(/[|,;]/).map((item) => item.trim()).filter(Boolean);
}

function preferenceTerms(preference: FeaturedTicketPreference) {
  return [
    preference.value,
    preference.catalogEntity?.canonicalName,
    preference.catalogEntity?.subtitle,
    ...parsePreferenceAliases(preference.catalogEntity?.aliases),
  ]
    .map(normalizeMatchText)
    .filter((term) => term.length >= 2);
}

function containsTerm(haystack: string, terms: string[]) {
  if (!haystack) return false;
  return terms.some((term) => haystack === term || haystack.includes(term) || term.includes(haystack));
}

export function ticketEventKey(ticket: Pick<TicketCardView, "title" | "date" | "venue">) {
  return [ticket.title, ticket.date, ticket.venue].map(normalizeMatchText).join("|");
}

export function groupTicketsByEvent<T extends TicketCardView>(tickets: T[]): TicketEventGroup<T>[] {
  const groups = new Map<string, T[]>();

  for (const ticket of tickets) {
    const key = ticketEventKey(ticket);
    const existing = groups.get(key);
    if (existing) existing.push(ticket);
    else groups.set(key, [ticket]);
  }

  return Array.from(groups, ([key, eventTickets]) => ({
    key,
    tickets: [...eventTickets].sort((a, b) => a.price - b.price),
  }));
}

function daysUntil(date: string) {
  const time = Date.parse(date);
  if (Number.isNaN(time)) return Number.POSITIVE_INFINITY;
  return (time - Date.now()) / 86400000;
}

function daysSince(value: string | null | undefined) {
  const time = Date.parse(String(value || ""));
  if (Number.isNaN(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / 86400000;
}

export function scoreFeaturedTicket(
  ticket: TicketCardView,
  context: FeaturedTicketRankContext = {},
  seenEventCounts: Map<string, number> = new Map()
): { score: number; reasons: FeaturedTicketReason[] } {
  let score = 0;
  const reasons: FeaturedTicketReason[] = [];
  const addReason = (reason: FeaturedTicketReason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  const titleText = normalizeMatchText(ticket.title);
  const venueText = normalizeMatchText(ticket.venue);
  const cityText = normalizeMatchText(ticket.city);
  const locationText = normalizeMatchText([ticket.venue, ticket.venueAddress, ticket.city, ticket.province, ticket.country].filter(Boolean).join(" "));
  const eventText = normalizeMatchText([ticket.title, ticket.eventType, ticket.eventTypeLabel].join(" "));
  const preferences = (context.preferences ?? []).filter((preference) => String(preference.status ?? "ACTIVE").toUpperCase() === "ACTIVE");

  for (const preference of preferences) {
    const terms = preferenceTerms(preference);
    if (!terms.length) continue;
    const type = String(preference.type || "").toUpperCase();

    if ((type === "ARTIST" || type === "TEAM" || type === "SHOW") && containsTerm(titleText, terms)) {
      score += 40;
      addReason("Matches your favorites");
    } else if (type === "VENUE" && containsTerm(venueText, terms)) {
      score += 40;
      addReason("Venue you follow");
    } else if (type === "CITY" && (containsTerm(cityText, terms) || containsTerm(locationText, terms))) {
      score += 40;
      addReason("In your saved cities");
    } else if ((type === "SPORT" || type === "EVENT_TYPE") && containsTerm(eventText, terms)) {
      score += 34;
      addReason("Matches your favorites");
    }
  }

  const ticketCoords = inferTicketCoords(ticket);
  if (context.userCoords && ticketCoords) {
    const distanceKm = haversineKm(context.userCoords, ticketCoords);
    if (context.notificationRadiusKm && distanceKm <= context.notificationRadiusKm) {
      score += 30;
      addReason("Near you");
    } else if (distanceKm <= 80) {
      score += 18;
      addReason("Near you");
    } else if (distanceKm <= 250) {
      score += 10;
      addReason("Near you");
    }
  }

  if (ticket.priceTag === "Below Face Value") {
    score += 20;
    addReason("Below face value");
  }

  if (!ticket.isPriceUnconfirmed && !ticket.isValidationMismatch && !ticket.isAboveConfirmedFaceValue) {
    score += 15;
    addReason("Verified ticket");
  } else if (ticket.isValidationMismatch || ticket.isAboveConfirmedFaceValue || ticket.isPastEvent) {
    score -= 50;
  }

  if (ticket.section || ticket.row || ticket.seat) score += 5;
  if (ticket.image && ticket.image !== DEFAULT_IMAGE) score += 4;
  if (ticket.rating >= 4.5 && ticket.reviews > 0) score += 6;

  const listedDaysAgo = daysSince(ticket.createdAt);
  if (listedDaysAgo <= 3) {
    score += 10;
    addReason("New listing");
  } else if (listedDaysAgo <= 14) {
    score += 5;
  }

  const eventDays = daysUntil(ticket.date);
  if (eventDays >= 1 && eventDays <= 21) {
    score += eventDays <= 7 ? 12 : 8;
    addReason("Coming soon");
  } else if (eventDays < 0) {
    score -= 50;
  }

  const duplicateCount = seenEventCounts.get(ticketEventKey(ticket)) ?? 0;
  if (duplicateCount > 0) score -= Math.min(35, duplicateCount * 18);

  if (ticket.isSoldOut) score += 3;

  if (!reasons.length) {
    if (ticket.priceTag === "Below Face Value") addReason("Below face value");
    else if (!ticket.isPriceUnconfirmed && !ticket.isValidationMismatch && !ticket.isAboveConfirmedFaceValue) addReason("Verified ticket");
  }

  return { score, reasons: reasons.slice(0, 3) };
}

export function rankFeaturedTickets<T extends TicketCardView>(
  tickets: T[],
  context: FeaturedTicketRankContext = {}
): RankedFeaturedTicket<T>[] {
  const seenEventCounts = new Map<string, number>();

  return tickets
    .map((ticket) => {
      const eventKey = ticketEventKey(ticket);
      const ranked = scoreFeaturedTicket(ticket, context, seenEventCounts);
      seenEventCounts.set(eventKey, (seenEventCounts.get(eventKey) ?? 0) + 1);

      return {
        ...ticket,
        featuredScore: ranked.score,
        featuredReasons: ranked.reasons,
      };
    })
    .sort((a, b) => {
      if (b.featuredScore !== a.featuredScore) return b.featuredScore - a.featuredScore;

      const ta = Number.isNaN(Date.parse(a.date)) ? Number.POSITIVE_INFINITY : Date.parse(a.date);
      const tb = Number.isNaN(Date.parse(b.date)) ? Number.POSITIVE_INFINITY : Date.parse(b.date);
      if (ta !== tb) return ta - tb;

      return 0;
    })
}

function eventTypeFromType(type: string | null | undefined, fallbackTitle: string): EventTypeInfo {
  const normalized = String(type || "").trim().toLowerCase();
  if (!normalized) return getEventType(fallbackTitle);
  const map: Record<string, EventTypeInfo> = {
    "sports-basketball": { type: "sports-basketball", label: "Sports: Basketball", placeholder: "/basketball-placeholder.jpg" },
    "sports-hockey": { type: "sports-hockey", label: "Sports: Hockey", placeholder: "/hockey-placeholder.jpg" },
    "sports-baseball": { type: "sports-baseball", label: "Sports: Baseball", placeholder: "/sports-placeholder.jpg" },
    "sports-football": { type: "sports-football", label: "Sports: Football", placeholder: "/football-placeholder.jpg" },
    "sports-soccer": { type: "sports-soccer", label: "Sports: Soccer", placeholder: "/sports-placeholder.jpg" },
    "sports-lacrosse": { type: "sports-lacrosse", label: "Sports: Lacrosse", placeholder: "/sports-placeholder.jpg" },
    "sports-other": { type: "sports-other", label: "Sports: Other", placeholder: "/sports-placeholder.jpg" },
    concert: { type: "concert", label: "Concert", placeholder: "/concert-placeholder.jpg" },
    theatre: { type: "theatre", label: "Theatre", placeholder: "/theatre-placeholder.jpg" },
    comedy: { type: "comedy", label: "Comedy", placeholder: "/comedy-placeholder.jpg" },
    conference: { type: "conference", label: "Conference", placeholder: "/conference-placeholder.jpg" },
    festival: { type: "festival", label: "Festival", placeholder: "/festival-placeholder.jpg" },
    gala: { type: "gala", label: "Gala", placeholder: "/gala-placeholder.jpg" },
    opera: { type: "opera", label: "Opera", placeholder: "/opera-placeholder.jpg" },
    workshop: { type: "workshop", label: "Workshop", placeholder: "/workshop-placeholder.jpg" },
    other: { type: "other", label: "Other", placeholder: "/default.jpg" },
  };
  return map[normalized] ?? getEventType(fallbackTitle);
}

export function mapApiTicketToCard(t: ApiTicketLike): TicketCardView {
  const venueInfo = venueInfoFromLocation(t.venue || "", t.venueLocation ?? null);
  const eventTypeInfo = eventTypeFromType(t.eventTypeOverride ?? null, t.title || "");
  const isSoldOut = t.event?.selloutStatus === "SOLD_OUT";
  const price = Number(t.price ?? (typeof t.priceCents === 'number' ? t.priceCents / 100 : 0));
  const currency = normalizeCurrency(t.currency);
  const faceValue = t.faceValue ?? (typeof t.faceValueCents === 'number' ? t.faceValueCents / 100 : null);
  const confirmedMaxListPrice =
    typeof t.confirmedMaxListPriceCents === "number" ? t.confirmedMaxListPriceCents / 100 : null;

  const isPastEvent = isTicketEventExpired({
    date: t.date,
    venue: t.venue,
    city: venueInfo.city,
    province: venueInfo.province,
    country: venueInfo.country,
  });

  return {
    id: t.id,
    title: t.title,
    date: t.date,
    venue: t.venue,
    venueAddress: venueInfo.address,
    city: venueInfo.city,
    province: venueInfo.province,
    country: venueInfo.country,
    latitude:
      typeof t.venueLocation?.latitude === "number" && Number.isFinite(t.venueLocation.latitude)
        ? t.venueLocation.latitude
        : null,
    longitude:
      typeof t.venueLocation?.longitude === "number" && Number.isFinite(t.venueLocation.longitude)
        ? t.venueLocation.longitude
        : null,
    section: t.section ?? null,
    row: t.row ?? null,
    seat: t.seat ?? null,
    price,
    currency,
    faceValue: faceValue ?? null,
    confirmedMaxListPriceCents: typeof t.confirmedMaxListPriceCents === "number" ? t.confirmedMaxListPriceCents : null,
    image: resolveTicketImageSrc(t.image),
    sellerId: t.sellerId || "",
    badges: t.seller?.badges ?? [],
    rating: t.seller?.rating ?? 0,
    reviews: t.seller?.reviews ?? 0,
    priceTag: computePriceTag(price, faceValue ?? null, isSoldOut, confirmedMaxListPrice),
    eventType: eventTypeInfo.type,
    eventTypeLabel: eventTypeInfo.label,
    isSoldOut,
    placeholderImage: eventTypeInfo.placeholder,
    isAboveConfirmedFaceValue: Boolean(t.isAboveConfirmedFaceValue),
    isPastEvent,
    isValidationMismatch: Boolean(t.isValidationMismatch) || isPastEvent,
    isPriceUnconfirmed: Boolean(t.isPriceUnconfirmed),
    createdAt: toIsoString(t.createdAt),
    updatedAt: toIsoString(t.updatedAt),
    verifiedAt: toIsoString(t.verifiedAt),
  };
}

export function sortTicketsByPriority<
  T extends Pick<TicketCardView, 'venue' | 'city' | 'latitude' | 'longitude' | 'isSoldOut' | 'date'>
>(
  tickets: T[],
  userCoords: { lat: number; lon: number } | null
): T[] {
  const arr = [...tickets];
  arr.sort((a, b) => {
    const aCoords = inferTicketCoords(a);
    const bCoords = inferTicketCoords(b);

    const da = userCoords && aCoords ? haversineKm(userCoords, aCoords) : Number.POSITIVE_INFINITY;
    const db = userCoords && bCoords ? haversineKm(userCoords, bCoords) : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;

    if (a.isSoldOut !== b.isSoldOut) return a.isSoldOut ? -1 : 1;

    const ta = Number.isNaN(Date.parse(a.date)) ? Number.POSITIVE_INFINITY : Date.parse(a.date);
    const tb = Number.isNaN(Date.parse(b.date)) ? Number.POSITIVE_INFINITY : Date.parse(b.date);
    return ta - tb;
  });
  return arr;
}
