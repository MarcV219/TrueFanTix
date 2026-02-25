import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { updateSellerBadges } from "@/lib/reputation";

// GET /api/reviews
// Get reviews for a seller or by a buyer
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sellerId = searchParams.get("sellerId");
    const orderId = searchParams.get("orderId");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);

    if (sellerId) {
      // Get reviews for a seller
      const [reviews, stats] = await Promise.all([
        prisma.review.findMany({
          where: { sellerId, status: "APPROVED" },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: (page - 1) * limit,
          include: {
            reviewer: {
              select: {
                id: true,
                firstName: true,
                displayName: true,
              },
            },
            order: {
              select: {
                id: true,
                items: {
                  include: {
                    ticket: {
                      select: { title: true },
                    },
                  },
                },
              },
            },
          },
        }),
        prisma.review.aggregate({
          where: { sellerId, status: "APPROVED" },
          _avg: { rating: true },
          _count: { id: true },
        }),
      ]);

      // Get rating distribution
      const distribution = await prisma.review.groupBy({
        by: ["rating"],
        where: { sellerId, status: "APPROVED" },
        _count: { rating: true },
      });

      const ratingDistribution = [5, 4, 3, 2, 1].map(rating => ({
        rating,
        count: distribution.find(d => d.rating === rating)?._count.rating || 0,
      }));

      return NextResponse.json({
        ok: true,
        reviews,
        stats: {
          average: stats._avg.rating || 0,
          total: stats._count.id,
          distribution: ratingDistribution,
        },
        pagination: {
          page,
          limit,
          hasMore: reviews.length === limit,
        },
      });
    }

    if (orderId) {
      // Get review for specific order
      const review = await prisma.review.findUnique({
        where: { orderId },
        include: {
          reviewer: {
            select: { id: true, firstName: true, displayName: true },
          },
        },
      });

      return NextResponse.json({
        ok: true,
        review,
      });
    }

    return NextResponse.json(
      { ok: false, error: "MISSING_PARAMS", message: "sellerId or orderId required" },
      { status: 400 }
    );

  } catch (err) {
    console.error("GET /api/reviews failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

// POST /api/reviews
// Create a review
export async function POST(req: Request) {
  try {
    const gate = await requireUser();
    if (!gate.user) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHENTICATED" },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      orderId: string;
      rating: number;
      title?: string;
      content: string;
      aspects?: {
        communication?: number;
        accuracy?: number;
        delivery?: number;
      };
    } | null;

    if (!body?.orderId || !body?.rating || !body?.content) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "orderId, rating, and content required" },
        { status: 400 }
      );
    }

    // Validate rating
    if (body.rating < 1 || body.rating > 5) {
      return NextResponse.json(
        { ok: false, error: "INVALID_RATING", message: "Rating must be between 1 and 5" },
        { status: 400 }
      );
    }

    // Check order exists and is completed
    const order = await prisma.order.findUnique({
      where: { id: body.orderId },
      include: {
        seller: true,
        buyerSeller: true,
        items: {
          include: {
            ticket: {
              select: { title: true },
            },
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json(
        { ok: false, error: "ORDER_NOT_FOUND" },
        { status: 404 }
      );
    }

    if (order.status !== "COMPLETED") {
      return NextResponse.json(
        { ok: false, error: "ORDER_NOT_COMPLETED", message: "Can only review completed orders" },
        { status: 400 }
      );
    }

    // Verify user is the buyer
    const buyerUser = await prisma.user.findFirst({
      where: { sellerId: order.buyerSellerId },
      select: { id: true },
    });

    if (buyerUser?.id !== gate.user.id) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHORIZED", message: "Only the buyer can review" },
        { status: 403 }
      );
    }

    // Check if review already exists
    const existingReview = await prisma.review.findUnique({
      where: { orderId: body.orderId },
    });

    if (existingReview) {
      return NextResponse.json(
        { ok: false, error: "REVIEW_EXISTS", message: "You have already reviewed this order" },
        { status: 409 }
      );
    }

    // Create review
    const review = await prisma.review.create({
      data: {
        orderId: body.orderId,
        sellerId: order.sellerId,
        reviewerId: gate.user.id,
        rating: body.rating,
        title: body.title,
        content: body.content,
        aspects: body.aspects,
        status: "APPROVED", // Auto-approve for now, could add moderation
      },
      include: {
        reviewer: {
          select: { id: true, firstName: true, displayName: true },
        },
      },
    });

    // Update seller rating
    const sellerStats = await prisma.review.aggregate({
      where: { sellerId: order.sellerId, status: "APPROVED" },
      _avg: { rating: true },
      _count: { id: true },
    });

    await prisma.seller.update({
      where: { id: order.sellerId },
      data: {
        rating: sellerStats._avg.rating || 0,
        reviews: sellerStats._count.id,
      },
    });

    // Update seller badges
    await updateSellerBadges(order.sellerId);

    return NextResponse.json({
      ok: true,
      review,
      message: "Review submitted successfully",
    }, { status: 201 });

  } catch (err) {
    console.error("POST /api/reviews failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

// PATCH /api/reviews
// Update a review (within 24 hours)
export async function PATCH(req: Request) {
  try {
    const gate = await requireUser();
    if (!gate.user) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHENTICATED" },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      reviewId: string;
      rating?: number;
      title?: string;
      content?: string;
    } | null;

    if (!body?.reviewId) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const review = await prisma.review.findFirst({
      where: {
        id: body.reviewId,
        reviewerId: gate.user.id,
      },
    });

    if (!review) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND" },
        { status: 404 }
      );
    }

    // Check if within 24 hours
    const hoursSinceCreated = (Date.now() - new Date(review.createdAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceCreated > 24) {
      return NextResponse.json(
        { ok: false, error: "EDIT_WINDOW_EXPIRED", message: "Reviews can only be edited within 24 hours" },
        { status: 400 }
      );
    }

    const updatedReview = await prisma.review.update({
      where: { id: body.reviewId },
      data: {
        rating: body.rating,
        title: body.title,
        content: body.content,
      },
    });

    // Update seller rating if rating changed
    if (body.rating && body.rating !== review.rating) {
      const sellerStats = await prisma.review.aggregate({
        where: { sellerId: review.sellerId, status: "APPROVED" },
        _avg: { rating: true },
      });

      await prisma.seller.update({
        where: { id: review.sellerId },
        data: { rating: sellerStats._avg.rating || 0 },
      });
    }

    return NextResponse.json({
      ok: true,
      review: updatedReview,
    });

  } catch (err) {
    console.error("PATCH /api/reviews failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

// DELETE /api/reviews
// Delete a review
export async function DELETE(req: Request) {
  try {
    const gate = await requireUser();
    if (!gate.user) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHENTICATED" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const reviewId = searchParams.get("id");

    if (!reviewId) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const review = await prisma.review.findFirst({
      where: {
        id: reviewId,
        reviewerId: gate.user.id,
      },
    });

    if (!review) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND" },
        { status: 404 }
      );
    }

    await prisma.review.delete({
      where: { id: reviewId },
    });

    // Recalculate seller rating
    const sellerStats = await prisma.review.aggregate({
      where: { sellerId: review.sellerId, status: "APPROVED" },
      _avg: { rating: true },
      _count: { id: true },
    });

    await prisma.seller.update({
      where: { id: review.sellerId },
      data: {
        rating: sellerStats._avg.rating || 0,
        reviews: sellerStats._count.id,
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Review deleted",
    });

  } catch (err) {
    console.error("DELETE /api/reviews failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
