export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TicketVerificationStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth/guards";

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  try {
    const [pending, needsReview, rejected] = await Promise.all([
      prisma.ticket.count({ where: { verificationStatus: TicketVerificationStatus.PENDING } }),
      prisma.ticket.count({ where: { verificationStatus: TicketVerificationStatus.NEEDS_REVIEW } }),
      prisma.ticket.count({ where: { verificationStatus: TicketVerificationStatus.REJECTED } }),
    ]);

    return NextResponse.json({
      ok: true,
      counts: {
        pending,
        needsReview,
        rejected,
        actionable: pending + needsReview,
      },
    });
  } catch (err: any) {
    console.error("GET /api/admin/tickets/verification-count error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to load verification counts." },
      { status: 500 }
    );
  }
}
