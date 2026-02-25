import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { createNotification } from "@/lib/notifications/service";

// GET /api/price-alerts
// List user's price alerts
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

    const alerts = await prisma.priceAlert.findMany({
      where: {
        userId: gate.user.id,
        status: status as any,
      },
      orderBy: { createdAt: "desc" },
      include: {
        ticket: {
          select: {
            id: true,
            title: true,
            priceCents: true,
            venue: true,
            date: true,
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      alerts: alerts.map(alert => ({
        ...alert,
        targetPrice: alert.targetPriceCents / 100,
        currentPrice: alert.ticket?.priceCents ? alert.ticket.priceCents / 100 : null,
      })),
    }, { status: 200 });

  } catch (err) {
    console.error("GET /api/price-alerts failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not fetch price alerts." },
      { status: 500 }
    );
  }
}

// POST /api/price-alerts
// Create a new price alert
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
      ticketId?: string;
      targetPrice?: number;
      eventQuery?: string;
    } | null;

    if (!body || (!body.ticketId && !body.eventQuery)) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Provide ticketId or eventQuery." },
        { status: 400 }
      );
    }

    if (body.ticketId) {
      // Alert for specific ticket
      const ticket = await prisma.ticket.findUnique({
        where: { id: body.ticketId },
        select: { id: true, title: true, priceCents: true, status: true },
      });

      if (!ticket || ticket.status !== "AVAILABLE") {
        return NextResponse.json(
          { ok: false, error: "TICKET_NOT_FOUND", message: "Ticket not found or not available." },
          { status: 404 }
        );
      }

      // Check if alert already exists
      const existingAlert = await prisma.priceAlert.findFirst({
        where: {
          userId: gate.user.id,
          ticketId: body.ticketId,
          status: "ACTIVE",
        },
      });

      if (existingAlert) {
        return NextResponse.json(
          { ok: false, error: "ALERT_EXISTS", message: "You already have an active alert for this ticket." },
          { status: 409 }
        );
      }

      const alert = await prisma.priceAlert.create({
        data: {
          userId: gate.user.id,
          ticketId: body.ticketId,
          targetPriceCents: body.targetPrice ? Math.round(body.targetPrice * 100) : null,
          originalPriceCents: ticket.priceCents,
          status: "ACTIVE",
        },
      });

      return NextResponse.json({
        ok: true,
        alert: {
          ...alert,
          targetPrice: alert.targetPriceCents ? alert.targetPriceCents / 100 : null,
          originalPrice: alert.originalPriceCents / 100,
        },
        message: `Alert created for "${ticket.title}". We'll notify you when the price drops.`,
      }, { status: 201 });

    } else if (body.eventQuery) {
      // Alert for any ticket matching event query
      const alert = await prisma.priceAlert.create({
        data: {
          userId: gate.user.id,
          eventQuery: body.eventQuery,
          targetPriceCents: body.targetPrice ? Math.round(body.targetPrice * 100) : null,
          status: "ACTIVE",
        },
      });

      return NextResponse.json({
        ok: true,
        alert: {
          ...alert,
          targetPrice: alert.targetPriceCents ? alert.targetPriceCents / 100 : null,
        },
        message: `Alert created for "${body.eventQuery}". We'll notify you when matching tickets are listed below your target price.`,
      }, { status: 201 });
    }

  } catch (err) {
    console.error("POST /api/price-alerts failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not create price alert." },
      { status: 500 }
    );
  }
}

// DELETE /api/price-alerts
// Delete a price alert
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
    const alertId = searchParams.get("id");

    if (!alertId) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Alert ID required." },
        { status: 400 }
      );
    }

    // Ensure user owns this alert
    const alert = await prisma.priceAlert.findFirst({
      where: {
        id: alertId,
        userId: gate.user.id,
      },
    });

    if (!alert) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", message: "Alert not found." },
        { status: 404 }
      );
    }

    await prisma.priceAlert.update({
      where: { id: alertId },
      data: { status: "DELETED" },
    });

    return NextResponse.json({
      ok: true,
      message: "Price alert deleted.",
    }, { status: 200 });

  } catch (err) {
    console.error("DELETE /api/price-alerts failed:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Could not delete price alert." },
      { status: 500 }
    );
  }
}

// Cron job to check price alerts
// This should be called by a scheduled cron job every 15 minutes
export async function checkPriceAlerts() {
  try {
    const alerts = await prisma.priceAlert.findMany({
      where: {
        status: "ACTIVE",
      },
      include: {
        ticket: true,
        user: {
          select: { id: true, email: true, firstName: true },
        },
      },
    });

    let triggeredCount = 0;

    for (const alert of alerts) {
      let shouldTrigger = false;
      let message = "";
      let link = "";

      if (alert.ticketId && alert.ticket) {
        // Check specific ticket price
        const currentPrice = alert.ticket.priceCents;
        
        // Price dropped
        if (currentPrice < alert.originalPriceCents) {
          if (!alert.targetPriceCents || currentPrice <= alert.targetPriceCents) {
            shouldTrigger = true;
            const dropPercent = Math.round(((alert.originalPriceCents - currentPrice) / alert.originalPriceCents) * 100);
            message = `Price drop! "${alert.ticket.title}" dropped ${dropPercent}% to $${(currentPrice / 100).toFixed(2)}`;
            link = `/tickets/${alert.ticket.id}`;
          }
        }

      } else if (alert.eventQuery) {
        // Check for new tickets matching query below target price
        const matchingTickets = await prisma.ticket.findMany({
          where: {
            status: "AVAILABLE",
            OR: [
              { title: { contains: alert.eventQuery, mode: "insensitive" } },
              { event: { title: { contains: alert.eventQuery, mode: "insensitive" } } },
            ],
            ...(alert.targetPriceCents ? { priceCents: { lte: alert.targetPriceCents } } : {}),
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Only new listings in last 24h
          },
          orderBy: { priceCents: "asc" },
          take: 1,
        });

        if (matchingTickets.length > 0) {
          const ticket = matchingTickets[0];
          shouldTrigger = true;
          message = `New ticket for "${alert.eventQuery}" listed at $${(ticket.priceCents / 100).toFixed(2)}`;
          link = `/tickets/${ticket.id}`;
        }
      }

      if (shouldTrigger && alert.user) {
        // Create notification
        await createNotification({
          userId: alert.user.id,
          type: "TICKET_PRICE_DROP",
          message,
          link,
        });

        // Update alert status
        await prisma.priceAlert.update({
          where: { id: alert.id },
          data: {
            status: "TRIGGERED",
            triggeredAt: new Date(),
          },
        });

        triggeredCount++;
      }
    }

    return { ok: true, triggeredCount };

  } catch (err) {
    console.error("checkPriceAlerts failed:", err);
    return { ok: false, error: err };
  }
}
