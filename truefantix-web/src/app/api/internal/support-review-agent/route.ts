export const runtime = "nodejs";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditLog, createAuditContext } from "@/lib/audit";

const recommendationSchema = z.object({
  ticketId: z.string().trim().cuid(),
  recommendation: z.enum(["RECOMMEND_APPROVE", "RECOMMEND_REJECT", "NEEDS_HUMAN"]),
  summary: z.string().trim().min(20).max(2000),
  evidence: z.array(z.object({
    url: z.string().url().max(2048),
    title: z.string().trim().min(1).max(300),
    claim: z.string().trim().min(1).max(1000),
  })).max(10),
});

function authorized(req: Request) {
  const expected = process.env.SUPPORT_REVIEW_AGENT_TOKEN?.trim();
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseEvidence(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const tickets = await prisma.ticket.findMany({
    where: {
      verificationStatus: "NEEDS_REVIEW",
      verificationProvider: "seller-support-request",
    },
    orderBy: { createdAt: "asc" },
    take: 5,
    select: {
      id: true,
      title: true,
      venue: true,
      date: true,
      section: true,
      row: true,
      seat: true,
      priceCents: true,
      faceValueCents: true,
      adminFeePaidCents: true,
      currency: true,
      verificationReason: true,
      verificationEvidence: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    tickets: tickets.map(({ verificationEvidence, ...ticket }) => {
      const evidence = parseEvidence(verificationEvidence);
      const receiptProof = evidence.receiptProof as Record<string, unknown> | undefined;
      return {
        ...ticket,
        automatedValidation: evidence.manualReviewRequest ?? null,
        receiptSummary: receiptProof?.ocr ?? null,
        existingRecommendation: evidence.supportAgentRecommendation ?? null,
      };
    }),
  });
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const parsed = recommendationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_RECOMMENDATION" }, { status: 400 });
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: parsed.data.ticketId },
    select: {
      id: true,
      verificationStatus: true,
      verificationProvider: true,
      verificationEvidence: true,
    },
  });
  if (!ticket) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  if (ticket.verificationStatus !== "NEEDS_REVIEW" || ticket.verificationProvider !== "seller-support-request") {
    return NextResponse.json({ ok: false, error: "REVIEW_NOT_OPEN" }, { status: 409 });
  }

  const evidence = parseEvidence(ticket.verificationEvidence);
  const supportAgentRecommendation = {
    ...parsed.data,
    reviewedAt: new Date().toISOString(),
    reviewer: "openclaw-support-review-agent",
    advisoryOnly: true,
  };

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      verificationEvidence: JSON.stringify({ ...evidence, supportAgentRecommendation }),
    },
  });

  await auditLog({
    action: "SUPPORT_REVIEW_AGENT_RECOMMEND",
    targetType: "Ticket",
    targetId: ticket.id,
    metadata: {
      recommendation: parsed.data.recommendation,
      evidenceCount: parsed.data.evidence.length,
      advisoryOnly: true,
    },
    ...createAuditContext(req),
  });

  return NextResponse.json({ ok: true, recommendation: supportAgentRecommendation });
}
