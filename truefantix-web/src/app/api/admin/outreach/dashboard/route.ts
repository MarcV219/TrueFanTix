import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  const [recipientGroups, suppressionGroups, campaignCount, recentEvents] = await prisma.$transaction([
    prisma.outreachRecipient.groupBy({ by: ["status"], orderBy: { status: "asc" }, _count: true }),
    prisma.outreachSuppression.groupBy({ by: ["reason"], orderBy: { reason: "asc" }, _count: true }),
    prisma.outreachCampaign.count(),
    prisma.outreachEmailEvent.findMany({ orderBy: { occurredAt: "desc" }, take: 12, select: { id: true, type: true, email: true, occurredAt: true, detail: true, recipient: { select: { campaign: { select: { name: true } } } } } }),
  ]);
  const recipients = Object.fromEntries(recipientGroups.map((row) => [row.status, row._count]));
  const suppressions = Object.fromEntries(suppressionGroups.map((row) => [row.reason, row._count]));
  return NextResponse.json({
    ok: true,
    campaignCount,
    recipients,
    suppressions,
    webhookConfigured: Boolean(process.env.OUTREACH_RESEND_WEBHOOK_SECRET?.trim()),
    recentEvents: recentEvents.map(({ recipient, ...event }) => ({ ...event, campaignName: recipient.campaign.name })),
  });
}
