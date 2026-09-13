import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { updateSellerBadges } from "@/lib/reputation";
import { schemas, validateRequest } from "@/lib/validation";
import {
  ManagedAccountReviewWriteError,
  runOrdinaryReviewWrite,
} from "@/lib/reviews/ordinary-author";

function stagingConsoleOnlyError() {
  const response = NextResponse.json(
    {
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
      message: "This managed account is restricted to the staging console.",
    },
    { status: 403 },
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

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
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const validation = await validateRequest(schemas.reviewCreateApi)(req);
    if (!validation.success) return validation.response;

    const body = validation.data;

    let result;
    try {
      result = await runOrdinaryReviewWrite(gate.user.id, async (tx) => {
        // Check order exists and is completed while the reviewer identity is locked.
        const order = await tx.order.findUnique({
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

        // Verify user is the buyer.
        const buyerUser = await tx.user.findFirst({
          where: { sellerId: order.buyerSellerId },
          select: { id: true },
        });

        if (buyerUser?.id !== gate.user.id) {
          return NextResponse.json(
            { ok: false, error: "UNAUTHORIZED", message: "Only the buyer can review" },
            { status: 403 }
          );
        }

        // Check if review already exists.
        const existingReview = await tx.review.findUnique({
          where: { orderId: body.orderId },
        });

        if (existingReview) {
          return NextResponse.json(
            { ok: false, error: "REVIEW_EXISTS", message: "You have already reviewed this order" },
            { status: 409 }
          );
        }

        // Create review.
        const review = await tx.review.create({
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

        // Keep the denormalized seller totals atomic with the review write.
        const sellerStats = await tx.review.aggregate({
          where: { sellerId: order.sellerId, status: "APPROVED" },
          _avg: { rating: true },
          _count: { id: true },
        });

        await tx.seller.update({
          where: { id: order.sellerId },
          data: {
            rating: sellerStats._avg.rating || 0,
            reviews: sellerStats._count.id,
          },
        });

        return { review, sellerId: order.sellerId };
      });
    } catch (error) {
      if (error instanceof ManagedAccountReviewWriteError) return stagingConsoleOnlyError();
      throw error;
    }

    if (result instanceof Response) return result;

    // Update seller badges
    await updateSellerBadges(result.sellerId);

    return NextResponse.json({
      ok: true,
      review: result.review,
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
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const validation = await validateRequest(schemas.reviewUpdateApi)(req);
    if (!validation.success) return validation.response;

    const body = validation.data;

    let result;
    try {
      result = await runOrdinaryReviewWrite(gate.user.id, async (tx) => {
        const review = await tx.review.findFirst({
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

        // Check if within 24 hours.
        const hoursSinceCreated = (Date.now() - new Date(review.createdAt).getTime()) / (1000 * 60 * 60);
        if (hoursSinceCreated > 24) {
          return NextResponse.json(
            { ok: false, error: "EDIT_WINDOW_EXPIRED", message: "Reviews can only be edited within 24 hours" },
            { status: 400 }
          );
        }

        const updatedReview = await tx.review.update({
          where: { id: body.reviewId },
          data: {
            rating: body.rating,
            title: body.title,
            content: body.content,
          },
        });

        // Keep the denormalized seller rating atomic with the review write.
        if (body.rating && body.rating !== review.rating) {
          const sellerStats = await tx.review.aggregate({
            where: { sellerId: review.sellerId, status: "APPROVED" },
            _avg: { rating: true },
          });

          await tx.seller.update({
            where: { id: review.sellerId },
            data: { rating: sellerStats._avg.rating || 0 },
          });
        }

        return updatedReview;
      });
    } catch (error) {
      if (error instanceof ManagedAccountReviewWriteError) return stagingConsoleOnlyError();
      throw error;
    }

    if (result instanceof Response) return result;

    return NextResponse.json({
      ok: true,
      review: result,
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
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const { searchParams } = new URL(req.url);
    const parsed = schemas.reviewDeleteQuery.safeParse({ id: searchParams.get("id") });
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }
    const reviewId = parsed.data.id;

    let result;
    try {
      result = await runOrdinaryReviewWrite(gate.user.id, async (tx) => {
        const review = await tx.review.findFirst({
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

        await tx.review.delete({
          where: { id: reviewId },
        });

        // Keep the denormalized seller totals atomic with the review deletion.
        const sellerStats = await tx.review.aggregate({
          where: { sellerId: review.sellerId, status: "APPROVED" },
          _avg: { rating: true },
          _count: { id: true },
        });

        await tx.seller.update({
          where: { id: review.sellerId },
          data: {
            rating: sellerStats._avg.rating || 0,
            reviews: sellerStats._count.id,
          },
        });

        return true;
      });
    } catch (error) {
      if (error instanceof ManagedAccountReviewWriteError) return stagingConsoleOnlyError();
      throw error;
    }

    if (result instanceof Response) return result;

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
