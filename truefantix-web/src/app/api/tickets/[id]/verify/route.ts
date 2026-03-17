export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { schemas, validateRequest } from "@/lib/validation";

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

  const validation = await validateRequest(schemas.adminTicketVerificationById)(req);
  if (!validation.success) return validation.response;

  const { status, score, reason, provider } = validation.data;

  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      verificationStatus: status,
      verificationScore: score ?? null,
      verificationReason: reason ?? null,
      verificationProvider: provider ?? "manual-admin",
      verifiedAt: status === "VERIFIED" ? new Date() : null,
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
