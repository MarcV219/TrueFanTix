export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { Prisma } from "@prisma/client";

function csvEscape(value: string): string {
  const s = value ?? "";
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  try {
    const url = new URL(req.url);
    const format = (url.searchParams.get("format") || "csv").toLowerCase();
    const source = (url.searchParams.get("source") || "").trim();
    const fromRaw = (url.searchParams.get("from") || "").trim(); // YYYY-MM-DD
    const toRaw = (url.searchParams.get("to") || "").trim(); // YYYY-MM-DD

    const fromDate = fromRaw ? new Date(`${fromRaw}T00:00:00.000Z`) : null;
    const toDate = toRaw ? new Date(`${toRaw}T23:59:59.999Z`) : null;

    const where: Prisma.EarlyAccessLeadWhereInput = {};

    if (source) where.source = source;

    if (fromDate && !Number.isNaN(fromDate.getTime())) {
      where.createdAt = { ...(where.createdAt as Prisma.DateTimeFilter | undefined), gte: fromDate };
    }

    if (toDate && !Number.isNaN(toDate.getTime())) {
      where.createdAt = { ...(where.createdAt as Prisma.DateTimeFilter | undefined), lte: toDate };
    }

    const leads = await prisma.earlyAccessLead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        email: true,
        source: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (format === "json") {
      const sources = await prisma.earlyAccessLead.findMany({
        distinct: ["source"],
        select: { source: true },
        orderBy: { source: "asc" },
      });
      return NextResponse.json({
        ok: true,
        count: leads.length,
        items: leads,
        filters: {
          source: source || null,
          from: fromRaw || null,
          to: toRaw || null,
          availableSources: sources.map((s) => s.source),
        },
      });
    }

    const header = ["email", "source", "createdAt", "updatedAt"].join(",");
    const rows = leads.map((l) =>
      [
        csvEscape(l.email),
        csvEscape(l.source),
        l.createdAt.toISOString(),
        l.updatedAt.toISOString(),
      ].join(",")
    );

    const csv = [header, ...rows].join("\n");

    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="early-access-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    console.error("GET /api/admin/early-access/export failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not export early access leads." },
      { status: 500 }
    );
  }
}
