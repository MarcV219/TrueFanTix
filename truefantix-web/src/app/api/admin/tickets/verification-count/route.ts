export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { loadAdminQueueCounts } from "@/lib/adminQueueService";

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  try {
    const counts = await loadAdminQueueCounts();

    return NextResponse.json({
      ok: true,
      counts,
    });
  } catch (err: any) {
    console.error("GET /api/admin/tickets/verification-count error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to load verification counts." },
      { status: 500 }
    );
  }
}
