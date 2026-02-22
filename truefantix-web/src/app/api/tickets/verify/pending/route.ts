export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TicketVerificationStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth/guards";
import { autoVerifyTicketById } from "@/lib/tickets/verification";

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const take = Math.min(Math.max(Number(body?.take ?? 25), 1), 200);

  const pending = await prisma.ticket.findMany({
    where: { verificationStatus: TicketVerificationStatus.PENDING },
    orderBy: { createdAt: "asc" },
    take,
    select: { id: true },
  });

  const processed: any[] = [];

  for (const t of pending) {
    const updated = await autoVerifyTicketById(prisma, t.id);
    if (updated) processed.push(updated);
  }

  return NextResponse.json({
    ok: true,
    requested: take,
    processedCount: processed.length,
    processed,
  });
}
