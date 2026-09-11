export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { PrimaryTicketTypeStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enforceOriginAndCsrf } from "@/lib/security/csrf";
import { PrimaryAccessError } from "@/lib/primary/authorization";
import { PrimaryEventService, type PrimaryEventDraftFields } from "@/lib/primary/event-service";
import { PrimaryDomainError, PrimaryOrganizerService } from "@/lib/primary/organizer-service";
import { PrimaryTicketTypeService, type PrimaryTicketTypeFields } from "@/lib/primary/ticket-type-service";
import {
  ensurePrimaryStagingPersona,
  PrimaryStagingConsoleInputError,
  PrimaryStagingConsoleUnavailableError,
  primaryStagingSyntheticContactEmail,
  primaryStagingSyntheticContactPhone,
  requirePrimaryStagingActor,
  requirePrimaryStagingConsole,
} from "@/lib/primary/staging-console";
import {
  PrimaryStagingRefundError,
  recordPrimaryStagingRefundRejection,
  reseedPrimaryStagingRefundScenario,
  runPrimaryStagingRefundAction,
} from "@/lib/primary/staging-refund-console";

type JsonRecord = Record<string, unknown>;

function text(body: JsonRecord, key: string) {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function optionalText(body: JsonRecord, key: string) {
  const value = text(body, key).trim();
  return value || undefined;
}

function integer(body: JsonRecord, key: string) {
  const value = body[key];
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) ? number : Number.NaN;
}

function optionalInteger(body: JsonRecord, key: string) {
  const value = body[key];
  if (value === undefined || value === null || value === "") return undefined;
  return integer(body, key);
}

function eventFields(body: JsonRecord): PrimaryEventDraftFields {
  return {
    title: text(body, "title"),
    description: text(body, "description"),
    category: text(body, "category"),
    venueName: text(body, "venueName"),
    venueAddressLine1: text(body, "venueAddressLine1"),
    venueAddressLine2: optionalText(body, "venueAddressLine2"),
    venueCity: text(body, "venueCity"),
    venueRegion: text(body, "venueRegion"),
    venuePostalCode: text(body, "venuePostalCode"),
    venueCountry: text(body, "venueCountry"),
    startsAtLocal: text(body, "startsAtLocal"),
    endsAtLocal: text(body, "endsAtLocal"),
    timezone: text(body, "timezone"),
    accessibilityInfo: optionalText(body, "accessibilityInfo"),
    contactEmail: primaryStagingSyntheticContactEmail(text(body, "contactEmail")),
    contactPhone: primaryStagingSyntheticContactPhone(optionalText(body, "contactPhone")),
    draftPolicyText: text(body, "draftPolicyText"),
    totalCapacity: integer(body, "totalCapacity"),
  };
}

function ticketTypeFields(body: JsonRecord): PrimaryTicketTypeFields {
  const status = text(body, "status") as PrimaryTicketTypeStatus;
  if (!(["ACTIVE", "INACTIVE"] as const).includes(status)) throw new PrimaryDomainError("INVALID_TICKET_TYPE_STATUS");
  return {
    name: text(body, "name"),
    description: optionalText(body, "description"),
    allocatedQuantity: integer(body, "allocatedQuantity"),
    status,
    minimumPerOrder: optionalInteger(body, "minimumPerOrder"),
    maximumPerOrder: optionalInteger(body, "maximumPerOrder"),
    currency: text(body, "currency"),
    basePriceMinor: integer(body, "basePriceMinor"),
  };
}

function invitationPepper() {
  const value = process.env.PRIMARY_INVITATION_PEPPER ?? process.env.SESSION_SECRET ?? "";
  if (value.length < 32) throw new PrimaryDomainError("STAGING_INVITATION_PEPPER_REQUIRED");
  return value;
}

function jsonError(status: number, error: string) {
  return noStore(NextResponse.json({ ok: false, error }, { status }));
}

