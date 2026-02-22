export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";

type Ctx = { params?: Promise<{ id?: string }> | { id?: string } };

function normalizeId(value: unknown) {
  try {
    return decodeURIComponent(String(value ?? "")).trim();
  } catch {
    return String(value ?? "").trim();
  }
}

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  const p: any = ctx?.params;
  const resolved = typeof p?.then === "function" ? await p : p;
  const ticketId = normalizeId(resolved?.id);
  if (!ticketId) return NextResponse.json({ ok: false, error: "Missing ticket id" }, { status: 400 });

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { escrow: true },
  });

  if (!ticket) return NextResponse.json({ ok: false, error: "Ticket not found" }, { status: 404 });

  const isSeller = gate.user.sellerId === ticket.sellerId;
  const isAdmin = gate.user.role === "ADMIN";
  if (!isSeller && !isAdmin) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    ticketId: ticket.id,
    status: ticket.status,
    escrow: ticket.escrow ?? null,
  });
}
