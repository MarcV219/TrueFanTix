export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

type Ctx = { params?: Promise<{ id?: string }> | { id?: string } };

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const p: any = ctx?.params;
  const resolved = typeof p?.then === "function" ? await p : p;
  const ticketId = normalizeId(resolved?.id);

  if (!ticketId) {
    return NextResponse.json({ ok: false, error: "Missing ticket id" }, { status: 400 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const statusRaw = String(body?.verificationStatus ?? "").trim().toUpperCase();
  const verificationStatus =
    statusRaw === "VERIFIED" || statusRaw === "REJECTED" || statusRaw === "NEEDS_REVIEW" || statusRaw === "PENDING"
      ? (statusRaw as TicketVerificationStatus)
      : null;

  if (!verificationStatus) {
    return NextResponse.json(
      { ok: false, error: "verificationStatus must be one of PENDING|VERIFIED|REJECTED|NEEDS_REVIEW" },
      { status: 400 }
    );
  }

  const verificationScore =
    body?.verificationScore == null ? null : Number.isFinite(Number(body.verificationScore)) ? Number(body.verificationScore) : null;
  const verificationReason = body?.verificationReason ? String(body.verificationReason) : null;
  const verificationProvider = body?.verificationProvider ? String(body.verificationProvider) : "manual-admin";

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      verificationStatus,
      verificationScore,
      verificationReason,
      verificationProvider,
      verifiedAt: verificationStatus === "VERIFIED" ? new Date() : null,
    },
    select: {
      id: true,
      title: true,
      status: true,
      verificationStatus: true,
      verificationScore: true,
      verificationReason: true,
      verificationProvider: true,
      verifiedAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ ok: true, ticket: updated });
}
