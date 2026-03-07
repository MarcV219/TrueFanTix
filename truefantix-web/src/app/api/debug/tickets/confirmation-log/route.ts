export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const take = Math.min(Math.max(Number(url.searchParams.get("take") || 100), 1), 500);

  const tickets = await prisma.ticket.findMany({
    where: { status: { in: ["AVAILABLE", "SOLD"] } },
    orderBy: { createdAt: "desc" },
    take,
    include: { event: true },
  });

  const rows = tickets.map((t) => {
    let ev: any = {};
    try {
      ev = t.verificationEvidence ? JSON.parse(t.verificationEvidence) : {};
    } catch {
      ev = {};
    }

    const official = ev?.officialPricingSync ?? null;
    const confirmedFaceValueCents =
      typeof official?.officialFaceValueCents === "number" ? official.officialFaceValueCents : null;
    const aboveConfirmedFaceValue =
      confirmedFaceValueCents != null ? t.priceCents > confirmedFaceValueCents : false;

    return {
      id: t.id,
      title: t.title,
      date: t.date,
      venue: t.venue,
      row: t.row,
      seat: t.seat,
      priceCents: t.priceCents,
      faceValueCents: t.faceValueCents,
      confirmedFaceValueCents,
      aboveConfirmedFaceValue,
      eventSelloutStatus: t.event?.selloutStatus ?? null,
      confirmation: {
        title: {
          confirmed: !!official?.found,
          source: official?.sourceUrl ?? null,
          note: !!official?.found ? "Matched by official provider event lookup" : "Not confirmed",
        },
        date: {
          confirmed: !!official?.found,
          source: official?.sourceUrl ?? null,
          note: !!official?.found ? "Matched by official provider event lookup" : "Not confirmed",
        },
        location: {
          confirmed: !!official?.found,
          source: official?.sourceUrl ?? null,
          note: !!official?.found ? "Matched by official provider event lookup" : "Not confirmed",
        },
        seat: {
          confirmed: false,
          source: null,
          note: "Not available from primary-market public API (currently guessed from listing)",
        },
        price: {
          confirmed: confirmedFaceValueCents != null,
          source: official?.sourceUrl ?? null,
          note:
            confirmedFaceValueCents != null
              ? "Confirmed from official primary-market event-level pricing"
              : "No official pricing confirmation",
        },
        soldOut: {
          confirmed: typeof official?.soldOut === "boolean",
          source: official?.sourceUrl ?? null,
          note:
            typeof official?.soldOut === "boolean"
              ? "Confirmed from official provider event status"
              : "No official sold-out confirmation",
        },
      },
      provider: official?.vendor ?? null,
      sourceUrl: official?.sourceUrl ?? null,
      syncedAt: official?.syncedAt ?? null,
      reason: official?.reason ?? null,
    };
  });

  return NextResponse.json({
    ok: true,
    count: rows.length,
    rows,
  });
}
