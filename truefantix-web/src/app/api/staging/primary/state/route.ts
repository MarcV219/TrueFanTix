export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  PrimaryStagingConsoleUnavailableError,
  requirePrimaryStagingActor,
  STAGING_ORGANIZER_EMAIL,
} from "@/lib/primary/staging-console";
import { getPrimaryStagingRefundState } from "@/lib/primary/staging-refund-console";
import { getPrimaryStagingBuyerJourney } from "@/lib/primary/staging-buyer-journey";

function unavailable() {
  return noStore(NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 }));
}

function noStore<T extends NextResponse>(response: T) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET() {
  try {
    const actor = await requirePrimaryStagingActor();
    if (!actor) {
      return noStore(NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED" }, { status: 401 }));
    }

    const membershipFilter = actor.role === "ADMIN"
      ? {
          memberships: {
            some: {
              status: "ACTIVE" as const,
              role: "OWNER" as const,
              user: { email: STAGING_ORGANIZER_EMAIL },
            },
          },
        }
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

    const refundConsole = await getPrimaryStagingRefundState(prisma);
    const buyerJourney = await getPrimaryStagingBuyerJourney(prisma);
    return noStore(NextResponse.json({ ok: true, actor, organizers, audit, refundConsole, buyerJourney }));
  } catch (error) {
    if (error instanceof PrimaryStagingConsoleUnavailableError) return unavailable();
    throw error;
  }
}
