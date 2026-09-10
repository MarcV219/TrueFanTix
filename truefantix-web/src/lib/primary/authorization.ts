import type { PrimaryMembershipRole, UserRole } from "@prisma/client";
import { assertPrimaryPreflightCapability, requirePrimaryPreflight, type PrimaryPreflightCapability } from "./config";

export class PrimaryAccessError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "FORBIDDEN",
    readonly status: 403 | 404,
  ) {
    super(code === "NOT_FOUND" ? "Resource not found." : "Not authorized.");
    this.name = "PrimaryAccessError";
  }
}

type Membership = { id: string; organizerId: string; role: PrimaryMembershipRole };

export type PrimaryAuthorizationStore = {
  primaryOrganizerMembership: {
    findFirst(args: object): Promise<Membership | null>;
  };
  primaryEvent: {
    findFirst(args: object): Promise<{ id: string; organizerId: string } | null>;
  };
  primaryEventStaffAssignment: {
    findFirst(args: object): Promise<{ id: string } | null>;
  };
};

type Actor = { id: string; role: UserRole };

const ALL_ORGANIZER_ROLES: readonly PrimaryMembershipRole[] = [
  "OWNER",
  "FINANCE",
  "EVENT_MANAGER",
  "BOX_OFFICE",
  "SCANNER",
  "READ_ONLY",
];

export async function authorizePrimaryOrganizer(input: {
  store: PrimaryAuthorizationStore;
  actor: Actor;
  organizerId: string;
  allowedRoles?: readonly PrimaryMembershipRole[];
  env?: NodeJS.ProcessEnv;
  capability?: PrimaryPreflightCapability;
  allowPlatformAdmin?: boolean;
}) {
  if (input.capability) assertPrimaryPreflightCapability(input.capability);
  else requirePrimaryPreflight(input.env);
  if (input.actor.role === "ADMIN") {
    if (input.allowPlatformAdmin === false) throw new PrimaryAccessError("FORBIDDEN", 403);
    return { platformAdmin: true as const, membership: null };
  }

  const allowedRoles = input.allowedRoles ?? ALL_ORGANIZER_ROLES;
  const membership = await input.store.primaryOrganizerMembership.findFirst({
    where: {
      organizerId: input.organizerId,
      userId: input.actor.id,
      status: "ACTIVE",
      role: { in: [...allowedRoles] },
    },
    select: { id: true, organizerId: true, role: true },
  });

  // Return NOT_FOUND so IDs cannot be used to enumerate other tenants.
  if (!membership) throw new PrimaryAccessError("NOT_FOUND", 404);
  return { platformAdmin: false as const, membership };
}

export async function authorizePrimaryEvent(input: {
  store: PrimaryAuthorizationStore;
  actor: Actor;
  organizerId: string;
  eventId: string;
  allowedRoles?: readonly PrimaryMembershipRole[];
  env?: NodeJS.ProcessEnv;
  capability?: PrimaryPreflightCapability;
  allowPlatformAdmin?: boolean;
}) {
  const organizerAccess = await authorizePrimaryOrganizer(input);
  const event = await input.store.primaryEvent.findFirst({
    where: { id: input.eventId, organizerId: input.organizerId },
    select: { id: true, organizerId: true },
  });
  if (!event) throw new PrimaryAccessError("NOT_FOUND", 404);

  if (organizerAccess.platformAdmin || organizerAccess.membership.role === "OWNER") {
    return { ...organizerAccess, event };
  }

  const assignment = await input.store.primaryEventStaffAssignment.findFirst({
    where: {
      eventId: input.eventId,
      organizerId: input.organizerId,
      membershipId: organizerAccess.membership.id,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (!assignment) throw new PrimaryAccessError("NOT_FOUND", 404);
  return { ...organizerAccess, event, assignment };
}
