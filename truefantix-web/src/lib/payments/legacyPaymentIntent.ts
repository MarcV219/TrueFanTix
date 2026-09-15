import { createHash } from "node:crypto";
import type { LegacyPaymentIntentCommand, Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export class LegacyPaymentIntentAuthorizationChangedError extends Error {}

export type LegacyPaymentIntentTicketSnapshot = {
  id: string;
  status: string;
  reservedByOrderId: string | null;
  reservedUntil: string | null;
};

export type LegacyPaymentIntentAuthorization = {
  orderId: string;
  buyerUserId: string;
  buyerSellerId: string;
  sellerId: string;
  expectedAmountCents: number;
  currency: string;
  priorPayment: {
    id: string;
    provider: string;
    providerRef: string;
    amountCents: number;
    currency: string;
  } | null;
  ticketSnapshot: LegacyPaymentIntentTicketSnapshot[];
  authorizedAt: Date;
};

export type LegacyPaymentIntentProviderEvidence = {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
  clientSecret: string;
};

function normalizedTickets(tickets: LegacyPaymentIntentTicketSnapshot[]) {
  return [...tickets]
    .map((ticket) => ({
      id: ticket.id,
      status: ticket.status,
      reservedByOrderId: ticket.reservedByOrderId,
      reservedUntil: ticket.reservedUntil,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function digestAuthorization(input: LegacyPaymentIntentAuthorization) {
  const prior = input.priorPayment;
  return createHash("sha256").update(JSON.stringify([
    "legacy-payment-intent-v1",
    input.orderId,
    input.buyerUserId,
    input.buyerSellerId,
    input.sellerId,
    input.expectedAmountCents,
    input.currency.toUpperCase(),
    prior?.id ?? null,
    prior?.provider ?? null,
    prior?.providerRef ?? null,
    prior?.amountCents ?? null,
    prior?.currency.toUpperCase() ?? null,
    normalizedTickets(input.ticketSnapshot),
    input.authorizedAt.toISOString(),
    `truefantix-order-${input.orderId}`,
  ])).digest("hex");
}

function storedAuthorization(command: LegacyPaymentIntentCommand): LegacyPaymentIntentAuthorization {
  const hasPrior = command.priorPaymentId !== null;
  return {
    orderId: command.orderId,
    buyerUserId: command.buyerUserId,
    buyerSellerId: command.buyerSellerId,
    sellerId: command.sellerId,
    expectedAmountCents: command.expectedAmountCents,
    currency: command.currency,
    priorPayment: hasPrior ? {
      id: command.priorPaymentId!,
      provider: command.priorPaymentProvider!,
      providerRef: command.priorPaymentRef!,
      amountCents: command.priorPaymentAmountCents!,
      currency: command.priorPaymentCurrency!,
    } : null,
    ticketSnapshot: command.ticketSnapshot as LegacyPaymentIntentTicketSnapshot[],
    authorizedAt: command.authorizedAt,
  };
}

function assertStoredDigest(command: LegacyPaymentIntentCommand) {
  if (command.commandDigest !== digestAuthorization(storedAuthorization(command))) {
    throw new LegacyPaymentIntentAuthorizationChangedError(
      "The persisted payment-intent command digest does not match its immutable snapshot.",
    );
  }
}

function sameStaticAuthorization(
  command: LegacyPaymentIntentCommand,
  input: LegacyPaymentIntentAuthorization,
) {
  const prior = input.priorPayment;
  const storedTickets = normalizedTickets(command.ticketSnapshot as LegacyPaymentIntentTicketSnapshot[]);
  const inputTickets = normalizedTickets(input.ticketSnapshot);
  const exactPrior =
    command.priorPaymentId === (prior?.id ?? null)
    && command.priorPaymentProvider === (prior?.provider ?? null)
    && command.priorPaymentRef === (prior?.providerRef ?? null)
    && command.priorPaymentAmountCents === (prior?.amountCents ?? null)
    && command.priorPaymentCurrency === (prior?.currency.toUpperCase() ?? null);
  const finalizedReplay = command.status === "SUCCEEDED"
    && prior?.provider === "STRIPE"
    && prior.providerRef === command.providerIntentId
    && prior.amountCents === command.expectedAmountCents
    && prior.currency.toUpperCase() === command.currency;
  return command.buyerUserId === input.buyerUserId
    && command.buyerSellerId === input.buyerSellerId
    && command.sellerId === input.sellerId
    && command.expectedAmountCents === input.expectedAmountCents
    && command.currency === input.currency.toUpperCase()
    && JSON.stringify(storedTickets) === JSON.stringify(inputTickets)
    && (exactPrior || finalizedReplay);
}

export async function stageLegacyPaymentIntentCommand(
  tx: Tx,
  input: LegacyPaymentIntentAuthorization,
) {
  const existing = await tx.legacyPaymentIntentCommand.findUnique({
    where: { orderId: input.orderId },
  });
  if (existing) {
    assertStoredDigest(existing);
    if (!sameStaticAuthorization(existing, input)) {
      throw new LegacyPaymentIntentAuthorizationChangedError(
        "The persisted payment-intent command no longer matches the locked checkout snapshot.",
      );
    }
    return existing;
  }

  const prior = input.priorPayment;
  return tx.legacyPaymentIntentCommand.create({
    data: {
      orderId: input.orderId,
      buyerUserId: input.buyerUserId,
      buyerSellerId: input.buyerSellerId,
      sellerId: input.sellerId,
      expectedAmountCents: input.expectedAmountCents,
      currency: input.currency.toUpperCase(),
      priorPaymentId: prior?.id,
      priorPaymentProvider: prior?.provider,
      priorPaymentRef: prior?.providerRef,
      priorPaymentAmountCents: prior?.amountCents,
      priorPaymentCurrency: prior?.currency.toUpperCase(),
      ticketSnapshot: normalizedTickets(input.ticketSnapshot),
      authorizedAt: input.authorizedAt,
      commandDigest: digestAuthorization(input),
      idempotencyKey: `truefantix-order-${input.orderId}`,
    },
  });
}

export async function claimLegacyPaymentIntentCommand(
  tx: Tx,
  commandId: string,
  dispatchStartedAt = new Date(),
) {
  const current = await tx.legacyPaymentIntentCommand.findUnique({ where: { id: commandId } });
  if (!current || current.status !== "NOT_SENT") return null;
  assertStoredDigest(current);
  const claimed = await tx.legacyPaymentIntentCommand.updateMany({
    where: { id: commandId, status: "NOT_SENT", commandDigest: current.commandDigest },
    data: { status: "ATTEMPTING", dispatchStartedAt },
  });
  if (claimed.count !== 1) return null;
  return tx.legacyPaymentIntentCommand.findUniqueOrThrow({ where: { id: commandId } });
}

export function assertLegacyPaymentIntentProviderEvidence(
  command: LegacyPaymentIntentCommand,
  evidence: LegacyPaymentIntentProviderEvidence,
) {
  if (
    !evidence.id.trim()
    || !evidence.clientSecret.trim()
    || !["requires_payment_method", "requires_confirmation", "requires_action", "processing"].includes(evidence.status)
    || evidence.amountCents !== command.expectedAmountCents
    || evidence.currency.toUpperCase() !== command.currency
  ) {
    throw new Error("LEGACY_PAYMENT_INTENT_PROVIDER_EVIDENCE_MISMATCH");
  }
}

export async function markLegacyPaymentIntentReconciliationRequired(
  tx: Tx,
  commandId: string,
  failureReason: string,
  evidence?: Omit<LegacyPaymentIntentProviderEvidence, "clientSecret">,
  completedAt = new Date(),
) {
  return tx.legacyPaymentIntentCommand.updateMany({
    where: { id: commandId, status: "ATTEMPTING" },
    data: {
      status: "RECONCILIATION_REQUIRED",
      providerIntentId: evidence?.id || undefined,
      providerStatus: evidence?.status || undefined,
      providerAmountCents: Number.isFinite(evidence?.amountCents) ? evidence?.amountCents : undefined,
      providerCurrency: evidence?.currency || undefined,
      failureReason,
      completedAt,
    },
  });
}

function sameTicketSnapshot(
  stored: LegacyPaymentIntentTicketSnapshot[],
  current: Array<{ id: string; status: string; reservedByOrderId: string | null; reservedUntil: Date | null }>,
) {
  return JSON.stringify(normalizedTickets(stored)) === JSON.stringify(normalizedTickets(current.map((ticket) => ({
    id: ticket.id,
    status: ticket.status,
    reservedByOrderId: ticket.reservedByOrderId,
    reservedUntil: ticket.reservedUntil?.toISOString() ?? null,
  }))));
}

export async function finalizeLegacyPaymentIntentCommand(
  tx: Tx,
  params: {
    commandId: string;
    buyerUserId: string;
    evidence: LegacyPaymentIntentProviderEvidence;
    now?: Date;
  },
) {
  const now = params.now ?? new Date();
  await tx.$queryRaw`SELECT "id" FROM "LegacyPaymentIntentCommand" WHERE "id" = ${params.commandId} FOR UPDATE`;
  const command = await tx.legacyPaymentIntentCommand.findUniqueOrThrow({ where: { id: params.commandId } });
  if (command.status !== "ATTEMPTING") throw new Error("LEGACY_PAYMENT_INTENT_NOT_OWNED");
  if (command.buyerUserId !== params.buyerUserId) throw new Error("LEGACY_PAYMENT_INTENT_BUYER_MISMATCH");
  assertStoredDigest(command);
  assertLegacyPaymentIntentProviderEvidence(command, params.evidence);

  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${command.orderId} FOR UPDATE`;
  await tx.$queryRaw`
    SELECT ticket."id"
    FROM "Ticket" ticket
    INNER JOIN "OrderItem" item ON item."ticketId" = ticket."id"
    WHERE item."orderId" = ${command.orderId}
    ORDER BY ticket."id"
    FOR UPDATE OF ticket
  `;
  const order = await tx.order.findUnique({
    where: { id: command.orderId },
    include: { items: { include: { ticket: true } }, payment: true },
  });
  if (!order) throw new Error("LEGACY_PAYMENT_INTENT_ORDER_MISSING");
  if (
    order.status !== "PENDING"
    || order.buyerSellerId !== command.buyerSellerId
    || order.sellerId !== command.sellerId
    || order.totalCents !== command.expectedAmountCents
    || order.currency.toUpperCase() !== command.currency
    || !sameTicketSnapshot(command.ticketSnapshot as LegacyPaymentIntentTicketSnapshot[], order.items.map((item) => item.ticket))
    || order.items.some((item) => !item.ticket.reservedUntil || item.ticket.reservedUntil <= now)
  ) {
    throw new Error("LEGACY_PAYMENT_INTENT_SCOPE_CHANGED");
  }

  if (command.priorPaymentId === null) {
    if (order.payment) throw new Error("LEGACY_PAYMENT_INTENT_PAYMENT_CHANGED");
  } else if (
    !order.payment
    || order.payment.id !== command.priorPaymentId
    || order.payment.provider !== command.priorPaymentProvider
    || order.payment.providerRef !== command.priorPaymentRef
    || order.payment.amountCents !== command.priorPaymentAmountCents
    || order.payment.currency.toUpperCase() !== command.priorPaymentCurrency
  ) {
    throw new Error("LEGACY_PAYMENT_INTENT_PAYMENT_CHANGED");
  }

  await tx.payment.upsert({
    where: { orderId: order.id },
    create: {
      orderId: order.id,
      amountCents: params.evidence.amountCents,
      currency: command.currency,
      status: "REQUIRES_PAYMENT",
      provider: "STRIPE",
      providerRef: params.evidence.id,
    },
    update: {
      amountCents: params.evidence.amountCents,
      currency: command.currency,
      status: "REQUIRES_PAYMENT",
      provider: "STRIPE",
      providerRef: params.evidence.id,
    },
  });
  const finalized = await tx.legacyPaymentIntentCommand.updateMany({
    where: { id: command.id, status: "ATTEMPTING" },
    data: {
      status: "SUCCEEDED",
      providerIntentId: params.evidence.id,
      providerStatus: params.evidence.status,
      providerAmountCents: params.evidence.amountCents,
      providerCurrency: params.evidence.currency.toUpperCase(),
      completedAt: now,
    },
  });
  if (finalized.count !== 1) throw new Error("LEGACY_PAYMENT_INTENT_FINALIZE_FENCE_LOST");
  return { command, order };
}
