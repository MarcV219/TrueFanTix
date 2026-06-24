type TicketLike = {
  title: string;
  date: string;
  venue: string;
  primaryVendor?: string | null;
};

let _lastTicketmasterCallAt = 0;

export type OfficialSnapshot = {
  found: boolean;
  vendor: "ticketmaster" | "primary-web" | "none";
  officialFaceValueCents: number | null;
  officialPriceRangeMinCents?: number | null;
  officialPriceRangeMaxCents?: number | null;
  officialServiceFeesCents?: number | null;
  officialServiceFeeSource?: string | null;
  officialStatusCode?: string | null;
  soldOut: boolean | null;
  soldOutSource?: string | null;
  sourceUrl: string | null;
  reason?: string;
  officialEventTitle?: string | null;
  officialEventDate?: string | null;
  officialEventTime?: string | null;
  officialVenueName?: string | null;
};

function normalizeTitle(title: string): string {
  return (title || "")
    .replace(/\s*\(Alt\s*\d+\)\s*$/i, "")
    .replace(/\s*[-–—]\s*(Day\s*\d+|Day\s*Pass|Weekend\s*\d+|Weekend\s*Pass|Conference\s*Pass|Headliner|Headliner\s*Night|Showcase).*$/i, "")
    .trim();
}

function venueCity(venue: string): string {
  const parts = (venue || "").split(",").map(p => p.trim()).filter(Boolean);
  if (parts.length === 2) {
    const hyphenParts = parts[0].split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
    if (hyphenParts.length >= 2) return hyphenParts[hyphenParts.length - 1];
  }
  if (parts.length >= 3) return parts[parts.length - 2];
  return parts.length >= 2 ? parts[parts.length - 1] : "";
}

function venueName(venue: string): string {
  const parts = (venue || "").split(",").map(p => p.trim()).filter(Boolean);
  const first = parts[0] ?? "";
  return first.split(/\s+-\s+/)[0]?.trim() || first;
}

function toYmd(input: string | null | undefined): string | null {
  if (!input) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function officialEventTime(ev: any): string | null {
  const localTime = String(ev?.dates?.start?.localTime || "").trim();
  if (localTime) {
    const match = localTime.match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      let hour = Number(match[1]);
      const minute = match[2];
      const period = hour >= 12 ? "PM" : "AM";
      hour = hour % 12 || 12;
      return `${hour}:${minute} ${period}`;
    }
  }

  const dateTime = String(ev?.dates?.start?.dateTime || "").trim();
  if (!dateTime) return null;
  const d = new Date(dateTime);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: String(ev?._embedded?.venues?.[0]?.timezone || "UTC"),
  });
}

function priceRangeType(range: any): string {
  return [
    range?.type,
    range?.name,
    range?.priceType,
    range?.ticketType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isResalePriceRange(range: any) {
  return /\b(resale|verified resale|fan-to-fan|secondary)\b/i.test(priceRangeType(range));
}

function usablePriceRanges(ev: any) {
  const ranges = Array.isArray(ev?.priceRanges) ? ev.priceRanges : [];
  const primaryRanges = ranges.filter((range: any) => !isResalePriceRange(range));
  const resaleRanges = ranges.filter(isResalePriceRange);
  const sourceRanges = primaryRanges.length ? primaryRanges : ranges.length && !resaleRanges.length ? ranges : [];

  const mins = sourceRanges
    .map((range: any) => typeof range?.min === "number" ? range.min : null)
    .filter((value: number | null): value is number => value != null);
  const maxes = sourceRanges
    .map((range: any) => typeof range?.max === "number" ? range.max : null)
    .filter((value: number | null): value is number => value != null);

  const min = mins.length ? Math.min(...mins) : null;
  const max = maxes.length ? Math.max(...maxes) : null;

  return {
    min,
    max,
    primaryCount: primaryRanges.length,
    resaleCount: resaleRanges.length,
    totalCount: ranges.length,
  };
}

function soldOutSignal(ev: any, statusCode: string | null, priceRanges: ReturnType<typeof usablePriceRanges>) {
  if (statusCode === "offsale") {
    return { soldOut: true, source: "ticketmaster-event-status" };
  }

  if (priceRanges.resaleCount > 0 && priceRanges.primaryCount === 0) {
    return { soldOut: true, source: "ticketmaster-resale-only" };
  }

  if (statusCode) {
    return { soldOut: false, source: "ticketmaster-event-status" };
  }

  return { soldOut: null as boolean | null, source: null as string | null };
}

function tokenize(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !new Set(["the", "and", "vs", "at", "live", "event", "tickets", "pass", "day", "weekend", "conference"]).has(t));
}

function dateSearchTokens(input: string | null | undefined): string[] {
  const ymd = toYmd(input);
  if (!ymd) return [];
  const [year, month, day] = ymd.split("-");
  const d = new Date(`${ymd}T00:00:00Z`);
  const monthShort = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const monthLong = d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const dayNumber = String(Number(day));
  return [
    ymd,
    `${Number(month)}/${dayNumber}/${year}`,
    `${monthShort} ${dayNumber}, ${year}`,
    `${monthLong} ${dayNumber}, ${year}`,
    `${monthShort}${dayNumber}`,
  ].map((token) => token.toLowerCase());
}

function textHasDate(text: string, input: string | null | undefined): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  const tokens = dateSearchTokens(input);
  return tokens.length > 0 && tokens.some((token) => normalized.includes(token));
}

