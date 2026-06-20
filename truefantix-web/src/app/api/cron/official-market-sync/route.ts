export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasInternalCronAuth } from "@/lib/auth/guards";
import { fetchOfficialSnapshot } from "@/lib/officialPricing";

function sameMoney(a: number | null | undefined, b: number | null | undefined) {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1;
}

function verifiedAdminFeesCents(adminFeePaidCents: number, snap: Awaited<ReturnType<typeof fetchOfficialSnapshot>>, evidence: any) {
  if (adminFeePaidCents <= 0) return 0;
  if (sameMoney(snap.officialServiceFeesCents, adminFeePaidCents)) return adminFeePaidCents;

  const ocr = evidence?.receiptProof?.ocr;
  const receiptQuantity = typeof ocr?.ticketQuantity === "number" && ocr.ticketQuantity > 0 ? ocr.ticketQuantity : null;
  const receiptServiceFeesCents =
    typeof ocr?.serviceFeesCents === "number"
      ? ocr.serviceFeesCents
      : typeof ocr?.totalServiceFeesCents === "number" && receiptQuantity
        ? Math.round(ocr.totalServiceFeesCents / receiptQuantity)
        : null;

  return sameMoney(receiptServiceFeesCents, adminFeePaidCents) ? adminFeePaidCents : 0;
}

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

    let existingEvidence: any = {};
    try {
      existingEvidence = t.verificationEvidence ? JSON.parse(t.verificationEvidence) : {};
    } catch {
      existingEvidence = {};
    }

    const adminFeePaidCents = Math.max(0, t.adminFeePaidCents ?? 0);
    const verifiedServiceFeesCents = verifiedAdminFeesCents(adminFeePaidCents, snap, existingEvidence);

    if (snap.officialFaceValueCents != null) {
      nextFaceValue = snap.officialFaceValueCents;
      const maxListPriceCents = snap.officialFaceValueCents + verifiedServiceFeesCents;
      if (enforceCap && nextPrice > maxListPriceCents) {
        nextPrice = maxListPriceCents;
      }
    }

    if (typeof snap.soldOut === "boolean") {
      nextSellout = snap.soldOut ? "SOLD_OUT" : "NOT_SOLD_OUT";
    }

    const ticketChanged = nextFaceValue !== t.faceValueCents || nextPrice !== t.priceCents;

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
            officialVenueName: snap.officialVenueName ?? null,
            officialPriceRangeMinCents: snap.officialPriceRangeMinCents ?? null,
            officialPriceRangeMaxCents: snap.officialPriceRangeMaxCents ?? null,
            officialFaceValueCents: snap.officialFaceValueCents,
            officialServiceFeesCents: snap.officialServiceFeesCents ?? null,
            officialServiceFeeSource: snap.officialServiceFeeSource ?? null,
            adminFeePaidCents,
            verifiedServiceFeesCents,
            maxListPriceCents:
              snap.officialFaceValueCents == null
                ? null
                : snap.officialFaceValueCents + verifiedServiceFeesCents,
            officialStatusCode: snap.officialStatusCode ?? null,
            soldOut: snap.soldOut,
            soldOutSource: snap.soldOutSource ?? null,
            reason: snap.reason ?? null,
          },
        }),
      },
    });

    if (ticketChanged) {
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
      officialStatusCode: snap.officialStatusCode ?? null,
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
      "By default this sync does NOT auto-cap ticket price; pass ?enforceCap=1 to clamp price to official face value plus source- or receipt-verified admin fees paid.",
      "This sync uses official primary-market (Ticketmaster Discovery API) only; no reseller sources.",
      "Exact row/seat-level primary market pricing is not generally exposed via public API; sync uses best available event-level price ranges.",
    ],
  });
}

export async function GET(req: Request) {
  return POST(req);
}
