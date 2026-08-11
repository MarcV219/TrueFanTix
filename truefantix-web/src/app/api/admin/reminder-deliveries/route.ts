export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

function parseDate(value: string | null, endOfDay = false) {
  if (!value) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const url = new URL(req.url);
  const status = url.searchParams.get("status")?.trim().toUpperCase();
  const reminderType = url.searchParams.get("type")?.trim().toUpperCase();
  const query = url.searchParams.get("q")?.trim();
  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"), true);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 250);

  const where = {
    ...(status && status !== "ALL" ? { status } : {}),
    ...(reminderType && reminderType !== "ALL" ? { reminderType } : {}),
    ...(from || to ? { attemptedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(query ? { OR: [
      { orderId: { contains: query, mode: "insensitive" as const } },
      { recipient: { contains: query, mode: "insensitive" as const } },
      { failureReason: { contains: query, mode: "insensitive" as const } },
    ] } : {}),
  };

  const [deliveries, total, failed24h] = await Promise.all([
    prisma.reminderDelivery.findMany({ where, orderBy: { attemptedAt: "desc" }, take: limit }),
    prisma.reminderDelivery.count({ where }),
    prisma.reminderDelivery.count({ where: { status: "FAILED", attemptedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
  ]);

  return NextResponse.json({ ok: true, deliveries, total, failed24h, hasMore: total > deliveries.length });
}
