export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEventType } from "@/lib/ticketsView";

const DEFAULT_KEYWORDS = [
  "Toronto Maple Leafs",
  "Barrie Colts",
  "Ariana Grande",
  "Bruno Mars",
  "Foo Fighters",
  "AC/DC",
  "Ed Sheeran",
  "March Madness",
];

function dollarsToCents(n: number) {
  return Math.round(Number(n) * 100);
}

function ymdNow(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchByKeyword(apikey: string, keyword: string) {
  const sp = new URLSearchParams({
    apikey,
    keyword,
    size: "12",
    sort: "date,asc",
    countryCode: "US,CA",
  });
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${sp.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [] as any[];
  const data: any = await res.json();
  return (data?._embedded?.events ?? []) as any[];
}

export async function POST(req: Request) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: "Missing TICKETMASTER_API_KEY" }, { status: 500 });
  }

  const url = new URL(req.url);
  const perKeyword = Math.min(Math.max(Number(url.searchParams.get("perKeyword") || 6), 1), 20);

  let seedSeller = await prisma.seller.findFirst({ where: { name: "Seed Seller" } });
  if (!seedSeller) {
    seedSeller = await prisma.seller.create({
      data: { name: "Seed Seller", rating: 4.8, reviews: 120, creditBalanceCredits: 0 },
    });
  }

  const today = ymdNow();
  const created: any[] = [];

  for (const keyword of DEFAULT_KEYWORDS) {
    const events = await fetchByKeyword(key, keyword);
    let addedForKeyword = 0;

    for (const ev of events) {
      if (addedForKeyword >= perKeyword) break;

      const date = String(ev?.dates?.start?.localDate || "");
      if (!date || date <= today) continue;

      const title = String(ev?.name || keyword).trim();
      const venueName = String(ev?._embedded?.venues?.[0]?.name || "Unknown Venue").trim();
      const city = String(ev?._embedded?.venues?.[0]?.city?.name || "Unknown City").trim();
      const venue = `${venueName}, ${city}`;
      const soldOut = String(ev?.dates?.status?.code || "").toLowerCase() === "offsale";
      const min = typeof ev?.priceRanges?.[0]?.min === "number" ? ev.priceRanges[0].min : null;
      const max = typeof ev?.priceRanges?.[0]?.max === "number" ? ev.priceRanges[0].max : null;
      const face = max ?? min ?? 120;
      const faceCents = dollarsToCents(face);

      const eventId = `kw-${Buffer.from(`${title}-${date}`).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
      await prisma.event.upsert({
        where: { id: eventId },
        create: {
          id: eventId,
          title,
          date,
          venue,
          selloutStatus: soldOut ? "SOLD_OUT" : "NOT_SOLD_OUT",
        },
        update: {
          title,
          date,
          venue,
          selloutStatus: soldOut ? "SOLD_OUT" : "NOT_SOLD_OUT",
        },
      });

      for (let i = 0; i < 3; i++) {
        const row = String.fromCharCode(65 + (i % 8));
        const seat = String(10 + i * 2);
        const exists = await prisma.ticket.findFirst({
          where: { sellerId: seedSeller.id, title, date, venue, row, seat },
          select: { id: true },
        });
        if (exists) continue;

        const priceCents = Math.max(100, faceCents - i * 500);
        const t = await prisma.ticket.create({
          data: {
            title,
            date,
            venue,
            row,
            seat,
            image: getEventType(title).placeholder,
            priceCents,
            faceValueCents: faceCents,
            status: "AVAILABLE",
            verificationStatus: "VERIFIED",
            verifiedAt: new Date(),
            sellerId: seedSeller.id,
            eventId,
            verificationEvidence: JSON.stringify({
              officialPricingSync: {
                syncedAt: new Date().toISOString(),
                vendor: "ticketmaster",
                sourceUrl: ev?.url ?? null,
                found: true,
                officialFaceValueCents: faceCents,
                soldOut,
                reason: null,
              },
            }),
          },
          select: { id: true, title: true, date: true, venue: true },
        });
        created.push(t);
      }

      addedForKeyword += 1;
    }
  }

  return NextResponse.json({ ok: true, createdCount: created.length, sample: created.slice(0, 20) });
}
