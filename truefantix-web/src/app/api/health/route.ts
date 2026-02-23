export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      status: "healthy",
      checks: { db: "ok" },
      latencyMs: Date.now() - started,
      ts: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        status: "unhealthy",
        checks: { db: "failed" },
        error: e?.message || "Health check failed",
        ts: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