function overlap(a: string, b: string): number {
  const aa = Array.from(new Set(tokenize(a)));
  const bb = new Set(tokenize(b));
  if (!aa.length) return 0;
  let hits = 0;
  for (const t of aa) if (bb.has(t)) hits += 1;
  return hits / aa.length;
}

function extractVsTeams(title: string): [string, string] | null {
  const m = title.match(/(.+?)\s+vs\s+(.+)/i);
  if (!m) return null;
  return [m[1].trim(), m[2].trim()];
}

function hostFromUrl(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function trustedPrimaryDomain(u: string): boolean {
  const h = hostFromUrl(u);
  const allow = [
    "ticketmaster.",
    "livenation.",
    "axs.",
    "broadwaydirect.",
    "telecharge.",
    "seatgeek.com/mls", // team/venue official surfaces only
    "mlb.com",
    "nba.com",
    "nfl.com",
    "nhl.com",
  ];
  return allow.some((d) => h.includes(d));
}

async function fallbackPrimaryWebConfirm(ticket: TicketLike): Promise<OfficialSnapshot | null> {
  const brave = process.env.BRAVE_API_KEY;
  if (!brave) return null;

  const q = `${normalizeTitle(ticket.title)} ${ticket.date} ${ticket.venue} official tickets`;
  const sp = new URLSearchParams({ q, count: "10", country: "US", search_lang: "en" });
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${sp.toString()}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": brave },
    cache: "no-store",
  });
  if (!res.ok) return null;

  const data: any = await res.json();
  const results: any[] = data?.web?.results ?? [];
  const ymd = toYmd(ticket.date);
  const city = venueCity(ticket.venue).toLowerCase();
  const requestedVenueName = venueName(ticket.venue);

  for (const r of results) {
    const url = String(r?.url || "");
    if (!trustedPrimaryDomain(url)) continue;

    const text = `${r?.title || ""} ${r?.description || ""} ${url}`;
    const score = overlap(normalizeTitle(ticket.title), text);
    const hasDate = textHasDate(text, ymd);
    const hasCity = !city || text.toLowerCase().includes(city);
    const hasVenue = !requestedVenueName || overlap(requestedVenueName, text) >= 0.6;

    if (score >= 0.6 && hasDate && hasCity && hasVenue) {
      return {
        found: true,
        vendor: "primary-web",
        officialFaceValueCents: null,
        officialPriceRangeMinCents: null,
        officialPriceRangeMaxCents: null,
        officialServiceFeesCents: null,
        officialServiceFeeSource: null,
        officialStatusCode: null,
        soldOut: null,
        soldOutSource: null,
        sourceUrl: url,
        reason: "confirmed-primary-web-fallback",
      };
    }
  }

  return null;
}