function noStore<T extends NextResponse>(response: T) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(req: Request) {
  let refundActor: { id: string; email: string; role: "USER" | "ADMIN" } | null = null;
  let requestedAction = "unknown";
  try {
    const capability = requirePrimaryStagingConsole();
    const csrf = await enforceOriginAndCsrf(req);
    if (!csrf.ok) return noStore(csrf.res);
    const actorUser = await requirePrimaryStagingActor();
    if (!actorUser) return jsonError(401, "NOT_AUTHENTICATED");

    const body = (await req.json().catch(() => null)) as JsonRecord | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "INVALID_REQUEST");
    const action = text(body, "action");
    requestedAction = action;
    refundActor = { id: actorUser.id, email: actorUser.email, role: actorUser.role };
    const actor = { id: actorUser.id, role: actorUser.role };
    const requestId = `staging-console:${randomUUID()}`;
    const organizerService = new PrimaryOrganizerService(prisma, capability, invitationPepper());
    const eventService = new PrimaryEventService(prisma, capability);
    const ticketTypeService = new PrimaryTicketTypeService(prisma, capability);
    let result: unknown;

    if (action === "reseedRefundScenarios") {
      await ensurePrimaryStagingPersona("organizer");
      result = await reseedPrimaryStagingRefundScenario(prisma, refundActor);
      return noStore(NextResponse.json({ ok: true, result }));
    }
    if (["refundOrdinary", "requestCheckedRefund", "approveCheckedRefund", "completeCheckedRefund", "activateCancellation", "prepareCancellation", "approveCancellationWaiver", "completeCancellation"].includes(action)) {
      result = await runPrimaryStagingRefundAction(prisma, refundActor, action, body);
      return noStore(NextResponse.json({ ok: true, result }));
    }

    switch (action) {
      case "createOrganizer":
        result = await organizerService.createDraft({
          actor,
          requestId,
          legalName: text(body, "legalName"),
          displayName: text(body, "displayName"),
          addressLine1: text(body, "addressLine1"),
          addressLine2: optionalText(body, "addressLine2"),
          city: text(body, "city"),
          region: text(body, "region"),
          postalCode: text(body, "postalCode"),
          country: text(body, "country"),
          supportEmail: primaryStagingSyntheticContactEmail(text(body, "supportEmail")),
          supportPhone: primaryStagingSyntheticContactPhone(optionalText(body, "supportPhone")),
          website: optionalText(body, "website"),
        });
        break;
      case "submitOrganizer":
        result = await organizerService.submit({ actor, organizerId: text(body, "organizerId"), requestId });
        break;
      case "reviewOrganizer": {
        const requestedStatus = text(body, "toStatus");
        const reviewStatuses = ["UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED", "DRAFT"] as const;
        if (!reviewStatuses.some((status) => status === requestedStatus)) {
          throw new PrimaryDomainError("INVALID_ORGANIZER_REVIEW_STATUS");
        }
        const toStatus = requestedStatus as (typeof reviewStatuses)[number];
        result = await organizerService.review({
          actor,
          organizerId: text(body, "organizerId"),
          requestId,
          toStatus,
          reason: text(body, "reason"),
        });
        break;
      }
      case "createEvent":
        result = await eventService.createDraft({
          actor,
          organizerId: text(body, "organizerId"),
          requestId,
          fields: eventFields(body),
        });
        break;
      case "editEvent":
        result = await eventService.editDraft({
          actor,
          organizerId: text(body, "organizerId"),
          eventId: text(body, "eventId"),
          requestId,
          fields: eventFields(body),
        });
        break;
      case "submitEvent":
        result = await eventService.submit({
          actor,
          organizerId: text(body, "organizerId"),
          eventId: text(body, "eventId"),
          requestId,
        });
        break;
      case "reviewEvent": {
        const requestedStatus = text(body, "toStatus");
        const reviewStatuses = ["UNDER_REVIEW", "APPROVED", "REJECTED"] as const;
        if (!reviewStatuses.some((status) => status === requestedStatus)) {
          throw new PrimaryDomainError("INVALID_EVENT_REVIEW_STATUS");
        }
        const toStatus = requestedStatus as (typeof reviewStatuses)[number];
        result = await eventService.review({
          actor,
          organizerId: text(body, "organizerId"),
          eventId: text(body, "eventId"),
          requestId,
          toStatus,
          reason: text(body, "reason"),
        });
        break;
      }
      case "createTicketType":
        result = await ticketTypeService.create({
          actor,
          organizerId: text(body, "organizerId"),
          eventId: text(body, "eventId"),
          requestId,
          fields: ticketTypeFields(body),
        });
        break;
      case "updateTicketType":
        result = await ticketTypeService.update({
          actor,
          organizerId: text(body, "organizerId"),
          eventId: text(body, "eventId"),
          ticketTypeId: text(body, "ticketTypeId"),
          requestId,
          fields: ticketTypeFields(body),
        });
        break;
      default:
        return jsonError(400, "UNKNOWN_ACTION");
    }

    return noStore(NextResponse.json({ ok: true, result }));
  } catch (error) {
    if (error instanceof PrimaryStagingConsoleUnavailableError) return jsonError(404, "NOT_FOUND");
    if (error instanceof PrimaryStagingConsoleInputError) return jsonError(400, error.code);
    if (error instanceof PrimaryAccessError) return jsonError(error.status, error.code);
    if (error instanceof PrimaryDomainError) return jsonError(409, error.code);
    if (error instanceof PrimaryStagingRefundError) {
      if (refundActor) await recordPrimaryStagingRefundRejection(prisma, refundActor, requestedAction, error.code).catch(() => undefined);
      return jsonError(409, error.code);
    }
    if (refundActor && requestedAction !== "unknown") {
      await recordPrimaryStagingRefundRejection(prisma, refundActor, requestedAction, "PERSISTENCE_REJECTED").catch(() => undefined);
    }
    console.error("Primary staging action failed", error);
    return jsonError(500, "STAGING_ACTION_FAILED");
  }
}
