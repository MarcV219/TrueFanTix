import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  const { id } = await context.params;
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id },
    select: {
      id: true, name: true, status: true,
      recipients: {
        orderBy: { createdAt: "asc" },
        select: { id: true, emailSnapshot: true, subjectSnapshot: true, bodyTextSnapshot: true, bodyHtmlSnapshot: true, status: true, contact: { select: { contactName: true, organization: true, subjectName: true, role: true } } },
      },
    },
  });
  if (!campaign) return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
  return NextResponse.json({ ok: true, item: campaign });
}

export const runtime = "nodejs";
