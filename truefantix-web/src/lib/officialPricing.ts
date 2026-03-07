type TicketLike = {
  title: string;
  date: string;
  venue: string;
  primaryVendor?: string | null;
};

export type OfficialSnapshot = {
  found: boolean;
  vendor: "ticketmaster" | "none";
  officialFaceValueCents: number | null;
  soldOut: boolean | null;
  sourceUrl: string | null;
  reason?: string;
};

function normalizeTitle(title: string): string {
  return (title || "")
    .replace(/\s*\(Alt\s*\d+\)\s*$/i, "")
    .replace(/\s*[-–—]\s*(Day\s*\d+|Day\s*Pass|Weekend\s*\d+|Weekend\s*Pass|Conference\s*Pass|Headliner|Headliner\s*Night|Showcase).*$/i, "")
    .trim();
}

function venueCity(venue: string): string {
  const parts = (venue || "").split(",").map(p => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1] : "";
}

function dateWindow(dateStr: string): { startISO: string; endISO: string } | null {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;

  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59));
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

export async function fetchOfficialSnapshot(ticket: TicketLike): Promise<OfficialSnapshot> {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) {
    return { found: false, vendor: "none", officialFaceValueCents: null, soldOut: null, sourceUrl: null, reason: "missing-ticketmaster-key" };
  }

  const query = normalizeTitle(ticket.title);
  const city = venueCity(ticket.venue);
  const window = dateWindow(ticket.date);

  const sp = new URLSearchParams({
    apikey: key,
    keyword: query,
    size: "10",
    sort: "date,asc",
  });

  if (city) sp.set("city", city);
  if (window) {
    sp.set("startDateTime", window.startISO);
    sp.set("endDateTime", window.endISO);
  }

  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${sp.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    return { found: false, vendor: "none", officialFaceValueCents: null, soldOut: null, sourceUrl: null, reason: `ticketmaster-http-${res.status}` };
  }

  const data: any = await res.json();
  const events: any[] = data?._embedded?.events ?? [];
  if (!events.length) {
    return { found: false, vendor: "ticketmaster", officialFaceValueCents: null, soldOut: null, sourceUrl: null, reason: "no-event-match" };
  }

  // best-effort pick: first event sorted by date
  const ev = events[0];

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
  };
}
