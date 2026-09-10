import { createHash } from "node:crypto";
import type { Prisma, PrimaryAdmissionScanResult, UserRole } from "@prisma/client";
import { recordPrimaryAuditAndOutbox } from "./audit-outbox";
import type { PrimaryPreflightCapability } from "./config";
import { PrimaryAdmissionService } from "./admission-service";
import { PrimaryDomainError } from "./organizer-service";

type Tx = Prisma.TransactionClient;
type Db = { $transaction<T>(fn: (tx: Tx) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> };
type Actor = { id: string; role: UserRole };
const SCAN_ROLES = ["OWNER", "EVENT_MANAGER", "BOX_OFFICE", "SCANNER"] as const;

function clean(value: string, code: string) { const result = value.trim(); if (!result) throw new PrimaryDomainError(code); return result; }
function device(value?: string) {
  if (value === undefined) return null;
  const result = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(result)) throw new PrimaryDomainError("INVALID_SCAN_DEVICE_ID");
  return result;
}

export class PrimaryAdmissionScanService {
  constructor(
    private readonly db: Db,
    private readonly capability: PrimaryPreflightCapability,
    private readonly admission: PrimaryAdmissionService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async scan(input: { actor: Actor; organizerId: string; eventId: string; token: string; requestId: string; deviceId?: string }) {
    const requestId = clean(input.requestId, "SCAN_REQUEST_ID_REQUIRED"); const deviceId = device(input.deviceId);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.db.$transaction(async (tx) => {
          const authorized = await this.authorize(tx, input.actor, input.organizerId, input.eventId);
          if (!authorized) return { result: "UNAUTHORIZED_OPERATOR" as const, scanId: null, admissionTicketId: null };

          let payload;
          try { payload = this.admission.verifyToken(input.token); }
          catch (error) {
            const code = error instanceof PrimaryDomainError ? error.code : "INVALID_CREDENTIAL";
            const result: PrimaryAdmissionScanResult = code === "UNSUPPORTED_CREDENTIAL_KEY" ? "UNSUPPORTED_KEY" : code === "UNSUPPORTED_CREDENTIAL_VERSION" ? "UNSUPPORTED_VERSION" : "INVALID_CREDENTIAL";
            return this.evidence(tx, input, result, deviceId);
          }
          if (payload.eventId !== input.eventId) return this.evidence(tx, input, "WRONG_EVENT", deviceId);

          const credential = await tx.primaryAdmissionCredential.findFirst({ where: { id: payload.cid, eventId: input.eventId }, include: { ticket: true } });
          const payloadDigest = createHash("sha256").update(JSON.stringify({ v: payload.v, cid: payload.cid, eventId: payload.eventId, iat: payload.iat, kid: payload.kid })).digest("hex");
          if (!credential || credential.payloadVersion !== payload.v || credential.keyId !== payload.kid || credential.payloadDigest !== payloadDigest || credential.issuedAt.toISOString() !== payload.iat) {
            return this.evidence(tx, input, "UNKNOWN_CREDENTIAL", deviceId);
          }
          await tx.$queryRaw`SELECT id FROM "PrimaryAdmissionTicket" WHERE id = ${credential.admissionTicketId} FOR UPDATE`;
          const ticket = await tx.primaryAdmissionTicket.findUniqueOrThrow({ where: { id: credential.admissionTicketId } });
          if (ticket.status === "VOIDED") return this.evidence(tx, input, "VOIDED", deviceId, ticket.id, credential.id);
          if (ticket.status === "CHECKED_IN") return this.evidence(tx, input, "DUPLICATE", deviceId, ticket.id, credential.id);

          const updated = await tx.primaryAdmissionTicket.update({ where: { id: ticket.id }, data: { status: "CHECKED_IN" } });
          const scan = await this.evidence(tx, input, "ACCEPTED", deviceId, ticket.id, credential.id);
          await recordPrimaryAuditAndOutbox(this.capability, tx, {
            organizerId: input.organizerId, eventId: input.eventId, actorUserId: input.actor.id, actorType: "USER",
            action: "ADMISSION_CHECKED_IN", targetType: "PrimaryAdmissionTicket", targetId: ticket.id,
            before: ticket, after: updated, requestId, topic: "primary.admission.checked_in",
            payload: { organizerId: input.organizerId, eventId: input.eventId, targetId: ticket.id, scanId: scan.scanId! },
            idempotencyKey: `${requestId}:admission_checked_in`,
          });
          return scan;
        }, { isolationLevel: "Serializable" });
      } catch (error) {
        if (attempt < 4 && (String(error).includes("40001") || (typeof error === "object" && error !== null && "code" in error && error.code === "P2034"))) continue;
        throw error;
      }
    }
    throw new PrimaryDomainError("ADMISSION_SCAN_RETRY_EXHAUSTED");
  }

  private async authorize(tx: Tx, actor: Actor, organizerId: string, eventId: string) {
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, emailVerifiedAt: true, isBanned: true } });
    if (!user || user.isBanned || !user.emailVerifiedAt || user.role !== actor.role || actor.role === "ADMIN") return false;
    const organizer = await tx.primaryOrganizer.findUnique({ where: { id: organizerId }, select: { status: true } });
    if (!organizer || organizer.status !== "APPROVED") return false;
    const event = await tx.primaryEvent.findFirst({ where: { id: eventId, organizerId }, select: { id: true } }); if (!event) return false;
    const membership = await tx.primaryOrganizerMembership.findFirst({ where: { organizerId, userId: actor.id, status: "ACTIVE", role: { in: [...SCAN_ROLES] } }, select: { id: true } });
    if (!membership) return false;
    return Boolean(await tx.primaryEventStaffAssignment.findFirst({ where: { organizerId, eventId, membershipId: membership.id, status: "ACTIVE" }, select: { id: true } }));
  }

  private async evidence(tx: Tx, input: { actor: Actor; organizerId: string; eventId: string }, result: PrimaryAdmissionScanResult, deviceId: string | null, admissionTicketId?: string, credentialId?: string) {
    const scan = await tx.primaryAdmissionScan.create({ data: { organizerId: input.organizerId, eventId: input.eventId, operatorUserId: input.actor.id, result, deviceId, admissionTicketId, credentialId, scannedAt: this.clock() } });
    return { result, scanId: scan.id, admissionTicketId: admissionTicketId ?? null };
  }
}
