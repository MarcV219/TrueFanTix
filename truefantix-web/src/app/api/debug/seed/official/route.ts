export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEventType } from "@/lib/ticketsView";

function dollarsToCents(d: number) {
  return Math.round(d * 100);
}

type TMEvent = {
  name: string;
  url?: string;
  dates?: { start?: { localDate?: string }; status?: { code?: string } };
  priceRanges?: Array<{ min?: number; max?: number }>;
  _embedded?: { venues?: Array<{ name?: string; city?: { name?: string } }> };
};

async function fetchOfficialEvents(apiKey: string): Promise<TMEvent[]> {
  const queries = ["concert", "sports", "broadway", "festival", "comedy"];
  const out: TMEvent[] = [];

  for (const q of queries) {
    const sp = new URLSearchParams({
      apikey: apiKey,
      keyword: q,
      size: "30",
      sort: "date,asc",
      countryCode: "US,CA",
    });

    const url = `https://app.ticketmaster.com/discovery/v2/events.json?${sp.toString()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) continue;
    const data: any = await res.json();
    const events: TMEvent[] = data?._embedded?.events ?? [];
    out.push(...events);
    await new Promise((r) => setTimeout(r, 220));
  }

  const seen = new Set<string>();
  return out.filter((e) => {
    const date = e?.dates?.start?.localDate || "";
    const key = `${e.name}|${date}`;
    if (!e.name || !date) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function POST(req: Request) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: "Missing TICKETMASTER_API_KEY" }, { status: 500 });
  }

  const url = new URL(req.url);
  const take = Math.min(Math.max(Number(url.searchParams.get("take") || 100), 1), 200);

  let seedSeller = await prisma.seller.findFirst({ where: { name: "Seed Seller" } });
  if (!seedSeller) {
    seedSeller = await prisma.seller.create({
      data: { name: "Seed Seller", rating: 4.8, reviews: 120, creditBalanceCredits: 0 },
    });
  }

  const events = await fetchOfficialEvents(key);
  const selected = events.filter((e) => String(e?.dates?.start?.localDate || "").startsWith("2026-")).slice(0, Math.max(25, Math.ceil(take / 4)));

  const rows: any[] = [];
  const seatRows = ["A", "B", "C", "D", "E", "F", "G", "H"];

  let created = 0;
  for (const ev of selected) {
    if (created >= take) break;
    const date = ev?.dates?.start?.localDate || "2026-01-01";
    const venueName = ev?._embedded?.venues?.[0]?.name || "Unknown Venue";
    const city = ev?._embedded?.venues?.[0]?.city?.name || "Unknown City";
    const venue = `${venueName}, ${city}`;
    const face = ev?.priceRanges?.[0]?.max ?? ev?.priceRanges?.[0]?.min ?? 99;
    const faceCents = dollarsToCents(Number(face));
    const soldOut = (ev?.dates?.status?.code || "").toLowerCase() === "offsale";

    // one Event record per title/date
    const eventRec = await prisma.event.upsert({
      where: { id: `official-${Buffer.from(`${ev.name}-${date}`).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}` },
      create: {
        id: `official-${Buffer.from(`${ev.name}-${date}`).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`,
        title: ev.name,
        date,
        venue,
        selloutStatus: soldOut ? "SOLD_OUT" : "NOT_SOLD_OUT",
      },
      update: {
        title: ev.name,
        date,
        venue,
        selloutStatus: soldOut ? "SOLD_OUT" : "NOT_SOLD_OUT",
      },
    });

    for (let i = 0; i < 4 && created < take; i++) {
      const row = seatRows[(created + i) % seatRows.length];
      const seat = String(((created + 3 * i) % 30) + 1);
      const priceCents = Math.max(100, faceCents - ((i % 3) * 500));

      const exists = await prisma.ticket.findFirst({
        where: { title: ev.name, date, venue, row, seat, sellerId: seedSeller.id },
        select: { id: true },
      });
      if (exists) continue;

      const t = await prisma.ticket.create({
        data: {
          title: ev.name,
          date,
          venue,
          row,
          seat,
          priceCents,
          faceValueCents: faceCents,
          status: "AVAILABLE",
          verificationStatus: "VERIFIED",
          verifiedAt: new Date(),
          image: getEventType(ev.name).placeholder,
          sellerId: seedSeller.id,
          eventId: eventRec.id,
          verificationEvidence: JSON.stringify({
            officialPricingSync: {
              syncedAt: new Date().toISOString(),
              vendor: "ticketmaster",
              sourceUrl: ev.url ?? null,
              found: true,
              officialFaceValueCents: faceCents,
              soldOut,
              reason: null,
            },
          }),
        },
        select: { id: true, title: true, date: true, venue: true, row: true, seat: true },
      });
      rows.push(t);
      created += 1;
    }
  }

  return NextResponse.json({ ok: true, requested: take, created: rows.length, rows: rows.slice(0, 20) });
}
