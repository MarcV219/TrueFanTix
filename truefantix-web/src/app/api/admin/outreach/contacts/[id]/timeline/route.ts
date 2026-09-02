import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  const { id } = await context.params;
  const contact = await prisma.outreachContact.findUnique({
    where: { id },
    include: {
      recipients: { orderBy: { createdAt: "desc" }, take: 100, include: { campaign: { select: { name: true } }, events: { orderBy: { occurredAt: "asc" } } } },
      replies: { orderBy: { receivedAt: "desc" }, take: 100 },
    },
  });
  if (!contact) return NextResponse.json({ ok: false, error: "Contact not found." }, { status: 404 });
  return NextResponse.json({ ok: true, item: contact });
}
