export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyRateLimit } from "@/lib/rate-limit";
import { attributionSource, sanitizeAttribution } from "@/lib/analytics/campaign-attribution";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function shortText(value: unknown, max: number): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : null;
}

function torontoDay(): Date {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${date}T00:00:00.000Z`);
}

export async function POST(req: Request) {
  try {
    const limited = await applyRateLimit(req, "DEFAULT_UNAUTH_READ");
    if (!limited.ok) return limited.response;

    const body = await req.json().catch(() => null);
    const id = shortText(body?.visitorId, 36);
    const path = shortText(body?.path, 200);
    if (!id || !UUID.test(id) || !path || !path.startsWith("/")) {
      return NextResponse.json({ ok: false, error: "INVALID_VISIT" }, { status: 400 });
    }

    const attribution = sanitizeAttribution({
      source: body?.source,
      medium: body?.medium,
      campaign: body?.campaign,
      content: body?.content,
      term: body?.term,
      firstPath: path,
      referrerHost: body?.referrerHost || body?.referrer,
    });
    const day = torontoDay();

    await prisma.trafficVisitorDay.upsert({
      where: { day_visitorId: { day, visitorId: id } },
      create: {
        day,
        visitorId: id,
        firstPath: path,
        referrerHost: attribution.referrerHost,
        source: attributionSource(attribution),
        medium: attribution.medium,
        campaign: attribution.campaign,
        content: attribution.content,
        term: attribution.term,
      },
      update: { pageViews: { increment: 1 } },
    });

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (error) {
    console.error("POST /api/analytics/visit failed:", error);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
