import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify, type KeyObject } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { recordPrimaryAuditAndOutbox } from "./audit-outbox";
import { assertPrimaryPreflightCapability, type PrimaryPreflightCapability } from "./config";
import { PrimaryDomainError } from "./organizer-service";

type Tx = Prisma.TransactionClient;
type Db = { $transaction<T>(fn: (tx: Tx) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> };
type AdmissionConfig = Readonly<{ keyId: string; privateKey: KeyObject; publicKey: KeyObject }>;
export type PrimaryAdmissionInternalCapability = { readonly kind: "PrimaryAdmissionInternalCapability" };
const configs = new WeakSet<object>(); const internalCapabilities = new WeakSet<object>();
const VERSION = 1;

export function createPrimaryAdmissionInternalCapabilityForTests(): PrimaryAdmissionInternalCapability {
  if (process.env.NODE_ENV !== "test" || process.env.PRIMARY_TICKETING_ENVIRONMENT_ID !== "isolated-test") throw new PrimaryDomainError("ADMISSION_INTERNAL_BOUNDARY_FORBIDDEN");
  const capability = Object.freeze({ kind: "PrimaryAdmissionInternalCapability" as const }); internalCapabilities.add(capability); return capability;
}

function assertInternal(value: PrimaryAdmissionInternalCapability) {
  if (!internalCapabilities.has(value)) throw new PrimaryDomainError("ADMISSION_INTERNAL_BOUNDARY_FORBIDDEN");
}

export function requirePrimaryAdmissionTestConfig(capability: PrimaryPreflightCapability, env: NodeJS.ProcessEnv = process.env): AdmissionConfig {
  assertPrimaryPreflightCapability(capability);
  const keyId = env.PRIMARY_ADMISSION_SIGNING_KEY_ID?.trim() ?? "";
  if (!keyId.startsWith("test_") || !env.PRIMARY_ADMISSION_PRIVATE_KEY || !env.PRIMARY_ADMISSION_PUBLIC_KEY) throw new PrimaryDomainError("ADMISSION_TEST_KEY_PREFLIGHT_REQUIRED");
  try {
    const privateKey = createPrivateKey(env.PRIMARY_ADMISSION_PRIVATE_KEY); const publicKey = createPublicKey(env.PRIMARY_ADMISSION_PUBLIC_KEY);
    if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    const challenge = Buffer.from("primary-admission-key-pair");
    if (!verify(null, challenge, publicKey, sign(null, challenge, privateKey))) throw new Error("key mismatch");
    const config = Object.freeze({ keyId, privateKey, publicKey }); configs.add(config); return config;
  } catch { throw new PrimaryDomainError("ADMISSION_TEST_KEY_PREFLIGHT_REQUIRED"); }
}

type Payload = { v: 1; cid: string; eventId: string; iat: string; kid: string };
function encode(value: Buffer | string) { return Buffer.from(value).toString("base64url"); }
function canonical(payload: Payload) { return JSON.stringify({ v: payload.v, cid: payload.cid, eventId: payload.eventId, iat: payload.iat, kid: payload.kid }); }
function tokenFor(payload: Payload, signature: string) { return `${encode(canonical(payload))}.${signature}`; }
function digest(payload: Payload) { return createHash("sha256").update(canonical(payload)).digest("hex"); }
function cleanKey(value: string) { const result = value.trim(); if (!result) throw new PrimaryDomainError("IDEMPOTENCY_KEY_REQUIRED"); return result; }

export class PrimaryAdmissionService {
  constructor(private readonly db: Db, private readonly capability: PrimaryPreflightCapability, private readonly config: AdmissionConfig, private readonly clock: () => Date = () => new Date()) {
    if (!configs.has(config)) throw new PrimaryDomainError("ADMISSION_TEST_KEY_PREFLIGHT_REQUIRED");
  }

  async issue(input: { internalCapability: PrimaryAdmissionInternalCapability; organizerId: string; eventId: string; orderId: string; idempotencyKey: string }) {
    assertInternal(input.internalCapability); const idempotencyKey = cleanKey(input.idempotencyKey);
    for (let attemptNumber = 0; attemptNumber < 5; attemptNumber += 1) {
      try { return await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PrimaryOrder" WHERE id = ${input.orderId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "PrimaryAdmissionTicket" WHERE "orderId" = ${input.orderId} ORDER BY "unitNumber" FOR UPDATE`;
      const order = await tx.primaryOrder.findFirst({ where: { id: input.orderId, organizerId: input.organizerId, eventId: input.eventId }, include: { lines: true, paymentAttempt: { include: { exceptions: true } }, admissionTickets: { include: { credential: true }, orderBy: { unitNumber: "asc" } } } });
      if (!order) throw new PrimaryDomainError("ADMISSION_ORDER_NOT_FOUND");
      if (order.status !== "PAID" || order.paymentAttempt?.status !== "SUCCEEDED" || order.paymentAttempt.exceptions.length) throw new PrimaryDomainError("ADMISSION_ORDER_NOT_RECONCILED_PAID");
      const line = order.lines[0]; if (!line || order.lines.length !== 1 || line.quantity <= 0) throw new PrimaryDomainError("ADMISSION_ORDER_LINE_INVALID");
      if (order.admissionTickets.length) {
        if (order.admissionTickets.length !== line.quantity || order.admissionTickets.some((ticket) => ticket.issuanceIdempotencyKey !== idempotencyKey || !ticket.credential)) throw new PrimaryDomainError("IDEMPOTENCY_CONFLICT");
        return order.admissionTickets.map((ticket) => ({ ticket, token: this.reconstruct(ticket.credential!) }));
      }
      const results = [];
      for (let unitNumber = 1; unitNumber <= line.quantity; unitNumber += 1) {
        const issuedAt = this.clock(); const credentialId = randomUUID();
        const payload: Payload = { v: VERSION, cid: credentialId, eventId: order.eventId, iat: issuedAt.toISOString(), kid: this.config.keyId };
        const signature = sign(null, Buffer.from(canonical(payload)), this.config.privateKey).toString("base64url");
        const ticket = await tx.primaryAdmissionTicket.create({ data: { organizerId: order.organizerId, eventId: order.eventId, buyerUserId: order.buyerUserId, reservationId: order.reservationId, orderId: order.id, orderLineId: line.id, ticketTypeId: line.ticketTypeId, unitNumber, issuanceIdempotencyKey: idempotencyKey, issuedAt, credential: { create: { id: credentialId, payloadVersion: VERSION, keyId: this.config.keyId, signature, payloadDigest: digest(payload), issuedAt } } }, include: { credential: true } });
        await this.audit(tx, ticket, "ADMISSION_ISSUED", `${idempotencyKey}:${unitNumber}`);
        results.push({ ticket, token: tokenFor(payload, signature) });
      }
      return results;
      }, { isolationLevel: "Serializable" });
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034" && attemptNumber < 4) continue;
        throw error;
      }
    }
    throw new PrimaryDomainError("ADMISSION_ISSUANCE_RETRY_EXHAUSTED");
  }

  void(input: { internalCapability: PrimaryAdmissionInternalCapability; admissionTicketId: string; reason: string; idempotencyKey: string }) {
    assertInternal(input.internalCapability); const reason = input.reason.trim(); const idempotencyKey = cleanKey(input.idempotencyKey); if (!reason) throw new PrimaryDomainError("VOID_REASON_REQUIRED");
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PrimaryAdmissionTicket" WHERE id = ${input.admissionTicketId} FOR UPDATE`;
      const current = await tx.primaryAdmissionTicket.findUnique({ where: { id: input.admissionTicketId } }); if (!current) throw new PrimaryDomainError("ADMISSION_NOT_FOUND");
      if (current.status === "VOIDED") { if (current.voidReason !== reason) throw new PrimaryDomainError("IDEMPOTENCY_CONFLICT"); return current; }
      const updated = await tx.primaryAdmissionTicket.update({ where: { id: current.id }, data: { status: "VOIDED", voidedAt: this.clock(), voidReason: reason } });
      await this.audit(tx, updated, "ADMISSION_VOIDED", idempotencyKey); return updated;
    }, { isolationLevel: "Serializable" });
  }

  async verify(token: string, expectedEventId: string) {
    const parts = token.split("."); if (parts.length !== 2) throw new PrimaryDomainError("INVALID_CREDENTIAL");
    let payload: Payload;
    try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Payload; } catch { throw new PrimaryDomainError("INVALID_CREDENTIAL"); }
    if (payload.v !== VERSION || payload.kid !== this.config.keyId || payload.eventId !== expectedEventId || !payload.cid || !payload.iat) throw new PrimaryDomainError("INVALID_CREDENTIAL");
    const body = canonical(payload); if (!verify(null, Buffer.from(body), this.config.publicKey, Buffer.from(parts[1], "base64url"))) throw new PrimaryDomainError("INVALID_CREDENTIAL");
    const credential = await this.db.$transaction((tx) => tx.primaryAdmissionCredential.findUnique({ where: { id: payload.cid }, include: { ticket: true } }));
    if (!credential || credential.eventId !== expectedEventId || credential.payloadVersion !== VERSION || credential.keyId !== payload.kid || credential.signature !== parts[1] || credential.payloadDigest !== createHash("sha256").update(body).digest("hex") || credential.issuedAt.toISOString() !== payload.iat || credential.ticket.status !== "ISSUED") throw new PrimaryDomainError("INVALID_CREDENTIAL");
    return { credentialId: credential.id, admissionTicketId: credential.admissionTicketId, eventId: credential.eventId, status: credential.ticket.status };
  }

  private reconstruct(credential: { id: string; eventId: string; payloadVersion: number; keyId: string; signature: string; issuedAt: Date }) {
    return tokenFor({ v: credential.payloadVersion as 1, cid: credential.id, eventId: credential.eventId, iat: credential.issuedAt.toISOString(), kid: credential.keyId }, credential.signature);
  }

  private audit(tx: Tx, ticket: { id: string; organizerId: string; eventId: string; orderId: string; status: string }, action: string, key: string) {
    return recordPrimaryAuditAndOutbox(this.capability, tx, { organizerId: ticket.organizerId, eventId: ticket.eventId, actorType: "SYSTEM", action, targetType: "PrimaryAdmissionTicket", targetId: ticket.id, after: ticket, requestId: key, topic: `primary.admission.${action.toLowerCase()}`, payload: { organizerId: ticket.organizerId, eventId: ticket.eventId, targetId: ticket.id, orderId: ticket.orderId, status: ticket.status }, idempotencyKey: `${key}:${action.toLowerCase()}` });
  }
}
