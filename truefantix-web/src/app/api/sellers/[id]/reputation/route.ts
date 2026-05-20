import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { calculateSellerReputation, calculateFraudRisk } from "@/lib/reputation";
import { schemas, validateRequest } from "@/lib/validation";

// GET /api/sellers/:id/reputation
// Get seller's reputation score
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sellerId } = await params;

    // Check if seller exists
    const seller = await prisma.seller.findUnique({
      where: { id: sellerId },
      select: {
        id: true,
        name: true,
        rating: true,
        reviews: true,
        status: true,
        createdAt: true,
      },
    });

    if (!seller) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", message: "Seller not found." },
        { status: 404 }
      );
    }

    // Calculate reputation
    const reputation = await calculateSellerReputation(sellerId);

    return NextResponse.json({
      ok: true,
      seller: {
        ...seller,
        memberSince: seller.createdAt,
      },
      reputation,
    }, { status: 200 });

  } catch (err) {
    console.error("GET /api/sellers/:id/reputation failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not calculate reputation." },
      { status: 500 }
    );
  }
}

// POST /api/sellers/:id/fraud-check
// Check fraud risk for a potential transaction
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireVerifiedUser(req);
  if (!gate.ok) return gate.res;

  try {
    const { id: sellerId } = await params;

    const validation = await validateRequest(schemas.sellerFraudCheckApi)(req);
    if (!validation.success) return validation.response;

    const body = validation.data;

    // Calculate fraud risk
    const fraudCheck = await calculateFraudRisk({
      sellerId,
      buyerId: gate.user.id,
      ticketId: body.ticketId,
      amountCents: body.amountCents,
    });

    return NextResponse.json({
      ok: true,
      fraudCheck,
    }, { status: 200 });

  } catch (err) {
    console.error("POST /api/sellers/:id/fraud-check failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not perform fraud check." },
      { status: 500 }
    );
  }
}
