import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { createHash } from "crypto";
import { schemas, validateRequest } from "@/lib/validation";
import {
  ManagedAccountReferralWriteError,
  runOrdinaryReferralWrite,
} from "@/lib/referrals/ordinary-user";

function stagingConsoleOnlyResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
      message: "This managed account is restricted to the staging console.",
    },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}

function getReferralSecret(): string {
  const secret = process.env.REFERRAL_SECRET || process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("REFERRAL_SECRET or SESSION_SECRET must be configured with a strong secret.");
  }
  return secret;
}

function getAppOrigin(req: Request): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_ORIGIN;
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.NODE_ENV !== "production") return new URL(req.url).origin;
  return null;
}

// Generate unique referral code for user
export function generateReferralCode(userId: string): string {
  const hash = createHash("sha256")
    .update(getReferralSecret() + userId)
    .digest("hex");
  return hash.substring(0, 10).toUpperCase();
}

// GET /api/referrals
// Get user's referral stats and history
export async function GET(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    // Get or generate referral code
    const user = await runOrdinaryReferralWrite([gate.user.id], async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: gate.user.id },
        select: {
          id: true,
          referralCode: true,
        },
      });

      if (!current?.referralCode) {
        return tx.user.update({
          where: { id: gate.user.id },
          data: { referralCode: generateReferralCode(gate.user.id) },
          select: {
            id: true,
            referralCode: true,
          },
        });
      }
      return current;
    });

    // Get referral stats
    const [referrals, stats] = await Promise.all([
      prisma.referral.findMany({
        where: { referrerId: gate.user.id },
        orderBy: { createdAt: "desc" },
        include: {
          referred: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              createdAt: true,
            },
          },
        },
      }),
      prisma.referral.aggregate({
        where: { referrerId: gate.user.id },
        _count: { id: true },
      }),
    ]);

    // Calculate pending and completed
    const completedReferrals = referrals.filter(r => r.status === "COMPLETED").length;
    const pendingReferrals = referrals.filter(r => r.status === "PENDING").length;
    const totalAccessTokens = referrals.reduce((sum, r) => sum + (r.accessTokensAwarded || 0), 0);

    const origin = getAppOrigin(req);
    if (!origin) {
      return NextResponse.json(
        { ok: false, error: "SERVER_MISCONFIGURED", message: "Application origin is not configured." },
        { status: 503 }
      );
    }

    return NextResponse.json({
      ok: true,
      referralCode: user.referralCode,
      stats: {
        total: stats._count.id,
        completed: completedReferrals,
        pending: pendingReferrals,
        totalAccessTokensEarned: totalAccessTokens,
      },
      referrals,
      referralLink: `${origin}/signup?ref=${user.referralCode}`,
    });

  } catch (err) {
    if (err instanceof ManagedAccountReferralWriteError) {
      return stagingConsoleOnlyResponse();
    }
    console.error("GET /api/referrals failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

// POST /api/referrals/claim
// Claim a referral code during signup
export async function POST(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const validation = await validateRequest(schemas.referralClaimApi)(req);
    if (!validation.success) return validation.response;

    const body = validation.data;

    if (body.newUserId !== gate.user.id) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "Referral can only be claimed for the logged-in user." },
        { status: 403 }
      );
    }

    // Find referrer
    const referrer = await prisma.user.findUnique({
      where: { referralCode: body.referralCode.toUpperCase() },
      select: { id: true, firstName: true, email: true },
    });

    if (!referrer) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CODE", message: "Invalid referral code" },
        { status: 400 }
      );
    }

    // Can't refer yourself
    if (referrer.id === body.newUserId) {
      return NextResponse.json(
        { ok: false, error: "SELF_REFERRAL", message: "Cannot refer yourself" },
        { status: 400 }
      );
    }

    const result = await runOrdinaryReferralWrite(
      [body.newUserId, referrer.id],
      async (tx) => {
        const currentReferrer = await tx.user.findUnique({
          where: { referralCode: body.referralCode.toUpperCase() },
          select: { id: true },
        });
        if (!currentReferrer || currentReferrer.id !== referrer.id) {
          return { error: "INVALID_CODE" as const };
        }

        const existingReferral = await tx.referral.findUnique({
          where: { referredId: body.newUserId },
        });
        if (existingReferral) return { error: "ALREADY_REFERRED" as const };

        const referral = await tx.referral.create({
          data: {
            referrerId: referrer.id,
            referredId: body.newUserId,
            code: body.referralCode.toUpperCase(),
            status: "PENDING",
            accessTokensAwarded: 0,
          },
        });

        await tx.notification.create({
          data: {
            userId: referrer.id,
            type: "REFERRAL_SIGNUP",
            message: "Someone used your referral code to sign up! You'll earn access tokens when they make their first purchase.",
            link: "/referrals",
            isRead: false,
          },
        });

        return { referral };
      },
    );

    if ("error" in result && result.error === "INVALID_CODE") {
      return NextResponse.json(
        { ok: false, error: "INVALID_CODE", message: "Invalid referral code" },
        { status: 400 },
      );
    }

    if ("error" in result) {
      return NextResponse.json(
        { ok: false, error: "ALREADY_REFERRED", message: "User already has a referral" },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      referral: result.referral,
      message: "Referral code applied successfully!",
    });

  } catch (err) {
    if (err instanceof ManagedAccountReferralWriteError) {
      return stagingConsoleOnlyResponse();
    }
    console.error("POST /api/referrals/claim failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

// PATCH /api/referrals
// Complete referral when referred user makes first purchase
export async function PATCH(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return gate.res;

    const validation = await validateRequest(schemas.referralCompleteApi)(req);
    if (!validation.success) return validation.response;

    const body = validation.data;

    // Resolve the participant IDs before acquiring their ordered row locks.
    const candidate = await prisma.referral.findUnique({
      where: { referredId: body.referredId },
      select: { id: true, referrerId: true, referredId: true },
    });

    if (!candidate) {
      return NextResponse.json(
        { ok: false, error: "NO_PENDING_REFERRAL" },
        { status: 404 }
      );
    }

    // Calculate access tokens (e.g., fixed amount)
    const accessTokenAmount = 10; // 10 access tokens per successful referral

    const completed = await runOrdinaryReferralWrite(
      [gate.user.id, candidate.referrerId, candidate.referredId],
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Referral" WHERE "id" = ${candidate.id} FOR UPDATE`;
        const referral = await tx.referral.findUnique({
          where: { id: candidate.id },
          include: { referrer: { select: { sellerId: true } } },
        });
        if (!referral || referral.status !== "PENDING") return false;
        if (!referral.referrer.sellerId) return false;

        await tx.referral.update({
          where: { id: referral.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            accessTokensAwarded: accessTokenAmount,
          },
        });
        await tx.seller.update({
          where: { id: referral.referrer.sellerId },
          data: { accessTokenBalance: { increment: accessTokenAmount } },
        });
        await tx.accessTokenTransaction.create({
          data: {
            sellerId: referral.referrer.sellerId,
            type: "EARNED",
            amountAccessTokens: accessTokenAmount,
            source: "ADMIN",
            referenceType: "REFERRAL",
            referenceId: referral.id,
            note: `Referral bonus for inviting ${referral.referredId}`,
          },
        });
        await tx.notification.create({
          data: {
            userId: referral.referrerId,
            type: "REFERRAL_COMPLETED",
            message: `Congratulations! Your referral completed their first purchase. You earned ${accessTokenAmount} access tokens!`,
            link: "/referrals",
            isRead: false,
          },
        });
        return true;
      },
    );

    if (!completed) {
      return NextResponse.json(
        { ok: false, error: "NO_PENDING_REFERRAL" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: `Referral completed. ${accessTokenAmount} access tokens awarded.`,
      accessTokensAwarded: accessTokenAmount,
    });

  } catch (err) {
    if (err instanceof ManagedAccountReferralWriteError) {
      return stagingConsoleOnlyResponse();
    }
    console.error("PATCH /api/referrals failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
