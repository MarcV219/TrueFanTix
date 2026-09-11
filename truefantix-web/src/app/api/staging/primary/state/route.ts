export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  PrimaryStagingConsoleUnavailableError,
  requirePrimaryStagingActor,
} from "@/lib/primary/staging-console";

function unavailable() {
  return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
}

export async function GET() {
  try {
    const actor = await requirePrimaryStagingActor();
    if (!actor) return NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED" }, { status: 401 });

    const membershipFilter = actor.role === "ADMIN"
      ? undefined
      : { memberships: { some: { userId: actor.id, status: "ACTIVE" as const } } };
    const organizers = await prisma.primaryOrganizer.findMany({
      where: membershipFilter,
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        displayName: true,
        legalName: true,
        status: true,
        statusReason: true,
        supportEmail: true,
        createdAt: true,
        memberships: {
          where: { status: "ACTIVE" },
          select: { id: true, userId: true, role: true, status: true },
        },
        events: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            description: true,
            category: true,
            status: true,
            statusReason: true,
            venueName: true,
            venueAddressLine1: true,
            venueAddressLine2: true,
            venueCity: true,
            venueRegion: true,
            venuePostalCode: true,
            venueCountry: true,
            startsAtLocal: true,
            endsAtLocal: true,
            timezone: true,
            totalCapacity: true,
            accessibilityInfo: true,
            contactEmail: true,
            contactPhone: true,
            draftPolicyText: true,
            ticketTypes: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                name: true,
                description: true,
                allocatedQuantity: true,
                status: true,
                minimumPerOrder: true,
                maximumPerOrder: true,
                currency: true,
                basePriceMinor: true,
              },
            },
          },
        },
      },
    });
    const organizerIds = organizers.map((organizer) => organizer.id);
    const audit = organizerIds.length === 0 ? [] : await prisma.primaryAuditEvent.findMany({
      where: { organizerId: { in: organizerIds } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        organizerId: true,
        eventId: true,
        actorUserId: true,
        action: true,
        targetType: true,
        targetId: true,
        reason: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ ok: true, actor, organizers, audit });
  } catch (error) {
    if (error instanceof PrimaryStagingConsoleUnavailableError) return unavailable();
    throw error;
  }
}
