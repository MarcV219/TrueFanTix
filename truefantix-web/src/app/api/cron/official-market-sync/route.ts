export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasInternalCronAuth } from "@/lib/auth/guards";
import { fetchOfficialSnapshot } from "@/lib/officialPricing";

export async function POST(req: Request) {
  if (!hasInternalCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const take = Math.min(Math.max(Number(url.searchParams.get("take") || 100), 1), 500);
  const enforceCap = url.searchParams.get("enforceCap") === "1";

  const tickets = await prisma.ticket.findMany({
    where: { status: { in: ["AVAILABLE", "SOLD"] } },
    orderBy: { createdAt: "desc" },
    take,
    include: { event: true },
  });

  let updatedPriceCount = 0;
  let updatedFaceValueCount = 0;
  let updatedSelloutCount = 0;

  const rows: any[] = [];

  for (const t of tickets) {
    const snap = await fetchOfficialSnapshot({
      title: t.title,
      date: t.date,
      venue: t.venue,
      primaryVendor: t.primaryVendor,
    });

    let nextFaceValue = t.faceValueCents;
    let nextPrice = t.priceCents;
    let nextSellout: "SOLD_OUT" | "NOT_SOLD_OUT" | null = null;

    if (snap.officialFaceValueCents != null) {
      nextFaceValue = snap.officialFaceValueCents;
      if (enforceCap && nextPrice > snap.officialFaceValueCents) {
        nextPrice = snap.officialFaceValueCents;
      }
    }

    if (typeof snap.soldOut === "boolean") {
      nextSellout = snap.soldOut ? "SOLD_OUT" : "NOT_SOLD_OUT";
    }

    const ticketChanged = nextFaceValue !== t.faceValueCents || nextPrice !== t.priceCents;

    if (ticketChanged) {
      let existingEvidence: any = {};
      try {
        existingEvidence = t.verificationEvidence ? JSON.parse(t.verificationEvidence) : {};
      } catch {
        existingEvidence = {};
      }

      await prisma.ticket.update({
        where: { id: t.id },
        data: {
          faceValueCents: nextFaceValue,
          priceCents: nextPrice,
          verificationEvidence: JSON.stringify({
            ...existingEvidence,
            officialPricingSync: {
              vendor: snap.vendor,
              sourceUrl: snap.sourceUrl,
              syncedAt: new Date().toISOString(),
              found: snap.found,
              officialFaceValueCents: snap.officialFaceValueCents,
              soldOut: snap.soldOut,
              reason: snap.reason ?? null,
            },
          }),
        },
      });

      if (nextFaceValue !== t.faceValueCents) updatedFaceValueCount += 1;
      if (nextPrice !== t.priceCents) updatedPriceCount += 1;
    }

    if (nextSellout) {
      if (t.eventId) {
        await prisma.event.update({
          where: { id: t.eventId },
          data: { selloutStatus: nextSellout },
        });
        updatedSelloutCount += 1;
      } else {
        const ev = await prisma.event.findFirst({ where: { title: t.title, date: t.date } });
        const eventId = ev?.id ?? `sync-${t.id}`;
        if (!ev) {
          await prisma.event.create({
            data: { id: eventId, title: t.title, venue: t.venue, date: t.date, selloutStatus: nextSellout },
          });
        } else {
          await prisma.event.update({ where: { id: eventId }, data: { selloutStatus: nextSellout } });
        }
        await prisma.ticket.update({ where: { id: t.id }, data: { eventId } });
        updatedSelloutCount += 1;
      }
    }

    rows.push({
      id: t.id,
      title: t.title,
      oldPriceCents: t.priceCents,
      newPriceCents: nextPrice,
      oldFaceValueCents: t.faceValueCents,
      newFaceValueCents: nextFaceValue,
      vendor: snap.vendor,
      soldOut: snap.soldOut,
      sourceUrl: snap.sourceUrl,
      found: snap.found,
      reason: snap.reason ?? null,
    });
  }

  return NextResponse.json({
    ok: true,
    scanned: tickets.length,
    updatedPriceCount,
    updatedFaceValueCount,
    updatedSelloutCount,
    rows,
    notes: [
      "Below Face Value tag is computed in UI as price < faceValue.",
      "Face Value tag is shown when price >= faceValue or event sold out.",
      "By default this sync does NOT auto-cap ticket price; pass ?enforceCap=1 to clamp price to official face value.",
      "This sync uses official primary-market (Ticketmaster Discovery API) only; no reseller sources.",
      "Exact row/seat-level primary market pricing is not generally exposed via public API; sync uses best available event-level price ranges.",
    ],
  });
}
