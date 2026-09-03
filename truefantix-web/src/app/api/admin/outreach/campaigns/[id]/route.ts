import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { auditLog, createAuditContext } from "@/lib/audit";

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

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const confirmation = String(body?.confirmation || "");
  const campaign = await prisma.outreachCampaign.findUnique({
    where: { id },
    select: { id: true, name: true, status: true },
  });
  if (!campaign)
    return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
  if (confirmation !== campaign.name)
    return NextResponse.json(
      { ok: false, error: "Type the exact campaign name to confirm deletion." },
      { status: 400 },
    );

  const deleted = await prisma.outreachCampaign.deleteMany({
    where: {
      id,
      status: "DRAFT",
      recipients: { every: { status: "PENDING" } },
    },
  });
  if (deleted.count !== 1)
    return NextResponse.json(
      { ok: false, error: "Only a draft campaign with no sent messages can be deleted." },
      { status: 409 },
    );

  await auditLog({
    action: "ADMIN_OUTREACH_CAMPAIGN_DELETE",
    userId: gate.user.id,
    targetType: "OutreachCampaign",
    targetId: id,
    metadata: { name: campaign.name },
    ...createAuditContext(req),
  });
  return NextResponse.json({ ok: true });
}

export const runtime = "nodejs";
