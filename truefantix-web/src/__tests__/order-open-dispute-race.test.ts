/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { auditLog } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/service";
import { sendDisputeEmails } from "@/lib/disputes";
import { validateRequest } from "@/lib/validation";
import { POST } from "@/app/api/orders/dispute/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth/guards", () => ({ requireUser: jest.fn() }));
jest.mock("@/lib/audit", () => ({ auditLog: jest.fn(), createAuditContext: jest.fn(() => ({})) }));
jest.mock("@/lib/notifications/service", () => ({ createNotification: jest.fn() }));
jest.mock("@/lib/disputes", () => ({
  DISPUTE_SUPPORT_EMAIL: "support@example.test",
  sendDisputeEmails: jest.fn(),
}));
jest.mock("@/lib/validation", () => ({
  schemas: { orderOpenDispute: { kind: "order-open-dispute" } },
  validateRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; findMany: jest.Mock };
  order: { findUnique: jest.Mock; update: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireUser = requireUser as jest.MockedFunction<typeof requireUser>;
const mockedAuditLog = auditLog as jest.MockedFunction<typeof auditLog>;
const mockedCreateNotification = createNotification as jest.MockedFunction<typeof createNotification>;
const mockedSendDisputeEmails = sendDisputeEmails as jest.MockedFunction<typeof sendDisputeEmails>;
const mockedValidateRequest = validateRequest as jest.Mock;

const orderId = "cm1234567890abcdefghijkl";
const ordinaryBuyer = {
  id: "buyer-user-1",
  sellerId: "buyer-wallet-1",
  email: "buyer@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
  isBanned: false,
};
const managedBuyer = {
  ...ordinaryBuyer,
  email: "organizer@primary-staging.example.invalid",
  phone: "+15550001001",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
};

function request() {
  return new Request("http://localhost/api/orders/dispute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId, ticketIds: ["ticket-1"], reason: "Synthetic dispute." }),
  });
}

describe("buyer dispute-open staging-persona boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRequireUser.mockResolvedValue({
      ok: true,
      user: { id: ordinaryBuyer.id, sellerId: "stale-wallet" },
    } as never);
    mockedValidateRequest.mockReturnValue(
      jest.fn().mockResolvedValue({
        success: true,
        data: {
          orderId,
          ticketIds: ["ticket-1"],
          reason: "Synthetic dispute.",
          evidence: null,
          evidenceFiles: [],
        },
      }),
    );
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryBuyer);
    mockedPrisma.user.findMany.mockResolvedValue([{ id: "admin-user-1" }]);
    mockedPrisma.order.findUnique.mockResolvedValue({
      id: orderId,
      buyerSellerId: ordinaryBuyer.sellerId,
      sellerId: "seller-1",
      status: "PAID",
      transferVerificationStatus: "PENDING",
      buyerConfirmationStatus: "PENDING",
      disputeWindowEndsAt: new Date("2099-01-01T00:00:00.000Z"),
      seller: { user: { id: "seller-user-1", email: "seller@example.test", firstName: "Seller" } },
      buyerSeller: { user: { id: ordinaryBuyer.id, email: ordinaryBuyer.email, firstName: "Buyer" } },
      items: [{
        ticketId: "ticket-1",
        ticket: {
          title: "Synthetic Event",
          venue: "Synthetic Venue",
          date: new Date("2098-12-01T00:00:00.000Z"),
          row: "A",
          seat: "1",
        },
      }],
    });
    mockedPrisma.order.update.mockResolvedValue({
      id: orderId,
      status: "PAID",
      buyerConfirmationStatus: "DISPUTED",
      transferVerificationStatus: "MANUAL_REVIEW",
    });
    mockedAuditLog.mockResolvedValue(undefined);
    mockedCreateNotification.mockResolvedValue({ ok: true } as never);
    mockedSendDisputeEmails.mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("refuses a restored managed buyer before order reads or delivery", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedBuyer);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedSendDisputeEmails).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedBuyer);
    mockedPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" }),
    );

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedSendDisputeEmails).not.toHaveBeenCalled();
  });

  it("refuses a current ordinary ban before order reads or delivery", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryBuyer, isBanned: true });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "BANNED" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedSendDisputeEmails).not.toHaveBeenCalled();
  });

  it("commits the locked dispute before dispatching its prepared email envelope", async () => {
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
        status: "PAID",
        buyerConfirmationStatus: "DISPUTED",
        transferVerificationStatus: "MANUAL_REVIEW",
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
    expect(mockedPrisma.order.update).toHaveBeenCalledTimes(1);
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
      idempotencyKeyPrefix: `dispute-opened:${orderId}`,
    }));
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
      order: { buyerConfirmationStatus: "DISPUTED" },
    });
    expect(mockedPrisma.order.update).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "[EMAIL] Dispute-opened notifications failed after commit:",
      "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: synthetic post-commit providerless failure",
    );
  });

  it("rechecks the locked order before a repeated dispute", async () => {
    mockedPrisma.order.findUnique.mockResolvedValue({
      buyerSellerId: ordinaryBuyer.sellerId,
      status: "PAID",
      transferVerificationStatus: "MANUAL_REVIEW",
      buyerConfirmationStatus: "DISPUTED",
      disputeWindowEndsAt: new Date("2099-01-01T00:00:00.000Z"),
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_STATE" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
    expect(mockedCreateNotification).not.toHaveBeenCalled();
    expect(mockedSendDisputeEmails).not.toHaveBeenCalled();
  });
});
