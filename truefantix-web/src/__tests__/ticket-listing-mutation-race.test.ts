/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireSellerApproved } from "@/lib/auth/guards";
import { DELETE, PATCH } from "@/app/api/tickets/[id]/route";
import { fetchOfficialSnapshot } from "@/lib/officialPricing";
import { getTicketImage } from "@/lib/imageSearch";
import { analyzeReceiptProof } from "@/lib/tickets/receiptOcr";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    ticket: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    event: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({
  requireSellerApproved: jest.fn(),
}));

jest.mock("@/lib/officialPricing", () => ({
  fetchOfficialSnapshot: jest.fn(),
}));

jest.mock("@/lib/imageSearch", () => ({
  getTicketImage: jest.fn(),
}));

jest.mock("@/lib/tickets/receiptOcr", () => ({
  analyzeReceiptProof: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  ticket: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  event: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireSellerApproved = requireSellerApproved as jest.MockedFunction<
  typeof requireSellerApproved
>;
const mockedOfficialSnapshot = fetchOfficialSnapshot as jest.MockedFunction<
  typeof fetchOfficialSnapshot
>;
const mockedTicketImage = getTicketImage as jest.MockedFunction<typeof getTicketImage>;
const mockedReceiptProof = analyzeReceiptProof as jest.MockedFunction<typeof analyzeReceiptProof>;

const ordinaryUser = {
  id: "user-1",
  email: "ordinary@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
  isBanned: false,
  canSell: true,
  seller: { id: "current-seller", status: "APPROVED" },
};

const managedUser = {
  ...ordinaryUser,
  email: "admin@primary-staging.example.invalid",
  phone: "+15550001002",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
  canSell: false,
  seller: null,
};

function request(method: "PATCH" | "DELETE", body?: object) {
  return new Request("http://localhost/api/tickets/ticket-1", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("ticket listing staging-persona boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireSellerApproved.mockResolvedValue({
      ok: true,
      user: { id: ordinaryUser.id, sellerId: "stale-seller" },
    } as never);
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedOfficialSnapshot.mockRejectedValue(new Error("provider must not be called"));
    mockedTicketImage.mockRejectedValue(new Error("image lookup must not be called"));
    mockedReceiptProof.mockRejectedValue(new Error("receipt OCR must not be called"));
  });

  it("locks and uses the current seller relationship when withdrawing a listing", async () => {
    mockedPrisma.ticket.findUnique.mockResolvedValue({
      id: "ticket-1",
      sellerId: "current-seller",
      status: "AVAILABLE",
      reservedUntil: null,
      reservedByOrderId: null,
    });
    mockedPrisma.ticket.updateMany.mockResolvedValue({ count: 1 });

    const response = await DELETE(request("DELETE"));

    expect(response.status).toBe(200);
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockedPrisma.ticket.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sellerId: "current-seller" }),
    }));
  });

  it.each([
    ["PATCH", PATCH],
    ["DELETE", DELETE],
  ] as const)("refuses a restored managed user before %s listing access", async (method, handler) => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await handler(request(method, method === "PATCH" ? {} : undefined));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("private");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.ticket.findUnique).not.toHaveBeenCalled();
    expect(mockedOfficialSnapshot).not.toHaveBeenCalled();
    expect(mockedTicketImage).not.toHaveBeenCalled();
    expect(mockedReceiptProof).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);
    mockedPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" }),
    );

    const response = await DELETE(request("DELETE"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.ticket.findUnique).not.toHaveBeenCalled();
  });

  it("preserves an ordinary seller-status downgrade refusal", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      ...ordinaryUser,
      canSell: false,
    });

    const response = await DELETE(request("DELETE"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "SELLER_NOT_APPROVED" });
    expect(mockedPrisma.ticket.findUnique).not.toHaveBeenCalled();
  });
});
