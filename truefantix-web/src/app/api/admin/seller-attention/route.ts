export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { createAuditContext } from "@/lib/audit";
import {
  SELLER_ATTENTION_ACKNOWLEDGED_ACTION,
  SELLER_STRIPE_ATTENTION_WHERE,
  sellerAttentionFingerprint,
  sellerAttentionSeverity,
} from "@/lib/adminQueueCounts";

function parseMetadata(value: string | null) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const sellers = await prisma.seller.findMany({
    where: SELLER_STRIPE_ATTENTION_WHERE,
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, status: true, statusReason: true, createdAt: true, updatedAt: true,
      stripeAccountId: true, stripeDetailsSubmitted: true, stripePayoutsEnabled: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  });
  const acknowledgements = sellers.length ? await prisma.auditLog.findMany({
    where: { action: SELLER_ATTENTION_ACKNOWLEDGED_ACTION, targetType: "Seller", targetId: { in: sellers.map((seller) => seller.id) } },
    orderBy: { createdAt: "desc" },
    select: { targetId: true, createdAt: true, user: { select: { email: true } }, metadata: true },
  }) : [];
  const latestBySeller = new Map<string, (typeof acknowledgements)[number]>();
  for (const acknowledgement of acknowledgements) {
    if (acknowledgement.targetId && !latestBySeller.has(acknowledgement.targetId)) latestBySeller.set(acknowledgement.targetId, acknowledgement);
  }

  return NextResponse.json({ ok: true, sellers: sellers.map((seller) => {
    const fingerprint = sellerAttentionFingerprint(seller);
    const acknowledgement = latestBySeller.get(seller.id);
    const metadata = parseMetadata(acknowledgement?.metadata || null);
    const acknowledged = metadata.fingerprint === fingerprint;
    return {
      ...seller,
      stripeAccountId: seller.stripeAccountId ? "linked" : null,
      severity: sellerAttentionSeverity(seller),
      acknowledged,
      acknowledgedAt: acknowledged ? acknowledgement?.createdAt : null,
      acknowledgedBy: acknowledged ? acknowledgement?.user?.email || null : null,
    };
  }) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({}));
  const sellerId = String(body?.sellerId || "").trim();
  if (!sellerId) return NextResponse.json({ ok: false, error: "Seller ID is required." }, { status: 400 });

  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    select: { id: true, status: true, stripeAccountId: true, stripeDetailsSubmitted: true, stripePayoutsEnabled: true },
  });
  if (!seller) return NextResponse.json({ ok: false, error: "Seller not found." }, { status: 404 });
  const fingerprint = sellerAttentionFingerprint(seller);
  const context = createAuditContext(req);
  await prisma.auditLog.create({ data: {
    action: SELLER_ATTENTION_ACKNOWLEDGED_ACTION,
    userId: gate.user.id,
    targetType: "Seller",
    targetId: seller.id,
    metadata: JSON.stringify({ fingerprint }),
    ...context,
  } });
  return NextResponse.json({ ok: true, sellerId, fingerprint });
}
