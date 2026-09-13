/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { analyzeTransferProof } from "@/lib/orders/transferProofReview";
import {
  drainTransferProofDeliveryIntents,
  stageTransferProofDeliveryIntent,
} from "@/lib/orders/transferProofDelivery";
import { validateRequest } from "@/lib/validation";
import { POST } from "@/app/api/orders/transfer-proof/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth/guards", () => ({ requireUser: jest.fn() }));
jest.mock("@/lib/orders/transferProofReview", () => ({
  analyzeTransferProof: jest.fn(),
  transferProofIssueMessage: jest.fn((issue: string) => issue),
}));
jest.mock("@/lib/orders/transferWorkflow", () => ({
  BUYER_CONFIRMATION_DEADLINE_HOURS: 24,
  addHours: jest.fn((date: Date, hours: number) => new Date(date.getTime() + hours * 60 * 60 * 1000)),
}));
jest.mock("@/lib/orders/transferProofDelivery", () => ({
  stageTransferProofDeliveryIntent: jest.fn(),
  drainTransferProofDeliveryIntents: jest.fn(),
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
const mockedAnalyzeTransferProof = analyzeTransferProof as jest.MockedFunction<typeof analyzeTransferProof>;
const mockedStageDelivery = stageTransferProofDeliveryIntent as jest.MockedFunction<typeof stageTransferProofDeliveryIntent>;
const mockedDrainDelivery = drainTransferProofDeliveryIntents as jest.MockedFunction<typeof drainTransferProofDeliveryIntents>;
const mockedValidateRequest = validateRequest as jest.Mock;

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
  sellerId: "seller-1",
  status: "PAID",
  buyerConfirmationStatus: "PENDING",
  items: [{
    id: "item-1",
    ticket: {
      title: "Synthetic Event",
      venue: "Synthetic Venue",
      date: new Date("2026-12-01T00:00:00.000Z"),
      section: "101",
      row: "A",
      seat: "1",
    },
  }],
  buyerSeller: {
    user: {
      id: "buyer-user-1",
      email: "buyer@example.test",
      firstName: "Buyer",
      lastName: "Example",
    },
  },
};

function request() {
  return new Request("http://localhost/api/orders/transfer-proof", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId, transferProofType: "EMAIL", transferProofImage: "synthetic-proof" }),
  });
}

describe("seller transfer-proof staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRequireUser.mockResolvedValue({
      ok: true,
      user: { id: ordinarySeller.id, sellerId: ordinarySeller.sellerId, email: ordinarySeller.email },
    } as never);
    mockedValidateRequest.mockReturnValue(
      jest.fn().mockResolvedValue({
        success: true,
        data: {
          orderId,
          transferProofType: "EMAIL",
          transferProofData: "Synthetic seller note",
          transferProofImage: "synthetic-proof",
          transferProofFileName: "proof.png",
        },
      }),
    );
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(ordinarySeller);
    mockedPrisma.order.findUnique.mockResolvedValue(order);
    mockedPrisma.order.update.mockResolvedValue({
      id: orderId,
      status: "PAID",
      transferProofType: "EMAIL",
      transferVerificationStatus: "PENDING",
      disputeWindowEndsAt: new Date("2026-12-02T00:00:00.000Z"),
    });
    mockedAnalyzeTransferProof.mockResolvedValue({
      ok: true,
      status: "approved",
      provider: "synthetic",
      model: "synthetic",
      confidence: 1,
      issues: [],
      reason: "Synthetic proof accepted.",
    } as never);
    mockedStageDelivery.mockResolvedValue(undefined);
    mockedDrainDelivery.mockResolvedValue({ scanned: 2, claimed: 2, delivered: 2, failed: 0 });
  });

  afterEach(() => jest.restoreAllMocks());

  it("refuses a restored managed seller before order reads or provider work", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedSeller);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedAnalyzeTransferProof).not.toHaveBeenCalled();
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
    expect(mockedStageDelivery).not.toHaveBeenCalled();
    expect(mockedDrainDelivery).not.toHaveBeenCalled();
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
    expect(mockedAnalyzeTransferProof).not.toHaveBeenCalled();
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
  });

  it("refuses an ordinary ban before order reads or provider work", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinarySeller, isBanned: true });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "BANNED" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedAnalyzeTransferProof).not.toHaveBeenCalled();
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
  });

  it("reviews and persists through one locked serializable seller boundary", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockedAnalyzeTransferProof).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.update).toHaveBeenCalledTimes(1);
    expect(mockedStageDelivery).toHaveBeenCalledTimes(1);
    expect(mockedStageDelivery.mock.invocationCallOrder[0]).toBeLessThan(mockedDrainDelivery.mock.invocationCallOrder[0]);
    expect(mockedDrainDelivery).toHaveBeenCalledWith({ orderId });
  });

  it("rechecks the locked order state before provider work or mutation", async () => {
    mockedPrisma.order.findUnique.mockResolvedValue({ ...order, status: "COMPLETED" });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_STATE" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockedAnalyzeTransferProof).not.toHaveBeenCalled();
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
    expect(mockedStageDelivery).not.toHaveBeenCalled();
    expect(mockedDrainDelivery).not.toHaveBeenCalled();
  });

  it("does not dispatch staged delivery when the serializable transaction rolls back", async () => {
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
