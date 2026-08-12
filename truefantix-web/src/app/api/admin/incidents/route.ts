export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const url = new URL(req.url);
  const status = url.searchParams.get("status")?.toUpperCase() || "OPEN";
  const where = status === "ALL" ? {} : { status };
  const [incidents, openCount, criticalCount] = await Promise.all([
    prisma.productionIncident.findMany({ where, orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }], take: 250 }),
    prisma.productionIncident.count({ where: { status: "OPEN" } }),
    prisma.productionIncident.count({ where: { status: "OPEN", severity: "CRITICAL" } }),
  ]);
  return NextResponse.json({ ok: true, incidents, openCount, criticalCount });
}

export async function PATCH(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => null) as { id?: string; status?: string } | null;
  if (!body?.id || !["OPEN", "RESOLVED"].includes(body.status || "")) {
    return NextResponse.json({ ok: false, error: "INVALID_REQUEST" }, { status: 400 });
  }
  const resolved = body.status === "RESOLVED";
  const incident = await prisma.productionIncident.update({
    where: { id: body.id },
    data: { status: body.status, resolvedAt: resolved ? new Date() : null, resolvedById: resolved ? gate.user.id : null },
  });
  return NextResponse.json({ ok: true, incident });
}
