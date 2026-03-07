export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function normalizeTitle(title: string): string {
  return (title || "")
    .replace(/MontrealCanadiens/g, "Montreal Canadiens")
    .replace(/RedSox/g, "Red Sox")
    .replace(/BostonBruins/g, "Boston Bruins")
    .replace(/Moulin Rouge!The Musical/g, "Moulin Rouge! The Musical")
    .replace(/DayPass/g, "Day Pass")
    .replace(/Day1/g, "Day 1")
    .replace(/Arts Festival/g, "Arts Festival")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeDate(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const take = Math.min(Math.max(Number(url.searchParams.get("take") || 300), 1), 1000);

  const tickets = await prisma.ticket.findMany({
    where: { status: { in: ["AVAILABLE", "SOLD"] } },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, title: true, date: true },
  });

  let updated = 0;
  const rows: any[] = [];

  for (const t of tickets) {
    const nt = normalizeTitle(t.title);
    const nd = normalizeDate(t.date);
    if (nt === t.title && nd === t.date) continue;

    await prisma.ticket.update({ where: { id: t.id }, data: { title: nt, date: nd } });
    updated += 1;
    rows.push({ id: t.id, oldTitle: t.title, newTitle: nt, oldDate: t.date, newDate: nd });
  }

  return NextResponse.json({ ok: true, scanned: tickets.length, updated, rows: rows.slice(0, 100) });
}
