export type EventTypeInfo = { type: string; label: string; placeholder: string };

export type ApiTicketLike = {
  id: string;
  title: string;
  date: string;
  venue: string;
  row?: string | null;
  seat?: string | null;
  price?: number;
  priceCents?: number;
  faceValue?: number | null;
  faceValueCents?: number | null;
  status?: string;
  image?: string;
  sellerId?: string;
  seller?: {
    badges?: string[];
    rating?: number;
    reviews?: number;
  } | null;
  event?: {
    selloutStatus?: "SOLD_OUT" | "NOT_SOLD_OUT" | string;
  } | null;
};

export type TicketCardView = {
  id: string;
  title: string;
  date: string;
  venue: string;
  city: string;
  province: string;
  country: string;
  row: string | null;
  seat: string | null;
  price: number;
  faceValue: number | null;
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

export function computePriceTag(price: number, faceValue: number | null, isSoldOut = false): "Face Value" | "Below Face Value" {
  if (isSoldOut) return "Face Value";
  if (faceValue == null) return "Face Value";
  return price < faceValue ? "Below Face Value" : "Face Value";
}

export function getEventType(title: string): EventTypeInfo {
  const lower = title.toLowerCase();

  if (lower.match(/raptors|basketball/)) return { type: "sports-basketball", label: "Sports: Basketball", placeholder: "/basketball-placeholder.jpg" };
  if (lower.match(/leafs|hockey/)) return { type: "sports-hockey", label: "Sports: Hockey", placeholder: "/hockey-placeholder.jpg" };
  if (lower.match(/blue jays|baseball/)) return { type: "sports-baseball", label: "Sports: Baseball", placeholder: "/sports-placeholder.jpg" };
  if (lower.includes("football") && !lower.includes("hockey")) return { type: "sports-football", label: "Sports: Football", placeholder: "/football-placeholder.jpg" };
  if (lower.includes("soccer")) return { type: "sports-soccer", label: "Sports: Soccer", placeholder: "/sports-placeholder.jpg" };
  if (lower.includes("lacrosse")) return { type: "sports-lacrosse", label: "Sports: Lacrosse", placeholder: "/sports-placeholder.jpg" };
  if (lower.match(/argos|argonauts/)) return { type: "sports-football", label: "Sports: Football", placeholder: "/football-placeholder.jpg" };
  if (lower.match(/tfc|toronto fc/)) return { type: "sports-soccer", label: "Sports: Soccer", placeholder: "/sports-placeholder.jpg" };
  if (lower.match(/sports|vs\.|game/)) return { type: "sports-other", label: "Sports: Other", placeholder: "/sports-placeholder.jpg" };

  if (lower.match(/taylor swift|drake|ed sheeran|weeknd|concert|tour|live music/)) return { type: "concert", label: "Concert", placeholder: "/concert-placeholder.jpg" };
  if (lower.match(/hamilton|theatre|theater|broadway|play/)) return { type: "theatre", label: "Theatre", placeholder: "/theatre-placeholder.jpg" };
  if (lower.match(/comedy|stand.up|comedian|funny/)) return { type: "comedy", label: "Comedy", placeholder: "/comedy-placeholder.jpg" };
  if (lower.match(/conference|summit|convention/)) return { type: "conference", label: "Conference", placeholder: "/conference-placeholder.jpg" };
  if (lower.match(/festival|music fest|coachella/)) return { type: "festival", label: "Festival", placeholder: "/festival-placeholder.jpg" };
  if (lower.match(/gala|ball|charity dinner/)) return { type: "gala", label: "Gala", placeholder: "/gala-placeholder.jpg" };
  if (lower.match(/opera|symphony|orchestra/)) return { type: "opera", label: "Opera", placeholder: "/opera-placeholder.jpg" };
  if (lower.match(/workshop|seminar|class|training/)) return { type: "workshop", label: "Workshop", placeholder: "/workshop-placeholder.jpg" };

  return { type: "other", label: "Other", placeholder: "/default.jpg" };
}

export function parseVenue(venue: string): { city: string; province: string; country: string } {
  const parts = venue.split(",").map((p) => p.trim());
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    const cityPart = parts[parts.length - 2];
    if (lastPart === "Toronto") {
      return { city: "Toronto", province: "ON", country: "Canada" };
    }
    return { city: cityPart || "Toronto", province: "ON", country: "Canada" };
  }
  return { city: "Toronto", province: "ON", country: "Canada" };
}

const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  toronto: { lat: 43.6532, lon: -79.3832 },
  montreal: { lat: 45.5017, lon: -73.5673 },
  vancouver: { lat: 49.2827, lon: -123.1207 },
  ottawa: { lat: 45.4215, lon: -75.6972 },
  calgary: { lat: 51.0447, lon: -114.0719 },
  edmonton: { lat: 53.5461, lon: -113.4938 },
  newyork: { lat: 40.7128, lon: -74.006 },
  boston: { lat: 42.3601, lon: -71.0589 },
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

export function mapApiTicketToCard(t: ApiTicketLike): TicketCardView {
  const venueInfo = parseVenue(t.venue || "");
  const eventTypeInfo = getEventType(t.title || "");
  const isSoldOut = t.event?.selloutStatus === "SOLD_OUT";
  const price = Number(t.price ?? (typeof t.priceCents === 'number' ? t.priceCents / 100 : 0));
  const faceValue = t.faceValue ?? (typeof t.faceValueCents === 'number' ? t.faceValueCents / 100 : null);

  return {
    id: t.id,
    title: t.title,
    date: t.date,
    venue: t.venue,
    city: venueInfo.city,
    province: venueInfo.province,
    country: venueInfo.country,
    row: t.row ?? null,
    seat: t.seat ?? null,
    price,
    faceValue: faceValue ?? null,
    image: resolveTicketImageSrc(t.image),
    sellerId: t.sellerId || "",
    badges: t.seller?.badges ?? [],
    rating: t.seller?.rating ?? 0,
    reviews: t.seller?.reviews ?? 0,
    priceTag: computePriceTag(price, faceValue ?? null, isSoldOut),
    eventType: eventTypeInfo.type,
    eventTypeLabel: eventTypeInfo.label,
    isSoldOut,
    placeholderImage: eventTypeInfo.placeholder,
  };
}

export function sortTicketsByPriority<T extends Pick<TicketCardView, 'venue' | 'city' | 'isSoldOut' | 'date'>>(
  tickets: T[],
  userCoords: { lat: number; lon: number } | null
): T[] {
  const arr = [...tickets];
  arr.sort((a, b) => {
    const aCoords = inferCoordsFromCity(a.city) ?? inferCityCoordsFromVenue(a.venue);
    const bCoords = inferCoordsFromCity(b.city) ?? inferCityCoordsFromVenue(b.venue);

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
