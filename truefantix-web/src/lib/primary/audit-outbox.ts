import type { Prisma } from "@prisma/client";
import {
  assertPrimaryPreflightCapability,
  type PrimaryPreflightCapability,
} from "./config";

const AUDIT_FIELD_ALLOWLIST = new Set([
  "status",
  "role",
  "displayName",
  "supportEmail",
  "eventId",
  "organizerId",
  "membershipId",
  "revokedAt",
  "title",
  "category",
  "venueName",
  "timezone",
  "startsAtLocal",
  "endsAtLocal",
  "totalCapacity",
  "name",
  "allocatedQuantity",
  "minimumPerOrder",
  "maximumPerOrder",
  "currency",
  "basePriceMinor",
  "ticketTypeId",
  "quantity",
  "expiresAt",
  "paymentCommittedAt",
  "reconciliationAfter",
  "releasedAt",
  "expiredAt",
]);

export function redactPrimaryAuditSnapshot(value: Record<string, unknown> | null | undefined) {
  if (!value) return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key]) => AUDIT_FIELD_ALLOWLIST.has(key)));
}

type FoundationTransaction = {
  primaryAuditEvent: { create(args: object): Promise<unknown> };
  primaryOutboxMessage: { create(args: object): Promise<unknown> };
};

/** Writes the audit record and delivery intent inside the caller's transaction. */
export async function recordPrimaryAuditAndOutbox(
  capability: PrimaryPreflightCapability,
  tx: FoundationTransaction,
  input: {
    organizerId?: string;
    eventId?: string;
    actorUserId?: string;
    actorType: "USER" | "SYSTEM";
    action: string;
    targetType: string;
    targetId: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    reason?: string;
    requestId?: string;
    topic: string;
    payload: Prisma.InputJsonObject;
    idempotencyKey: string;
  },
) {
  assertPrimaryPreflightCapability(capability);

  const audit = await tx.primaryAuditEvent.create({
    data: {
      organizerId: input.organizerId,
      eventId: input.eventId,
      actorUserId: input.actorUserId,
      actorType: input.actorType,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      beforeJson: redactPrimaryAuditSnapshot(input.before),
      afterJson: redactPrimaryAuditSnapshot(input.after),
      reason: input.reason,
      requestId: input.requestId,
    },
  });

  const outbox = await tx.primaryOutboxMessage.create({
    data: {
      organizerId: input.organizerId,
      topic: input.topic,
      aggregateType: input.targetType,
      aggregateId: input.targetId,
      payloadJson: input.payload,
      idempotencyKey: input.idempotencyKey,
    },
  });

  return { audit, outbox };
}
