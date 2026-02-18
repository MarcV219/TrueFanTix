export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function preview(text: string, max = 80) {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

export async function GET(req: Request) {
  try {
    // Build an absolute base URL for copy/paste-friendly links.
    const url = new URL(req.url);
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ?? `${url.protocol}//${url.host}`;

    // Optional: lookup a specific comment id
    const commentId = url.searchParams.get("commentId")?.trim() || null;

    const [tickets, sellers, recentComments, commentLookup] = await Promise.all([
      prisma.ticket.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          title: true,
          status: true,
          sellerId: true,
          seller: {
            select: {
              id: true,
              name: true,
              creditBalanceCredits: true,
            },
          },
        },
      }),

      prisma.seller.findMany({
        orderBy: [{ creditBalanceCredits: "desc" }, { name: "asc" }],
        take: 50,
        select: { id: true, name: true, creditBalanceCredits: true },
      }),

      prisma.communityComment.findMany({
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          parentId: true,
          ticketId: true,
          eventId: true,
          isDeleted: true,
          body: true,
          createdAt: true,
          userId: true,
        },
      }),

      commentId
        ? prisma.communityComment.findUnique({
            where: { id: commentId },
            select: {
              id: true,
              parentId: true,
              ticketId: true,
              eventId: true,
              isDeleted: true,
              body: true,
              createdAt: true,
              updatedAt: true,
              userId: true,
            },
          })
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      ok: true,
      note:
        "Dev endpoint to reduce ID confusion while testing. Duplicate data can exist in dev.db from earlier resets/tests.",
      tips: {
        purchaseFormat: "/api/tickets/<TICKET_ID>/purchase",
        listTickets: "/api/tickets",
        listTicketsDebug: "/api/tickets?debug=1",
        listSellers: "/api/sellers",
        listComments: "/api/debug/ids (see recentComments)",
        lookupComment: "/api/debug/ids?commentId=<COMMENT_ID>",
      },

      tickets: tickets.map((t) => ({
        ticketId: t.id,
        title: t.title,
        status: t.status,

        sellerId: t.sellerId,
        sellerName: t.seller?.name ?? null,
        sellerCreditBalanceCredits: t.seller?.creditBalanceCredits ?? null,

        purchaseUrl: `/api/tickets/${t.id}/purchase`,
        purchaseUrlFull: `${baseUrl}/api/tickets/${t.id}/purchase`,
      })),

      sellers: sellers.map((s) => ({
        sellerId: s.id,
        sellerName: s.name,
        creditBalanceCredits: s.creditBalanceCredits,
      })),

      recentComments: recentComments.map((c) => ({
        id: c.id,
        parentId: c.parentId,
        ticketId: c.ticketId,
        eventId: c.eventId,
        isDeleted: c.isDeleted,
        bodyPreview: preview(c.body),
        createdAt: c.createdAt,
        userId: c.userId,
      })),

      commentLookup: commentId
        ? {
            requestedId: commentId,
            found: !!commentLookup,
            comment: commentLookup
              ? {
                  ...commentLookup,
                  bodyPreview: preview(commentLookup.body, 200),
                }
              : null,
          }
        : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: "Debug IDs fetch failed", details: message },
      { status: 500 }
    );
  }
}
