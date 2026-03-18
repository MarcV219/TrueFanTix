import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { createNotification } from "@/lib/notifications/service";
import { createHash } from "crypto";
import { schemas, validateRequest } from "@/lib/validation";

const REFERRAL_SECRET = process.env.REFERRAL_SECRET || "referral-secret";

// Generate unique referral code for user
export function generateReferralCode(userId: string): string {
  const hash = createHash("sha256")
    .update(REFERRAL_SECRET + userId)
    .digest("hex");
  return hash.substring(0, 10).toUpperCase();
}

// GET /api/referrals
// Get user's referral stats and history
export async function GET(req: Request) {
  try {
    const gate = await requireUser();
    if (!gate.user) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHENTICATED" },
        { status: 401 }
      );
    }

    // Get or generate referral code
    let user = await prisma.user.findUnique({
      where: { id: gate.user.id },
      select: {
        id: true,
        referralCode: true,
      },
    });

    if (!user?.referralCode) {
      const referralCode = generateReferralCode(gate.user.id);
      user = await prisma.user.update({
        where: { id: gate.user.id },
        data: { referralCode },
        select: {
          id: true,
          referralCode: true,
        },
      });
    }

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
    const totalAccessTokens = referrals.reduce((sum, r) => sum + (r.creditsAwarded || 0), 0);

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
      referralLink: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/signup?ref=${user.referralCode}`,
    });

  } catch (err) {
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
    const validation = await validateRequest(schemas.referralClaimApi)(req);
    if (!validation.success) return validation.response;

    const body = validation.data;

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

    // Check if user already has a referral
    const existingReferral = await prisma.referral.findUnique({
      where: { referredId: body.newUserId },
    });

    if (existingReferral) {
      return NextResponse.json(
        { ok: false, error: "ALREADY_REFERRED", message: "User already has a referral" },
        { status: 409 }
      );
    }

    // Create referral record
    const referral = await prisma.referral.create({
      data: {
        referrerId: referrer.id,
        referredId: body.newUserId,
        code: body.referralCode.toUpperCase(),
        status: "PENDING",
        creditsAwarded: 0,
      },
    });

    // Notify referrer
    await createNotification({
      userId: referrer.id,
      type: "REFERRAL_SIGNUP",
      message: "Someone used your referral code to sign up! You'll earn access tokens when they make their first purchase.",
      link: "/referrals",
    });

    return NextResponse.json({
      ok: true,
      referral,
      message: "Referral code applied successfully!",
    });

  } catch (err) {
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
    const validation = await validateRequest(schemas.referralCompleteApi)(req);
    if (!validation.success) return validation.response;

    const body = validation.data;

    // Find pending referral
    const referral = await prisma.referral.findUnique({
      where: { referredId: body.referredId },
      include: {
        referrer: true,
      },
    });

    if (!referral || referral.status !== "PENDING") {
      return NextResponse.json(
        { ok: false, error: "NO_PENDING_REFERRAL" },
        { status: 404 }
      );
    }

    // Calculate access tokens (e.g., fixed amount)
    const accessTokenAmount = 10; // 10 access tokens per successful referral

    // Complete the referral and award access tokens
    await prisma.$transaction([
      prisma.referral.update({
        where: { id: referral.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          creditsAwarded: accessTokenAmount,
        },
      }),
      prisma.seller.update({
        where: { id: referral.referrerId },
        data: {
          creditBalanceCredits: {
            increment: accessTokenAmount,
          },
        },
      }),
      prisma.creditTransaction.create({
        data: {
          sellerId: referral.referrerId,
          type: "EARNED",
          amountCredits: accessTokenAmount,
          source: "ADMIN",
          referenceType: "REFERRAL",
          referenceId: referral.id,
          note: `Referral bonus for inviting ${referral.referredId}`,
        },
      }),
    ]);

    // Notify referrer
    await createNotification({
      userId: referral.referrerId,
      type: "REFERRAL_COMPLETED",
      message: `Congratulations! Your referral completed their first purchase. You earned ${accessTokenAmount} access tokens!`,
      link: "/referrals",
    });

    return NextResponse.json({
      ok: true,
      message: `Referral completed. ${accessTokenAmount} access tokens awarded.`,
      creditsAwarded: accessTokenAmount,
    });

  } catch (err) {
    console.error("PATCH /api/referrals failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
