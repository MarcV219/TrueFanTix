import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { createNotification } from "@/lib/notifications/service";
import {
  ManagedAccountPriceAlertWriteError,
  runOrdinaryPriceAlertWrite,
} from "@/lib/price-alerts/ordinary-user";
import { schemas, validateRequest } from "@/lib/validation";

function stagingConsoleOnlyResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
      message: "This managed account is restricted to the staging console.",
    },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}

// GET /api/price-alerts
// List user's price alerts
export async function GET(req: Request) {
  try {
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "ACTIVE";

    const alerts = await prisma.priceAlert.findMany({
      where: {
        userId: gate.user.id,
        status,
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
        targetPrice: alert.targetPriceCents ? alert.targetPriceCents / 100 : null,
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
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const validation = await validateRequest(schemas.priceAlertCreateApi)(req);
    if (!validation.success) return validation.response;

    const body = validation.data;

    const result = await runOrdinaryPriceAlertWrite(gate.user.id, async (tx) => {
      if (body.ticketId) {
        // Alert for specific ticket.
        const ticket = await tx.ticket.findUnique({
          where: { id: body.ticketId },
          select: { id: true, title: true, priceCents: true, status: true },
        });

        if (!ticket || ticket.status !== "AVAILABLE") {
          return { error: "TICKET_NOT_FOUND" as const };
        }

        // The user lock also serializes duplicate checks for this account.
        const existingAlert = await tx.priceAlert.findFirst({
          where: {
            userId: gate.user.id,
            ticketId: body.ticketId,
            status: "ACTIVE",
          },
        });

        if (existingAlert) {
          return { error: "ALERT_EXISTS" as const };
        }

        const alert = await tx.priceAlert.create({
          data: {
            userId: gate.user.id,
            ticketId: body.ticketId,
            targetPriceCents: body.targetPrice ? Math.round(body.targetPrice * 100) : null,
            originalPriceCents: ticket.priceCents,
            status: "ACTIVE",
          },
        });

        return { alert, ticketTitle: ticket.title };
      }

      if (body.eventQuery) {
        const alert = await tx.priceAlert.create({
          data: {
            userId: gate.user.id,
            eventQuery: body.eventQuery,
            targetPriceCents: body.targetPrice ? Math.round(body.targetPrice * 100) : null,
            status: "ACTIVE",
          },
        });

        return { alert, eventQuery: body.eventQuery };
      }

      return { error: "INVALID_ALERT" as const };
    });

    if ("error" in result) {
      if (result.error === "TICKET_NOT_FOUND") {
        return NextResponse.json(
          { ok: false, error: "TICKET_NOT_FOUND", message: "Ticket not found or not available." },
          { status: 404 }
        );
      }
      if (result.error === "ALERT_EXISTS") {
        return NextResponse.json(
          { ok: false, error: "ALERT_EXISTS", message: "You already have an active alert for this ticket." },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Choose a ticket or event query." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      alert: {
        ...result.alert,
        targetPrice: result.alert.targetPriceCents ? result.alert.targetPriceCents / 100 : null,
        ...(result.alert.originalPriceCents !== null
          ? { originalPrice: result.alert.originalPriceCents / 100 }
          : {}),
      },
      message: "ticketTitle" in result
        ? `Alert created for "${result.ticketTitle}". We'll notify you when the price drops.`
        : `Alert created for "${result.eventQuery}". We'll notify you when matching tickets are listed below your target price.`,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof ManagedAccountPriceAlertWriteError) {
      return stagingConsoleOnlyResponse();
    }
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
    const gate = await requireUser(req);
    if (!gate.ok) return gate.res;

    const { searchParams } = new URL(req.url);
    const parsed = schemas.priceAlertDeleteQuery.safeParse({
      id: searchParams.get("id"),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "VALIDATION_ERROR", message: "Alert ID required." },
        { status: 400 }
      );
    }

    const alertId = parsed.data.id;

    const deleted = await runOrdinaryPriceAlertWrite(gate.user.id, async (tx) => {
      // Keep ownership validation and the state transition in one transaction.
      const alert = await tx.priceAlert.findFirst({
        where: {
          id: alertId,
          userId: gate.user.id,
        },
      });
      if (!alert) return false;

      await tx.priceAlert.update({
        where: { id: alertId },
        data: { status: "DELETED" },
      });
      return true;
    });

    if (!deleted) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND", message: "Alert not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Price alert deleted.",
    }, { status: 200 });

  } catch (err) {
    if (err instanceof ManagedAccountPriceAlertWriteError) {
      return stagingConsoleOnlyResponse();
    }
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
        if (alert.originalPriceCents && currentPrice < alert.originalPriceCents) {
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
