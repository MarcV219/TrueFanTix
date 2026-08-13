export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { LAUNCH_PROMOTION_KEY, LAUNCH_PROMOTION_START, launchPromotionIsActive } from "@/lib/launchPromotion";

function csv(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind")?.toUpperCase();
  const where = { promotionKey: LAUNCH_PROMOTION_KEY, ...(kind === "SIGNUP" || kind === "SALE" ? { kind } : {}) };
  const items = await prisma.promotionParticipation.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    include: { user: { select: { email: true, firstName: true, lastName: true } } },
  });
  if (url.searchParams.get("format") === "csv") {
    const rows = items.map((item) => [item.kind, item.user.email, `${item.user.firstName} ${item.user.lastName}`, item.ticketCount, item.tokensAwarded, item.orderId, item.occurredAt.toISOString(), item.awardedAt?.toISOString()].map(csv).join(","));
    return new Response([["kind", "email", "name", "ticketCount", "tokensAwarded", "orderId", "qualifiedAt", "awardedAt"].join(","), ...rows].join("\n"), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="launch-promotion-${new Date().toISOString().slice(0, 10)}.csv"` },
    });
  }
  return NextResponse.json({
    ok: true,
    promotion: { key: LAUNCH_PROMOTION_KEY, active: launchPromotionIsActive(), startsAt: LAUNCH_PROMOTION_START.toISOString(), endsAt: process.env.LAUNCH_PROMOTION_END_AT || null },
    summary: {
      participants: new Set(items.map((item) => item.userId)).size,
      signups: items.filter((item) => item.kind === "SIGNUP").length,
      saleOrders: items.filter((item) => item.kind === "SALE").length,
      ticketsSold: items.reduce((sum, item) => sum + item.ticketCount, 0),
      tokensAwarded: items.reduce((sum, item) => sum + item.tokensAwarded, 0),
    },
    items: items.map((item) => ({ ...item, user: item.user })),
  });
}