export async function fetchOfficialSnapshot(ticket: TicketLike): Promise<OfficialSnapshot> {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) {
    return { found: false, vendor: "none", officialFaceValueCents: null, soldOut: null, sourceUrl: null, reason: "missing-ticketmaster-key" };
  }

  // Respect Ticketmaster default limit (5 req/s) by spacing calls to <=4 req/s.
  const minGapMs = 260;
  const now = Date.now();
  const waitMs = Math.max(0, minGapMs - (now - _lastTicketmasterCallAt));
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  _lastTicketmasterCallAt = Date.now();

  const normalizedTitle = normalizeTitle(ticket.title);
  const query = normalizedTitle;
  const city = venueCity(ticket.venue);
  const requestedVenueName = venueName(ticket.venue);

  // Never treat TBD-opponent games as confirmed event matches for testing.
  if (/\b(vs|v)\s*tbd\b/i.test(normalizedTitle)) {
    return {
      found: false,
      vendor: "ticketmaster",
      officialFaceValueCents: null,
      soldOut: null,
      sourceUrl: null,
      reason: "opponent-tbd-unconfirmed",
    };
  }
  // NOTE: Ticketmaster rejects some date param combinations with DIS1015.
  // Keep API query broad and enforce strict date matching locally below.
  const sp = new URLSearchParams({
    apikey: key,
    keyword: query,
    size: "20",
    sort: "date,asc",
  });

  if (city) sp.set("city", city);

  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${sp.toString()}`;

  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, { cache: "no-store" });
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }

  if (!res) {
    return { found: false, vendor: "none", officialFaceValueCents: null, soldOut: null, sourceUrl: null, reason: "ticketmaster-no-response" };
  }

  if (!res.ok) {
    let detail = "";
    try {
      const txt = await res.text();
      detail = txt ? `:${txt.slice(0, 120).replace(/\s+/g, " ")}` : "";
    } catch {
      detail = "";
    }
    return { found: false, vendor: "none", officialFaceValueCents: null, soldOut: null, sourceUrl: null, reason: `ticketmaster-http-${res.status}${detail}` };
  }

  const data: any = await res.json();
  const events: any[] = data?._embedded?.events ?? [];
  if (!events.length) {
    const fb = await fallbackPrimaryWebConfirm(ticket);
    if (fb) return fb;
    return { found: false, vendor: "ticketmaster", officialFaceValueCents: null, soldOut: null, sourceUrl: null, reason: "no-event-match" };
  }

  const targetYmd = toYmd(ticket.date);
  const vsTeams = extractVsTeams(ticket.title);

  // Strict match selection to avoid false confirmations.
  const scored = events
    .map((ev: any) => {
      const evName = String(ev?.name || "");
      const evYmd = toYmd(ev?.dates?.start?.dateTime || ev?.dates?.start?.localDate || null);
      const dateMatch = !!targetYmd && !!evYmd && targetYmd === evYmd;
      const textScore = overlap(normalizeTitle(ticket.title), evName);
      const tmVenueName = String(ev?._embedded?.venues?.[0]?.name || "");

      let teamsMatch = true;
      if (vsTeams) {
        const [a, b] = vsTeams;
        const l = evName.toLowerCase();
        teamsMatch = overlap(a, evName) >= 0.5 && overlap(b, evName) >= 0.5 && l.includes(" vs ");
      }

      const cityOk = !city || String(ev?._embedded?.venues?.[0]?.city?.name || "").toLowerCase().includes(city.toLowerCase());
      const venueOk =
        !requestedVenueName ||
        overlap(requestedVenueName, tmVenueName) >= 0.6 ||
        overlap(tmVenueName, requestedVenueName) >= 0.6;

      return { ev, dateMatch, textScore, teamsMatch, cityOk, venueOk, tmVenueName };
    })
    .filter((x: any) => x.cityOk)
    .sort((a: any, b: any) => {
      if (a.dateMatch !== b.dateMatch) return a.dateMatch ? -1 : 1;
      return b.textScore - a.textScore;
    });

  const best = scored[0];
  if (!best) {
    const fb = await fallbackPrimaryWebConfirm(ticket);
    if (fb) return fb;
    return { found: false, vendor: "ticketmaster", officialFaceValueCents: null, soldOut: null, sourceUrl: null, reason: "no-city-match" };
  }

  if (!best.dateMatch) {
    const fb = await fallbackPrimaryWebConfirm(ticket);
    if (fb) return fb;
    return {
      found: false,
      vendor: "ticketmaster",
      officialFaceValueCents: null,
      soldOut: null,
      sourceUrl: best.ev?.url ?? null,
      reason: "date-not-confirmed",
      officialEventTitle: String(best.ev?.name || "") || null,
      officialEventDate: toYmd(best.ev?.dates?.start?.dateTime || best.ev?.dates?.start?.localDate || null),
      officialEventTime: officialEventTime(best.ev),
      officialVenueName: best.tmVenueName || null,
    };
  }

  if (!best.venueOk) {
    return {
      found: false,
      vendor: "ticketmaster",
      officialFaceValueCents: null,
      soldOut: null,
      sourceUrl: best.ev?.url ?? null,
      reason: "venue-not-confirmed",
      officialEventTitle: String(best.ev?.name || "") || null,
      officialEventDate: toYmd(best.ev?.dates?.start?.dateTime || best.ev?.dates?.start?.localDate || null),
      officialEventTime: officialEventTime(best.ev),
      officialVenueName: best.tmVenueName || null,
    };
  }

  if (best.textScore < 0.55) {
    const fb = await fallbackPrimaryWebConfirm(ticket);
    if (fb) return fb;
    return {
      found: false,
      vendor: "ticketmaster",
      officialFaceValueCents: null,
      soldOut: null,
      sourceUrl: best.ev?.url ?? null,
      reason: "title-not-confirmed",
      officialEventTitle: String(best.ev?.name || "") || null,
      officialEventDate: toYmd(best.ev?.dates?.start?.dateTime || best.ev?.dates?.start?.localDate || null),
      officialEventTime: officialEventTime(best.ev),
      officialVenueName: best.tmVenueName || null,
    };
  }

  if (!best.teamsMatch) {
    const fb = await fallbackPrimaryWebConfirm(ticket);
    if (fb) return fb;
    return {
      found: false,
      vendor: "ticketmaster",
      officialFaceValueCents: null,
      soldOut: null,
      sourceUrl: best.ev?.url ?? null,
      reason: "teams-not-confirmed",
      officialEventTitle: String(best.ev?.name || "") || null,
      officialEventDate: toYmd(best.ev?.dates?.start?.dateTime || best.ev?.dates?.start?.localDate || null),
      officialEventTime: officialEventTime(best.ev),
      officialVenueName: best.tmVenueName || null,
    };
  }

  const ev = best.ev;

  const ranges = usablePriceRanges(ev);
  const min = ranges.min;
  const max = ranges.max;
  const minCents = min == null ? null : Math.round(Number(min) * 100);
  const maxCents = max == null ? null : Math.round(Number(max) * 100);
  // Conservative original fair value estimate: use primary/standard range only, never resale-only pricing.
  const face = max ?? min;

  const statusCode = String(ev?.dates?.status?.code || "").toLowerCase() || null;
  const sellout = soldOutSignal(ev, statusCode, ranges);

  return {
    found: true,
    vendor: "ticketmaster",
    officialFaceValueCents: face == null ? null : Math.round(Number(face) * 100),
    officialPriceRangeMinCents: minCents,
    officialPriceRangeMaxCents: maxCents,
    officialServiceFeesCents: null,
    officialServiceFeeSource: null,
    officialStatusCode: statusCode,
    soldOut: sellout.soldOut,
    soldOutSource: sellout.source,
    sourceUrl: ev?.url ?? null,
    officialEventTitle: String(ev?.name || "") || null,
    officialEventDate: toYmd(ev?.dates?.start?.dateTime || ev?.dates?.start?.localDate || null),
    officialEventTime: officialEventTime(ev),
    officialVenueName: best.tmVenueName || null,
  };
}
