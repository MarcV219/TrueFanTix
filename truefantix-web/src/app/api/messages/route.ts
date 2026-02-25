import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { sendNotificationToUser } from "@/lib/websocket";
import { createNotification } from "@/lib/notifications/service";

// GET /api/messages
// Get conversations or messages
export async function GET(req: Request) {
  try {
    const gate = await requireUser();
    if (!gate.user) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHENTICATED" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get("conversationId");
    const orderId = searchParams.get("orderId");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

    if (conversationId) {
      // Get messages for a specific conversation
      const messages = await prisma.message.findMany({
        where: {
          conversationId,
          conversation: {
            participants: {
              some: { userId: gate.user.id },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: (page - 1) * limit,
        include: {
          sender: {
            select: { id: true, firstName: true, lastName: true, displayName: true },
          },
          attachments: true,
        },
      });

      // Mark messages as read
      await prisma.message.updateMany({
        where: {
          conversationId,
          senderId: { not: gate.user.id },
          readAt: null,
        },
        data: { readAt: new Date() },
      });

      return NextResponse.json({
        ok: true,
        messages: messages.reverse(), // Return in chronological order
      });
    }

    // Get all conversations for user
    const conversations = await prisma.conversation.findMany({
      where: {
        participants: {
          some: { userId: gate.user.id },
        },
      },
      orderBy: { updatedAt: "desc" },
      include: {
        participants: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, displayName: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            sender: {
              select: { id: true, firstName: true },
            },
          },
        },
        order: {
          select: { id: true, status: true },
        },
        _count: {
          select: {
            messages: {
              where: {
                senderId: { not: gate.user.id },
                readAt: null,
              },
            },
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      conversations: conversations.map(conv => ({
        ...conv,
        unreadCount: conv._count.messages,
        lastMessage: conv.messages[0] || null,
        participants: conv.participants.map(p => p.user),
      })),
    });

  } catch (err) {
    console.error("GET /api/messages failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

// POST /api/messages
// Send a message
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
      conversationId?: string;
      orderId?: string;
      recipientId?: string;
      content: string;
      attachments?: { type: string; url: string; name?: string }[];
    } | null;

    if (!body?.content || (!body?.conversationId && !body?.orderId && !body?.recipientId)) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "content and recipient required" },
        { status: 400 }
      );
    }

    let conversationId = body.conversationId;

    // Create conversation if it doesn't exist
    if (!conversationId) {
      if (body.orderId) {
        // Find or create conversation for order
        const order = await prisma.order.findUnique({
          where: { id: body.orderId },
          select: { sellerId: true, buyerSellerId: true },
        });

        if (!order) {
          return NextResponse.json(
            { ok: false, error: "ORDER_NOT_FOUND" },
            { status: 404 }
          );
        }

        // Get user IDs from seller IDs (User model has sellerId field)
        const [sellerUser, buyerUser] = await Promise.all([
          prisma.user.findFirst({ where: { sellerId: order.sellerId }, select: { id: true } }),
          prisma.user.findFirst({ where: { sellerId: order.buyerSellerId }, select: { id: true } }),
        ]);

        if (!sellerUser?.id || !buyerUser?.id) {
          return NextResponse.json(
            { ok: false, error: "INVALID_ORDER" },
            { status: 400 }
          );
        }

        const participantIds = [sellerUser.id, buyerUser.id];

        // Check for existing conversation
        const existingConv = await prisma.conversation.findFirst({
          where: {
            orderId: body.orderId,
            participants: {
              every: { userId: { in: participantIds } },
            },
          },
        });

        if (existingConv) {
          conversationId = existingConv.id;
        } else {
          // Create new conversation
          const newConv = await prisma.conversation.create({
            data: {
              orderId: body.orderId,
              participants: {
                create: participantIds.map(userId => ({ userId })),
              },
            },
          });
          conversationId = newConv.id;
        }
      } else if (body.recipientId) {
        // Check for existing conversation between users
        const existingConv = await prisma.conversation.findFirst({
          where: {
            AND: [
              { participants: { some: { userId: gate.user.id } } },
              { participants: { some: { userId: body.recipientId } } },
            ],
          },
        });

        if (existingConv) {
          conversationId = existingConv.id;
        } else {
          const newConv = await prisma.conversation.create({
            data: {
              participants: {
                create: [
                  { userId: gate.user.id },
                  { userId: body.recipientId },
                ],
              },
            },
          });
          conversationId = newConv.id;
        }
      }
    }

    if (!conversationId) {
      return NextResponse.json(
        { ok: false, error: "CONVERSATION_ERROR" },
        { status: 500 }
      );
    }

    // Verify user is participant
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        participants: { some: { userId: gate.user.id } },
      },
      include: {
        participants: { select: { userId: true } },
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", message: "Conversation not found" },
        { status: 404 }
      );
    }

    // Create message
    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId: gate.user.id,
        content: body.content,
        attachments: body.attachments
          ? { create: body.attachments }
          : undefined,
      },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true },
        },
        attachments: true,
      },
    });

    // Update conversation
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    // Send real-time notification to other participants
    const otherParticipants = conversation.participants.filter(
      p => p.userId !== gate.user.id
    );

    for (const participant of otherParticipants) {
      // WebSocket notification
      sendNotificationToUser(participant.userId, {
        type: "message:new",
        data: message,
      });

      // In-app notification
      await createNotification({
        userId: participant.userId,
        type: "NEW_MESSAGE",
        message: `New message from ${message.sender.firstName}: ${body.content.slice(0, 50)}...`,
        link: `/messages?conversation=${conversationId}`,
      });
    }

    return NextResponse.json({
      ok: true,
      message,
    }, { status: 201 });

  } catch (err) {
    console.error("POST /api/messages failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

// DELETE /api/messages
// Delete a message (soft delete)
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
    const messageId = searchParams.get("id");

    if (!messageId) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        senderId: gate.user.id,
      },
    });

    if (!message) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND" },
        { status: 404 }
      );
    }

    await prisma.message.update({
      where: { id: messageId },
      data: {
        deletedAt: new Date(),
        content: "[deleted]",
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Message deleted",
    });

  } catch (err) {
    console.error("DELETE /api/messages failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
