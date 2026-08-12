export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reportProductionIncident } from "@/lib/productionIncidents";

export async function GET() {
  const started = Date.now();
  const hasSessionSecret = !!process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32;

  try {
    await prisma.$queryRaw`SELECT 1`;

    const checks = {
      db: "ok" as const,
      sessionSecret: hasSessionSecret ? ("ok" as const) : ("missing_or_too_short" as const),
    };

    const ok = checks.db === "ok" && checks.sessionSecret === "ok";

    return NextResponse.json(
      {
        ok,
        status: ok ? "healthy" : "unhealthy",
        checks,
        latencyMs: Date.now() - started,
        ts: new Date().toISOString(),
      },
      { status: ok ? 200 : 503 }
    );
  } catch (e: unknown) {
    await reportProductionIncident({ category: "DATABASE", severity: "CRITICAL", summary: "Production database health check failed", error: e, fingerprint: "database-health-failed" });
    const message = e instanceof Error ? e.message : "Health check failed";
    return NextResponse.json(
      {
        ok: false,
        status: "unhealthy",
        checks: {
          db: "failed",
          sessionSecret: hasSessionSecret ? "ok" : "missing_or_too_short",
        },
        error: message,
        ts: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
