export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const MAX_AGE_MS = 7 * 60 * 60 * 1000;

export async function GET() {
  const now = new Date();
  const latest = await prisma.auditLog.findFirst({
    where: {
      action: "TRANSFER_REMINDER_SCHEDULER_RUN",
      targetId: "order-transfer-reminders",
      metadata: { contains: '"status":"SUCCESS"' },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const ageMs = latest ? now.getTime() - latest.createdAt.getTime() : null;
  const ok = ageMs !== null && ageMs <= MAX_AGE_MS;

  return NextResponse.json(
    {
      ok,
      status: ok ? "healthy" : "stale",
      lastSuccessfulRunAt: latest?.createdAt.toISOString() ?? null,
      maxAgeMinutes: MAX_AGE_MS / 60_000,
      ts: now.toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
