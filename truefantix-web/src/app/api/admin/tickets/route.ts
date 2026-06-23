export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";

const TICKET_STATUSES = new Set(["AVAILABLE", "RESERVED", "SOLD", "WITHDRAWN"]);
const VERIFICATION_STATUSES = new Set(["PENDING", "VERIFIED", "REJECTED", "NEEDS_REVIEW"]);

function clean(value: string | null) {
  return String(value ?? "").trim();
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const url = new URL(req.url);
  const q = clean(url.searchParams.get("q"));
  const status = clean(url.searchParams.get("status")).toUpperCase();
  const verificationStatus = clean(url.searchParams.get("verificationStatus")).toUpperCase();
  const take = Math.min(Math.max(Number(url.searchParams.get("take") || 50), 1), 100);

  const where: Prisma.TicketWhereInput = {};
  if (TICKET_STATUSES.has(status)) where.status = status as any;
  if (VERIFICATION_STATUSES.has(verificationStatus)) where.verificationStatus = verificationStatus as any;
  if (q) {
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { title: { contains: q, mode: "insensitive" } },
      { venue: { contains: q, mode: "insensitive" } },
      { row: { contains: q, mode: "insensitive" } },
      { seat: { contains: q, mode: "insensitive" } },
      { seller: { name: { contains: q, mode: "insensitive" } } },
      { seller: { user: { email: { contains: q, mode: "insensitive" } } } },
      { orderItems: { some: { orderId: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const tickets = await prisma.ticket.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      title: true,
      venue: true,
      date: true,
      row: true,
      seat: true,
      priceCents: true,
      faceValueCents: true,
      adminFeePaidCents: true,
      currency: true,
      status: true,
      verificationStatus: true,
      verificationScore: true,
      verificationReason: true,
      verificationProvider: true,
      verifiedAt: true,
      createdAt: true,
      seller: {
        select: {
          id: true,
          name: true,
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      },
      orderItems: {
        orderBy: { createdAt: "desc" },
        take: 3,
        select: {
          id: true,
          orderId: true,
          priceCents: true,
          currency: true,
          order: { select: { id: true, status: true, createdAt: true, totalCents: true, currency: true } },
        },
      },
    },
  });

  return NextResponse.json({ ok: true, q, status, verificationStatus, tickets });
}
