export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { queryAuditLogs } from "@/lib/audit";

function parseDate(value: string | null, endOfDay = false) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const date = new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const url = new URL(req.url);
  const action = (url.searchParams.get("action") || "").trim();
  const userId = (url.searchParams.get("userId") || "").trim();
  const targetType = (url.searchParams.get("targetType") || "").trim();
  const targetId = (url.searchParams.get("targetId") || "").trim();
  const fromDate = parseDate(url.searchParams.get("from"));
  const toDate = parseDate(url.searchParams.get("to"), true);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);

  const result = await queryAuditLogs({
    action: action as any,
    userId: userId || undefined,
    targetType: targetType || undefined,
    targetId: targetId || undefined,
    fromDate,
    toDate,
    limit,
  });

  return NextResponse.json({
    ok: true,
    filters: {
      action: action || null,
      userId: userId || null,
      targetType: targetType || null,
      targetId: targetId || null,
      from: url.searchParams.get("from") || null,
      to: url.searchParams.get("to") || null,
      limit,
    },
    ...result,
  });
}
