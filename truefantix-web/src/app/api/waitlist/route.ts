import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { createNotification } from "@/lib/notifications/service";

// GET /api/waitlist
// Get user's waitlist entries
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
    const status = searchParams.get("status") || "ACTIVE";

    const entries = await prisma.waitlistEntry.findMany({
      where: {
        userId: gate.user.id,
        status: status as any,
      },
      orderBy: { createdAt: "desc" },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            venue: true,
            date: true,
            selloutStatus: true,
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      entries,
    }, { status: 200 });

  } catch (err) {
    console.error("GET /api/waitlist failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not fetch waitlist." },
      { status: 500 }
    );
  }
}

// POST /api/waitlist
// Join waitlist for an event
export async function POST(req: Request) {
  try {
    const gate = await requireUser();
    if (!gate.user) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHENTICATED", message: "User not authenticated." },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      eventId?: string;
      maxPrice?: number;
      notes?: string;
    } | null;

    if (!body?.eventId) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "eventId required." },
        { status: 400 }
      );
    }

    // Check if event exists
    const event = await prisma.event.findUnique({
      where: { id: body.eventId },
      select: {
        id: true,
        title: true,
        venue: true,
        date: true,
        selloutStatus: true,
      },
    });

    if (!event) {
      return NextResponse.json(
        { ok: false, error: "EVENT_NOT_FOUND", message: "Event not found." },
        { status: 404 }
      );
    }

    // Check if already on waitlist
    const existingEntry = await prisma.waitlistEntry.findFirst({
      where: {
        userId: gate.user.id,
        eventId: body.eventId,
        status: "ACTIVE",
      },
    });

    if (existingEntry) {
      return NextResponse.json(
        { ok: false, error: "ALREADY_WAITLISTED", message: "You're already on the waitlist for this event." },
        { status: 409 }
      );
    }

    // Create waitlist entry
    const entry = await prisma.waitlistEntry.create({
      data: {
        userId: gate.user.id,
        eventId: body.eventId,
        maxPriceCents: body.maxPrice ? Math.round(body.maxPrice * 100) : null,
        notes: body.notes,
        status: "ACTIVE",
        notifiedAt: null,
      },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            venue: true,
            date: true,
          },
        },
      },
    });

    // Send confirmation notification
    await createNotification({
      userId: gate.user.id,
      type: "WAITLIST_JOINED",
      message: `You're on the waitlist for "${event.title}". We'll notify you when tickets become available!`,
      link: `/events/${event.id}`,
    });

    return NextResponse.json({
      ok: true,
      entry: {
        ...entry,
        maxPrice: entry.maxPriceCents ? entry.maxPriceCents / 100 : null,
      },
      message: "You've joined the waitlist! We'll notify you when tickets become available.",
    }, { status: 201 });

  } catch (err) {
    console.error("POST /api/waitlist failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not join waitlist." },
      { status: 500 }
    );
  }
}

// DELETE /api/waitlist
// Leave waitlist
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
    const entryId = searchParams.get("id");

    if (!entryId) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Entry ID required." },
        { status: 400 }
      );
    }

    // Verify ownership
    const entry = await prisma.waitlistEntry.findFirst({
      where: {
        id: entryId,
        userId: gate.user.id,
      },
    });

    if (!entry) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", message: "Waitlist entry not found." },
        { status: 404 }
      );
    }

    await prisma.waitlistEntry.update({
      where: { id: entryId },
      data: { status: "CANCELLED" },
    });

    return NextResponse.json({
      ok: true,
      message: "You've been removed from the waitlist.",
    }, { status: 200 });

  } catch (err) {
    console.error("DELETE /api/waitlist failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not leave waitlist." },
      { status: 500 }
    );
  }
}

/**
 * Check waitlist and notify users when tickets become available
 * This should be called when a new ticket is listed
 */
export async function checkWaitlistAndNotify(eventId: string, ticketPriceCents: number) {
  try {
    const waitlistEntries = await prisma.waitlistEntry.findMany({
      where: {
        eventId,
        status: "ACTIVE",
        OR: [
          { maxPriceCents: null },
          { maxPriceCents: { gte: ticketPriceCents } },
        ],
        notifiedAt: null, // Don't notify twice
      },
      include: {
        user: {
          select: { id: true, email: true, firstName: true },
        },
        event: {
          select: { id: true, title: true },
        },
      },
    });

    for (const entry of waitlistEntries) {
      // Send notification
      await createNotification({
        userId: entry.user.id,
        type: "WAITLIST_AVAILABLE",
        message: `Good news! Tickets for "${entry.event.title}" are now available within your price range.`,
        link: `/events/${eventId}`,
      });

      // Mark as notified
      await prisma.waitlistEntry.update({
        where: { id: entry.id },
        data: { notifiedAt: new Date() },
      });
    }

    return { ok: true, notifiedCount: waitlistEntries.length };

  } catch (err) {
    console.error("checkWaitlistAndNotify failed:", err);
    return { ok: false, error: err };
  }
}
