/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { auditLog } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/service";
import { parseDisputeCase, sendDisputeEmails } from "@/lib/disputes";
import { awardLaunchSale } from "@/lib/launchPromotion";
import { validateRequest } from "@/lib/validation";
import { POST } from "@/app/api/orders/dispute/cancel/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
    ticket: { updateMany: jest.fn() },
    sellerMetrics: { upsert: jest.fn() },
    payout: { findFirst: jest.fn(), create: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth/guards", () => ({ requireUser: jest.fn() }));
jest.mock("@/lib/audit", () => ({ auditLog: jest.fn(), createAuditContext: jest.fn(() => ({})) }));
jest.mock("@/lib/notifications/service", () => ({ createNotification: jest.fn() }));
jest.mock("@/lib/disputes", () => ({
  DISPUTE_SUPPORT_EMAIL: "support@example.test",
  parseDisputeCase: jest.fn(),
  sendDisputeEmails: jest.fn(),
}));
jest.mock("@/lib/launchPromotion", () => ({ awardLaunchSale: jest.fn() }));
jest.mock("@/lib/validation", () => ({
  schemas: { orderCancelDispute: { kind: "order-cancel-dispute" } },
  validateRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  order: { findUnique: jest.Mock; update: jest.Mock };
  ticket: { updateMany: jest.Mock };
  sellerMetrics: { upsert: jest.Mock };
  payout: { findFirst: jest.Mock; create: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireUser = requireUser as jest.MockedFunction<typeof requireUser>;
const mockedAuditLog = auditLog as jest.MockedFunction<typeof auditLog>;
const mockedCreateNotification = createNotification as jest.MockedFunction<typeof createNotification>;
const mockedParseDisputeCase = parseDisputeCase as jest.MockedFunction<typeof parseDisputeCase>;
const mockedSendDisputeEmails = sendDisputeEmails as jest.MockedFunction<typeof sendDisputeEmails>;
const mockedAwardLaunchSale = awardLaunchSale as jest.MockedFunction<typeof awardLaunchSale>;
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
const dispute = {
  type: "BUYER_DISPUTE" as const,
  openedAt: "2098-12-01T00:00:00.000Z",
  openedByUserId: ordinaryBuyer.id,
  ticketIds: ["ticket-1"],
  ticketCount: 1,
  reason: "Synthetic dispute.",
  evidence: null,
  evidenceFiles: [],
  submissions: [],
};

function request() {
  return new Request("http://localhost/api/orders/dispute/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId, satisfactorilyResolved: true }),
  });
}

describe("dispute cancellation staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    mockedRequireUser.mockResolvedValue({
      ok: true,
      user: { id: ordinaryBuyer.id, sellerId: "stale-wallet" },
    } as never);
    mockedValidateRequest.mockReturnValue(
      jest.fn().mockResolvedValue({ success: true, data: { orderId, satisfactorilyResolved: true } }),
    );
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryBuyer);
    mockedPrisma.order.findUnique.mockResolvedValue({
      id: orderId,
      amountCents: 12_500,
      buyerSellerId: ordinaryBuyer.sellerId,
      sellerId: "seller-1",
      buyerConfirmationStatus: "DISPUTED",
      transferVerificationStatus: "MANUAL_REVIEW",
      transferVerificationReason: JSON.stringify(dispute),
      seller: { user: { id: "seller-user-1", email: "seller@example.test", firstName: "Seller" } },
      buyerSeller: { user: { id: ordinaryBuyer.id, email: ordinaryBuyer.email, firstName: "Buyer" } },
      items: [{
        ticketId: "ticket-1",
        ticket: {
          id: "ticket-1",
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
      status: "COMPLETED",
      buyerConfirmationStatus: "CONFIRMED",
      transferVerificationStatus: "MATCHED",
    });
    mockedPrisma.ticket.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.sellerMetrics.upsert.mockResolvedValue({ sellerId: "seller-1" });
    mockedPrisma.payout.findFirst.mockResolvedValue(null);
    mockedPrisma.payout.create.mockResolvedValue({ id: "payout-1" });
    mockedParseDisputeCase.mockReturnValue(dispute);
    mockedAuditLog.mockResolvedValue(undefined);
    mockedCreateNotification.mockResolvedValue({ ok: true } as never);
    mockedSendDisputeEmails.mockResolvedValue(undefined);
    mockedAwardLaunchSale.mockResolvedValue({ granted: false, amount: 0 });
  });

  afterEach(() => jest.restoreAllMocks());

  it("refuses a restored managed buyer before order reads or mutation", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedBuyer);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
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
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
    expect(mockedSendDisputeEmails).not.toHaveBeenCalled();
  });

  it("refuses a current ordinary ban before order reads or mutation", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryBuyer, isBanned: true });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "BANNED" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
    expect(mockedSendDisputeEmails).not.toHaveBeenCalled();
  });

  it("completes the order and records cancellation evidence through one locked serializable boundary", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, order: { status: "COMPLETED" } });
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.ticket.updateMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.sellerMetrics.upsert).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.payout.create).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.update).toHaveBeenCalledTimes(1);
    expect(mockedAwardLaunchSale).toHaveBeenCalledWith(mockedPrisma, expect.objectContaining({ orderId }));
    expect(mockedAuditLog).toHaveBeenCalledWith(expect.any(Object), mockedPrisma);
    expect(mockedCreateNotification).toHaveBeenCalledWith(expect.any(Object), mockedPrisma);
    expect(mockedSendDisputeEmails).toHaveBeenCalledWith(expect.any(Object), mockedPrisma);
  });

  it("rechecks the locked dispute before completing the order", async () => {
    mockedPrisma.order.findUnique.mockResolvedValue({
      buyerSellerId: ordinaryBuyer.sellerId,
      buyerConfirmationStatus: "CONFIRMED",
      transferVerificationStatus: "MATCHED",
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_STATE" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
    expect(mockedCreateNotification).not.toHaveBeenCalled();
    expect(mockedSendDisputeEmails).not.toHaveBeenCalled();
  });
});
