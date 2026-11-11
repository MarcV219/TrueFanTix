/** @jest-environment node */

import { POST } from "@/app/api/admin/reservations/expire/route";
import { prisma } from "@/lib/prisma";
import { releaseOrderAccessTokenHolds } from "@/lib/accessTokenHolds";

jest.mock("@/lib/prisma", () => ({ prisma: { $transaction: jest.fn() } }));
jest.mock("@/lib/auth/guards", () => ({
  hasInternalCronAuth: jest.fn(() => true),
  requireAdmin: jest.fn(),
}));
jest.mock("@/lib/rate-limit", () => ({ applyRateLimit: jest.fn() }));
jest.mock("@/lib/audit", () => ({
  auditLog: jest.fn(),
  createAuditContext: jest.fn(() => ({})),
}));
jest.mock("@/lib/accessTokenHolds", () => ({ releaseOrderAccessTokenHolds: jest.fn() }));

const mockedPrisma = prisma as unknown as { $transaction: jest.Mock };
const mockedReleaseHolds = releaseOrderAccessTokenHolds as jest.MockedFunction<typeof releaseOrderAccessTokenHolds>;

function request() {
  return new Request("http://localhost/api/admin/reservations/expire", {
    method: "POST",
    headers: { authorization: "Bearer synthetic-cron" },
  });
}

function makeTx(cancelledCount: number) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    order: { updateMany: jest.fn().mockResolvedValue({ count: cancelledCount }) },
    ticket: {
      findMany: jest.fn().mockResolvedValue([{ id: "ticket-1", reservedByOrderId: "order-1" }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe("reservation expiry transaction fence", () => {
  beforeEach(() => jest.clearAllMocks());

  it("uses the inclusive expiry boundary and releases only after winning cancellation", async () => {
    const tx = makeTx(1);
    mockedPrisma.$transaction.mockImplementation((work) => work(tx));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(tx.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ reservedUntil: { lte: expect.any(Date) } }),
    }));
    expect(tx.ticket.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ reservedUntil: { lte: expect.any(Date) } }),
    }));
    expect(mockedReleaseHolds).toHaveBeenCalledWith(tx, "order-1");
  });

  it("does not release tickets when a webhook already won the order transition", async () => {
    const tx = makeTx(0);
    mockedPrisma.$transaction.mockImplementation((work) => work(tx));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(tx.ticket.updateMany).not.toHaveBeenCalled();
    expect(mockedReleaseHolds).not.toHaveBeenCalled();
  });
});
