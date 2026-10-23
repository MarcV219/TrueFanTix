export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePrimaryPilotBuyer } from "@/lib/primary/pilot-auth";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requirePrimaryPilotBuyer(req);
  if (!gate.ok) return gate.res;
  const { id } = await context.params;
  const order = await prisma.primaryOrder.findFirst({ where: { id, buyerUserId: gate.user.id }, include: { lines: true, components: { orderBy: { position: "asc" } }, paymentAttempt: true, admissionTickets: { include: { credential: true }, orderBy: { unitNumber: "asc" } } } });
  if (!order) return NextResponse.json({ ok: false, error: "ORDER_NOT_FOUND" }, { status: 404 });
  const response = NextResponse.json({ ok: true, order });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
