import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";

// GET /api/notifications
// List all notifications for the current user
export async function GET(req: Request) {
  try {
    const gate = await requireUser();
    if (!gate.user) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");
    const unreadOnly = searchParams.get("unreadOnly") === "true";

    const where = {
      userId: gate.user.id,
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          type: true,
          message: true,
          link: true,
          isRead: true,
          createdAt: true,
        },
      }),
      prisma.notification.count({ where: { userId: gate.user.id } }),
      prisma.notification.count({ where: { userId: gate.user.id, isRead: false } }),
    ]);

    return NextResponse.json(
      {
        ok: true,
        notifications,
        pagination: {
          total,
          offset,
          limit,
          hasMore: offset + limit < total,
        },
        unreadCount,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/notifications failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not fetch notifications." },
      { status: 500 }
    );
  }
}

// PATCH /api/notifications
// Bulk mark notifications as read
export async function PATCH(req: Request) {
  try {
    const gate = await requireUser();
    if (!gate.user) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      ids?: string[];
      markAll?: boolean;
    } | null;

    if (!body) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Invalid request body." },
        { status: 400 }
      );
    }

    if (body.markAll) {
      // Mark all as read
      const result = await prisma.notification.updateMany({
        where: {
          userId: gate.user.id,
          isRead: false,
        },
        data: {
          isRead: true,
        },
      });

      return NextResponse.json(
        {
          ok: true,
          message: `Marked ${result.count} notifications as read.`,
          count: result.count,
        },
        { status: 200 }
      );
    } else if (body.ids && Array.isArray(body.ids) && body.ids.length > 0) {
      // Mark specific IDs as read
      const result = await prisma.notification.updateMany({
        where: {
          id: { in: body.ids },
          userId: gate.user.id, // Ensure user owns these notifications
        },
        data: {
          isRead: true,
        },
      });

      return NextResponse.json(
        {
          ok: true,
          message: `Marked ${result.count} notifications as read.`,
          count: result.count,
        },
        { status: 200 }
      );
    } else {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Provide 'ids' array or set 'markAll' to true." },
        { status: 400 }
      );
    }
  } catch (err) {
    console.error("PATCH /api/notifications failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not update notifications." },
      { status: 500 }
    );
  }
}

// DELETE /api/notifications
// Delete old/read notifications
export async function DELETE(req: Request) {
  try {
    const gate = await requireUser();
    if (!gate.user) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const olderThanDays = parseInt(searchParams.get("olderThanDays") || "30");
    const readOnly = searchParams.get("readOnly") === "true";

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const where = {
      userId: gate.user.id,
      createdAt: { lt: cutoffDate },
      ...(readOnly ? { isRead: true } : {}),
    };

    const result = await prisma.notification.deleteMany({
      where,
    });

    return NextResponse.json(
      {
        ok: true,
        message: `Deleted ${result.count} notifications.`,
        count: result.count,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("DELETE /api/notifications failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not delete notifications." },
      { status: 500 }
    );
  }
}
