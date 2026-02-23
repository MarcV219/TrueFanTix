// src/lib/auth/guards.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserIdFromSessionCookie } from "@/lib/auth/session";

function jsonError(status: number, error: string, message?: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

export async function requireVerifiedUser(req: Request) {
  // req is kept in the signature for consistency; session is read from cookies()
  // in getUserIdFromSessionCookie().
  void req;

  const userId = await getUserIdFromSessionCookie();
  if (!userId) {
    return { ok: false as const, res: jsonError(401, "NOT_AUTHENTICATED", "Please log in.") };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { seller: true },
  });

  if (!user) {
    return { ok: false as const, res: jsonError(401, "NOT_AUTHENTICATED", "Please log in.") };
  }

  if (user.isBanned) {
    return { ok: false as const, res: jsonError(403, "BANNED", "This account is restricted.") };
  }

  const isVerified = !!user.emailVerifiedAt && !!user.phoneVerifiedAt;
  if (!isVerified) {
    return {
      ok: false as const,
      res: jsonError(403, "NOT_VERIFIED", "Please verify your email and phone number."),
    };
  }

  return { ok: true as const, user };
}

export async function requireSellerApproved(req: Request) {
  const base = await requireVerifiedUser(req);
  if (!base.ok) return base;

  const user = base.user;

  const sellerStatus = user.seller?.status ?? null;
  const isSellerApproved = user.canSell === true && sellerStatus === "APPROVED";

  if (!isSellerApproved) {
    return {
      ok: false as const,
      res: jsonError(403, "SELLER_NOT_APPROVED", "Seller account is not approved."),
    };
  }

  return { ok: true as const, user };
}

export async function requireAdmin(req: Request) {
  const base = await requireVerifiedUser(req);
  if (!base.ok) return base;

  if (base.user.role !== "ADMIN") {
    return { ok: false as const, res: jsonError(403, "FORBIDDEN", "Not authorized.") };
  }

  return { ok: true as const, user: base.user };
}

export function hasInternalCronAuth(req: Request): boolean {
  const configured = process.env.CRON_SECRET?.trim();
  if (!configured) return false;
  const provided = req.headers.get("x-cron-secret")?.trim();
  return !!provided && provided === configured;
}
