export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return gate.res;

    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "PENDING").trim().toUpperCase();
    const take = Math.min(Math.max(Number(url.searchParams.get("limit") || "50") || 50, 1), 200);

    const requests = await prisma.catalogRequest.findMany({
      where: status === "ALL" ? {} : { status },
      orderBy: [{ createdAt: "desc" }],
      take,
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        requestedType: true,
        requestedValue: true,
        notes: true,
        status: true,
        adminNotes: true,
        emailSentAt: true,
        emailError: true,
        reviewedAt: true,
        fulfilledPreferenceId: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        resolvedCatalogEntity: {
          select: {
            id: true,
            type: true,
            canonicalName: true,
            provider: true,
            providerId: true,
            subtitle: true,
          },
        },
      },
    });

    return NextResponse.json({ ok: true, requests }, { status: 200 });
  } catch (err) {
    console.error("GET /api/admin/catalog-requests failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not load catalog requests." },
      { status: 500 }
    );
  }
}
