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
  soldOut: boolean | null;
  sourceUrl: string | null;
  reason?: string;
  officialEventTitle?: string | null;
  officialEventDate?: string | null;
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
  if (parts.length >= 3) return parts[parts.length - 2];
  return parts.length >= 2 ? parts[parts.length - 1] : "";
}

function venueName(venue: string): string {
  const parts = (venue || "").split(",").map(p => p.trim()).filter(Boolean);
  return parts[0] ?? "";
}

function toYmd(input: string | null | undefined): string | null {
  if (!input) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function tokenize(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !new Set(["the", "and", "vs", "at", "live", "event", "tickets", "pass", "day", "weekend", "conference"]).has(t));
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
    const hasDate = !!(ymd && text.includes(ymd));
    const hasCity = !city || text.toLowerCase().includes(city);
    const hasVenue = !requestedVenueName || overlap(requestedVenueName, text) >= 0.6;

    if (score >= 0.6 && hasDate && hasCity && hasVenue) {
      return {
        found: true,
        vendor: "primary-web",
        officialFaceValueCents: null,
        soldOut: null,
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
      officialVenueName: best.tmVenueName || null,
    };
  }

  const ev = best.ev;

  const min = typeof ev?.priceRanges?.[0]?.min === "number" ? ev.priceRanges[0].min : null;
  const max = typeof ev?.priceRanges?.[0]?.max === "number" ? ev.priceRanges[0].max : null;
  // conservative face value estimate for primary market: max advertised face range if available, else min.
  const face = max ?? min;

  const soldOut = (ev?.dates?.status?.code || "").toLowerCase() === "offsale";

  return {
    found: true,
    vendor: "ticketmaster",
    officialFaceValueCents: face == null ? null : Math.round(Number(face) * 100),
    soldOut,
    sourceUrl: ev?.url ?? null,
    officialEventTitle: String(ev?.name || "") || null,
    officialEventDate: toYmd(ev?.dates?.start?.dateTime || ev?.dates?.start?.localDate || null),
    officialVenueName: best.tmVenueName || null,
  };
}
