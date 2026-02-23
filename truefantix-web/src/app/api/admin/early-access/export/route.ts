export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

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

    const leads = await prisma.earlyAccessLead.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        email: true,
        source: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (format === "json") {
      return NextResponse.json({ ok: true, count: leads.length, items: leads });
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
