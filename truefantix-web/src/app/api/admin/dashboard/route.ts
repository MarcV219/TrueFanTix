export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { loadAdminQueueCounts } from "@/lib/adminQueueService";

function centsToDollars(cents: number | null | undefined) {
  return Number(((cents ?? 0) / 100).toFixed(2));
}

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const now = new Date();
  const today = startOfDay(now);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    queueCounts,
    pendingOrders,
    paidOrders,
    newUsers24h,
    newTickets24h,
    ordersToday,
    salesToday,
    recentOrders,
    recentUsers,
    recentAuditLogs,
  ] = await Promise.all([
    loadAdminQueueCounts(now),
    prisma.order.count({ where: { status: "PENDING" } }),
    prisma.order.count({ where: { status: "PAID" } }),
    prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.ticket.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.order.count({ where: { createdAt: { gte: today } } }),
    prisma.order.aggregate({
      where: { createdAt: { gte: today }, status: { in: ["PAID", "DELIVERED", "COMPLETED"] } },
      _sum: {
        amountCents: true,
        adminFeeCents: true,
        adminFeeTaxCents: true,
        totalCents: true,
      },
    }),
    prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        status: true,
        createdAt: true,
        amountCents: true,
        adminFeeCents: true,
        adminFeeTaxCents: true,
        totalCents: true,
        items: {
          take: 1,
          select: {
            ticket: {
              select: { title: true, venue: true, date: true },
            },
          },
        },
      },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        createdAt: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        canBuy: true,
        canSell: true,
        isBanned: true,
      },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        createdAt: true,
        action: true,
        userId: true,
        targetType: true,
        targetId: true,
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    generatedAt: now.toISOString(),
    queues: {
      pendingTicketVerification: queueCounts.pending,
      needsReviewTickets: queueCounts.needsReview,
      pendingCatalogRequests: queueCounts.catalogRequests,
      pendingSellerStripe: queueCounts.sellerStripe,
      suspendedSellers: queueCounts.suspendedSellers,
      openEscrows: queueCounts.openEscrows,
      disputedOrders: queueCounts.disputes,
      transferProofReviews: queueCounts.transferProofReviews,
      expiredReservations: queueCounts.expiredReservations,
      pendingOrders,
      paidOrders,
      failedPayments: queueCounts.failedPayments,
      pendingPayouts: queueCounts.pendingPayouts,
      failedEmails: queueCounts.failedEmails,
      hiddenForumThreads: queueCounts.hiddenForumThreads,
      hiddenForumPosts: queueCounts.hiddenForumPosts,
      moderatedForumItems: queueCounts.moderatedForumItems,
    },
    activity: {
      newUsers24h,
      newTickets24h,
      ordersToday,
      salesToday: {
        ticketSubtotal: centsToDollars(salesToday._sum.amountCents),
        adminFees: centsToDollars(salesToday._sum.adminFeeCents),
        adminFeeTax: centsToDollars(salesToday._sum.adminFeeTaxCents),
        total: centsToDollars(salesToday._sum.totalCents),
      },
    },
    recent: {
      orders: recentOrders.map((order) => ({
        ...order,
        ticket: order.items[0]?.ticket ?? null,
        items: undefined,
      })),
      users: recentUsers.map((user) => ({
        ...user,
        isVerified: !!user.emailVerifiedAt && !!user.phoneVerifiedAt,
      })),
      auditLogs: recentAuditLogs,
    },
  });
}
