export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TicketVerificationStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth/guards";

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  try {
    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "PENDING").toUpperCase();
    const take = Math.min(Math.max(Number(url.searchParams.get("take") || 50), 1), 200);

    const where: any = {
      verificationStatus:
        status === "PENDING" || status === "NEEDS_REVIEW" || status === "REJECTED" || status === "VERIFIED"
          ? (status as TicketVerificationStatus)
          : TicketVerificationStatus.PENDING,
    };

    const tickets = await prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take,
      include: {
        seller: {
          select: { id: true, name: true, rating: true, reviews: true },
        },
        event: {
          select: { id: true, title: true, venue: true, date: true, selloutStatus: true },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      status: where.verificationStatus,
      take,
      tickets: tickets.map((t) => ({
        id: t.id,
        title: t.title,
        image: t.image,
        venue: t.venue,
        date: t.date,
        priceCents: t.priceCents,
        faceValueCents: t.faceValueCents,
        status: t.status,
        verificationStatus: t.verificationStatus,
        verificationScore: t.verificationScore,
        verificationReason: t.verificationReason,
        verificationProvider: t.verificationProvider,
        verificationEvidence: t.verificationEvidence,
        verifiedAt: t.verifiedAt,
        barcodeType: t.barcodeType,
        barcodeLast4: t.barcodeLast4,
        createdAt: t.createdAt,
        seller: t.seller,
        event: t.event,
      })),
    });
  } catch (err: any) {
    console.error("GET /api/admin/tickets/verification-queue error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to load verification queue." },
      { status: 500 }
    );
  }
}
