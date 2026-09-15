/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { auditLog } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/service";
import { sendDisputeEmails } from "@/lib/disputes";
import { awardLaunchSale } from "@/lib/launchPromotion";
import { refundOrderAccessTokens } from "@/lib/accessTokenHolds";
import { validateRequest } from "@/lib/validation";
import { POST } from "@/app/api/admin/orders/[id]/resolve-dispute/route";

const mockedRefundCreate = jest.fn();

jest.mock("stripe", () => jest.fn().mockImplementation(() => ({
  refunds: { create: mockedRefundCreate },
})));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
    ticket: { updateMany: jest.fn() },
    sellerMetrics: { upsert: jest.fn() },
    payout: { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    payment: { update: jest.fn() },
    ticketEscrow: { updateMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth/guards", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/audit", () => ({ auditLog: jest.fn(), createAuditContext: jest.fn(() => ({})) }));
jest.mock("@/lib/notifications/service", () => ({ createNotification: jest.fn() }));
jest.mock("@/lib/disputes", () => ({
  DISPUTE_SUPPORT_EMAIL: "support@example.test",
  parseDisputeCase: jest.fn(() => ({ ticketIds: ["ticket-1"], ticketCount: 1 })),
  sendDisputeEmails: jest.fn(),
}));
jest.mock("@/lib/launchPromotion", () => ({ awardLaunchSale: jest.fn() }));
jest.mock("@/lib/accessTokenHolds", () => ({ refundOrderAccessTokens: jest.fn() }));
jest.mock("@/lib/validation", () => ({
  schemas: { adminResolveDispute: { kind: "admin-resolve-dispute" } },
  validateRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  order: { findUnique: jest.Mock; update: jest.Mock };
  ticket: { updateMany: jest.Mock };
  sellerMetrics: { upsert: jest.Mock };
  payout: { findFirst: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
  payment: { update: jest.Mock };
  ticketEscrow: { updateMany: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockedAuditLog = auditLog as jest.MockedFunction<typeof auditLog>;
const mockedCreateNotification = createNotification as jest.MockedFunction<typeof createNotification>;
const mockedSendDisputeEmails = sendDisputeEmails as jest.MockedFunction<typeof sendDisputeEmails>;
const mockedAwardLaunchSale = awardLaunchSale as jest.MockedFunction<typeof awardLaunchSale>;
const mockedRefundOrderAccessTokens = refundOrderAccessTokens as jest.MockedFunction<typeof refundOrderAccessTokens>;
const mockedValidateRequest = validateRequest as jest.Mock;

const orderId = "cm1234567890abcdefghijkl";
const ordinaryAdmin = {
  email: "admin@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
  emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  phoneVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  isBanned: false,
  role: "ADMIN",
};
const managedAdmin = {
  ...ordinaryAdmin,
  email: "admin@primary-staging.example.invalid",
  phone: "+15550001002",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
};

function request() {
  return new Request(`http://localhost/api/admin/orders/${orderId}/resolve-dispute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "RELEASE_PAYOUT", note: "Synthetic resolution." }),
  });
}

describe("admin dispute-resolution staging-persona boundary", () => {
  let action: "RELEASE_PAYOUT" | "MARK_REFUND_REQUIRED" | "KEEP_UNDER_REVIEW";
  const previousStripeSecret = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.STRIPE_SECRET_KEY = "sk_test_synthetic";
    action = "RELEASE_PAYOUT";
    mockedRequireAdmin.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", email: "admin@example.test", role: "ADMIN" },
    } as never);
    mockedValidateRequest.mockReturnValue(
      jest.fn().mockImplementation(async () => ({
        success: true,
        data: { action, note: "Synthetic resolution." },
      })),
    );
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryAdmin);
    mockedPrisma.order.findUnique.mockResolvedValue({
      id: orderId,
      status: "PAID",
      buyerConfirmationStatus: "DISPUTED",
      transferVerificationStatus: "MANUAL_REVIEW",
      transferVerificationReason: JSON.stringify({ type: "BUYER_DISPUTE", ticketIds: ["ticket-1"] }),
      sellerId: "seller-1",
      amountCents: 12500,
      items: [{
        ticketId: "ticket-1",
        ticket: {
          title: "Synthetic Event",
          venue: "Synthetic Venue",
          date: new Date("2027-01-01T00:00:00.000Z"),
          row: "A",
          seat: "1",
        },
      }],
      payment: { status: "SUCCEEDED", provider: "STRIPE", providerRef: "pi_synthetic" },
      seller: { user: { id: "seller-user-1", email: "seller@example.test", firstName: "Seller" } },
      buyerSeller: { user: { id: "buyer-user-1", email: "buyer@example.test", firstName: "Buyer" } },
    });
    mockedPrisma.order.update.mockResolvedValue({
      id: orderId,
      status: "COMPLETED",
      buyerConfirmationStatus: "CONFIRMED",
      transferVerificationStatus: "MATCHED",
    });
    mockedPrisma.payout.findFirst.mockResolvedValue(null);
    mockedRefundCreate.mockResolvedValue({ id: "re_synthetic", status: "succeeded" });
    mockedAuditLog.mockResolvedValue(undefined);
    mockedCreateNotification.mockResolvedValue({ ok: true } as never);
    mockedSendDisputeEmails.mockResolvedValue(undefined);
    mockedAwardLaunchSale.mockResolvedValue(undefined as never);
    mockedRefundOrderAccessTokens.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousStripeSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousStripeSecret;
  });

  it("refuses a restored managed administrator before dispute reads or provider calls", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedAdmin);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedRefundCreate).not.toHaveBeenCalled();
    expect(mockedSendDisputeEmails).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedAdmin);
    mockedPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" }),
    );

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedRefundCreate).not.toHaveBeenCalled();
  });

  it("refuses an ordinary role downgrade before dispute reads or provider calls", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryAdmin, role: "USER" });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "FORBIDDEN" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedRefundCreate).not.toHaveBeenCalled();
  });

  it("commits payout resolution before dispatching its prepared email envelope", async () => {
    const sequence: string[] = [];
    mockedPrisma.$transaction.mockImplementationOnce(
      async (work: (tx: typeof mockedPrisma) => unknown) => {
        sequence.push("transaction-start");
        const result = await work(mockedPrisma);
        expect(mockedSendDisputeEmails).not.toHaveBeenCalled();
        sequence.push("transaction-committed");
        return result;
      },
    );
    mockedPrisma.order.update.mockImplementationOnce(async () => {
      sequence.push("local-write");
      return {
        id: orderId,
        status: "COMPLETED",
        buyerConfirmationStatus: "CONFIRMED",
        transferVerificationStatus: "MATCHED",
      };
    });
    mockedSendDisputeEmails.mockImplementationOnce(async () => {
      sequence.push("email-attempted");
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.ticket.updateMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.sellerMetrics.upsert).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.payout.create).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.update).toHaveBeenCalledTimes(1);
    expect(mockedAwardLaunchSale).toHaveBeenCalledTimes(1);
    expect(mockedAuditLog).toHaveBeenCalledWith(expect.any(Object), mockedPrisma);
    expect(mockedCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockedCreateNotification).toHaveBeenCalledWith(expect.any(Object), mockedPrisma);
    expect(sequence).toEqual([
      "transaction-start",
      "local-write",
      "transaction-committed",
      "email-attempted",
    ]);
    expect(mockedSendDisputeEmails).toHaveBeenCalledWith(expect.objectContaining({
      kind: "RESOLVED",
      idempotencyKeyPrefix: `dispute-resolved:${orderId}`,
    }));
    expect(mockedRefundCreate).not.toHaveBeenCalled();
  });

  it("does not dispatch when commit resolution fails after preparing the response", async () => {
    mockedPrisma.$transaction.mockImplementationOnce(
      async (work: (tx: typeof mockedPrisma) => unknown) => {
        await work(mockedPrisma);
        throw Object.assign(new Error("synthetic commit failure"), { code: "P2034" });
      },
    );

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mockedPrisma.order.update).toHaveBeenCalledTimes(1);
    expect(mockedSendDisputeEmails).not.toHaveBeenCalled();
  });

  it("preserves the committed response when the post-commit email helper rejects", async () => {
    mockedSendDisputeEmails.mockRejectedValueOnce(
      new Error("synthetic post-commit providerless failure"),
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      order: { status: "COMPLETED" },
    });
    expect(mockedPrisma.order.update).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "[EMAIL] Dispute-resolution notifications failed after commit:",
      "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: synthetic post-commit providerless failure",
    );
  });

  it("rechecks the locked dispute state before any repeated resolution side effect", async () => {
    mockedPrisma.order.findUnique.mockResolvedValue({
      buyerConfirmationStatus: "CONFIRMED",
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_STATE" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
    expect(mockedRefundCreate).not.toHaveBeenCalled();
    expect(mockedCreateNotification).not.toHaveBeenCalled();
    expect(mockedSendDisputeEmails).not.toHaveBeenCalled();
  });

  it("issues a synthetic refund only after current-admin and dispute locks", async () => {
    action = "MARK_REFUND_REQUIRED";
    mockedPrisma.order.update.mockResolvedValue({
      id: orderId,
      status: "REFUNDED",
      buyerConfirmationStatus: "REFUNDED",
      transferVerificationStatus: "REFUNDED",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockedRefundCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_synthetic" }),
      { idempotencyKey: `dispute-refund:${orderId}` },
    );
    expect(mockedPrisma.payment.update).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.payout.updateMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.ticketEscrow.updateMany).toHaveBeenCalledTimes(1);
    expect(mockedRefundOrderAccessTokens).toHaveBeenCalledWith(mockedPrisma, orderId);
    expect(mockedSendDisputeEmails).toHaveBeenCalledWith(expect.objectContaining({
      kind: "REFUNDED",
      idempotencyKeyPrefix: `dispute-refunded:${orderId}`,
      comments: expect.stringContaining("Stripe refund reference: re_synthetic"),
    }));
  });

  it("keeps an under-review decision local and sends no closure email", async () => {
    action = "KEEP_UNDER_REVIEW";

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mockedPrisma.order.update).toHaveBeenCalledTimes(1);
    expect(mockedRefundCreate).not.toHaveBeenCalled();
    expect(mockedSendDisputeEmails).not.toHaveBeenCalled();
  });
});
