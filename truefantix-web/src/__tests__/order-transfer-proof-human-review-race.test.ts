/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { auditLog } from "@/lib/audit";
import { validateRequest } from "@/lib/validation";
import {
  drainTransferProofReviewDeliveryIntents,
  stageTransferProofReviewDeliveryIntent,
} from "@/lib/orders/transferProofReviewDelivery";
import { POST } from "@/app/api/orders/transfer-proof/human-review/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth/guards", () => ({ requireUser: jest.fn() }));
jest.mock("@/lib/audit", () => ({ auditLog: jest.fn(), createAuditContext: jest.fn(() => ({})) }));
jest.mock("@/lib/disputes", () => ({ DISPUTE_SUPPORT_EMAIL: "support@example.test" }));
jest.mock("@/lib/orders/transferProofReviewDelivery", () => ({
  drainTransferProofReviewDeliveryIntents: jest.fn(),
  stageTransferProofReviewDeliveryIntent: jest.fn(),
}));
jest.mock("@/lib/validation", () => ({
  schemas: { orderTransferProof: { kind: "order-transfer-proof" } },
  validateRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  order: { findUnique: jest.Mock; update: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireUser = requireUser as jest.MockedFunction<typeof requireUser>;
const mockedAuditLog = auditLog as jest.MockedFunction<typeof auditLog>;
const mockedValidateRequest = validateRequest as jest.Mock;
const mockedStageDelivery = stageTransferProofReviewDeliveryIntent as jest.MockedFunction<
  typeof stageTransferProofReviewDeliveryIntent
>;
const mockedDrainDelivery = drainTransferProofReviewDeliveryIntents as jest.MockedFunction<
  typeof drainTransferProofReviewDeliveryIntents
>;

const orderId = "cm1234567890abcdefghijkl";
const ordinarySeller = {
  id: "seller-user-1",
  sellerId: "seller-1",
  email: "seller@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
  isBanned: false,
};
const managedSeller = {
  ...ordinarySeller,
  email: "reviewer@primary-staging.example.invalid",
  phone: "+15550001003",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
};
const order = {
  id: orderId,
  sellerId: ordinarySeller.sellerId,
  status: "PAID",
  buyerConfirmationStatus: "PENDING",
  transferVerificationStatus: null,
  disputeWindowEndsAt: null,
  items: [{ ticket: { title: "Synthetic Event" } }],
  seller: {
    name: "Synthetic Seller",
    user: { email: ordinarySeller.email, firstName: "Seller", lastName: "Example" },
  },
};

function request() {
  return new Request("http://localhost/api/orders/transfer-proof/human-review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId, transferProofType: "Screenshot", transferProofImage: "synthetic-proof" }),
  });
}

describe("seller transfer-proof human-review race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRequireUser.mockResolvedValue({
      ok: true,
      user: { id: ordinarySeller.id, sellerId: "stale-seller", email: ordinarySeller.email },
    } as never);
    mockedValidateRequest.mockReturnValue(
      jest.fn().mockResolvedValue({
        success: true,
        data: {
          orderId,
          transferProofType: "Screenshot",
          transferProofData: "Synthetic seller note",
          transferProofImage: "synthetic-proof",
          transferProofFileName: "proof.png",
        },
      }),
    );
    mockedPrisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ now: new Date("2026-09-14T20:42:00.000Z") }]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(ordinarySeller);
    mockedPrisma.order.findUnique.mockResolvedValue(order);
    mockedPrisma.order.update.mockResolvedValue({ id: orderId });
    mockedStageDelivery.mockResolvedValue({ id: "delivery-1" } as never);
    mockedDrainDelivery.mockResolvedValue({
      scanned: 1, claimed: 1, delivered: 1, failed: 0, reconciliationRequired: 0,
    });
    mockedAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("refuses a restored managed seller before order reads or delivery", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedSeller);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedStageDelivery).not.toHaveBeenCalled();
    expect(mockedDrainDelivery).not.toHaveBeenCalled();
    expect(mockedAuditLog).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedSeller);
    mockedPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" }),
    );

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedStageDelivery).not.toHaveBeenCalled();
    expect(mockedDrainDelivery).not.toHaveBeenCalled();
  });

  it("refuses a current ordinary ban before order reads or delivery", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinarySeller, isBanned: true });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "BANNED" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedStageDelivery).not.toHaveBeenCalled();
    expect(mockedDrainDelivery).not.toHaveBeenCalled();
  });

  it("uses the current locked seller identity instead of the stale session wallet", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinarySeller, sellerId: "current-seller" });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "FORBIDDEN" });
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
    expect(mockedStageDelivery).not.toHaveBeenCalled();
    expect(mockedDrainDelivery).not.toHaveBeenCalled();
  });

  it("stages the review, delivery record, and audit through one locked transaction", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, alreadyRequested: false });
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.order.update).toHaveBeenCalledTimes(1);
    expect(mockedStageDelivery).toHaveBeenCalledTimes(1);
    expect(mockedAuditLog).toHaveBeenCalledWith(expect.any(Object), mockedPrisma);
    expect(mockedStageDelivery.mock.invocationCallOrder[0])
      .toBeLessThan(mockedDrainDelivery.mock.invocationCallOrder[0]);
    expect(mockedDrainDelivery).toHaveBeenCalledWith({ orderId });
  });

  it("refuses accepted-proof replacement before proof mutation or delivery", async () => {
    mockedPrisma.order.findUnique.mockResolvedValue({
      ...order,
      transferVerificationStatus: "PENDING",
      disputeWindowEndsAt: new Date("2026-12-02T00:00:00.000Z"),
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "TRANSFER_PROOF_ALREADY_SUBMITTED",
    });
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
    expect(mockedStageDelivery).not.toHaveBeenCalled();
    expect(mockedDrainDelivery).not.toHaveBeenCalled();
    expect(mockedAuditLog).not.toHaveBeenCalled();
  });

  it("does not replace an already pending manual-review snapshot", async () => {
    mockedPrisma.order.findUnique.mockResolvedValue({
      ...order,
      transferVerificationStatus: "MANUAL_REVIEW",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, alreadyRequested: true });
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
    expect(mockedStageDelivery).not.toHaveBeenCalled();
    expect(mockedDrainDelivery).toHaveBeenCalledWith({ orderId });
    expect(mockedAuditLog).toHaveBeenCalledWith(expect.any(Object), mockedPrisma);
  });

  it("does not dispatch a staged review delivery when the transaction rolls back", async () => {
    mockedPrisma.$transaction.mockImplementation(async (work: (tx: typeof mockedPrisma) => unknown) => {
      await work(mockedPrisma);
      throw Object.assign(new Error("serialization failure"), { code: "P2034" });
    });

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mockedStageDelivery).toHaveBeenCalledTimes(1);
    expect(mockedDrainDelivery).not.toHaveBeenCalled();
  });
});
