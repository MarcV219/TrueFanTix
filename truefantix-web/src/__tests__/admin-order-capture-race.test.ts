/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { applyRateLimit } from "@/lib/rate-limit";
import { auditLog } from "@/lib/audit";
import { notifySellerTransferRequired } from "@/lib/orders/transferWorkflow";
import { POST } from "@/app/api/admin/orders/[id]/capture/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
    ticket: { findMany: jest.fn() },
    payment: { upsert: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth/guards", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ applyRateLimit: jest.fn() }));
jest.mock("@/lib/audit", () => ({
  auditLog: jest.fn(),
  createAuditContext: jest.fn(() => ({})),
}));
jest.mock("@/lib/orders/transferWorkflow", () => ({
  notifySellerTransferRequired: jest.fn(),
  sellerTransferDeadline: jest.fn(() => new Date("2099-01-02T00:00:00.000Z")),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  order: { findUnique: jest.Mock; update: jest.Mock };
  ticket: { findMany: jest.Mock };
  payment: { upsert: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockedApplyRateLimit = applyRateLimit as jest.MockedFunction<typeof applyRateLimit>;
const mockedAuditLog = auditLog as jest.MockedFunction<typeof auditLog>;
const mockedNotifySellerTransferRequired = notifySellerTransferRequired as jest.MockedFunction<
  typeof notifySellerTransferRequired
>;

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
  return new Request(`http://localhost/api/admin/orders/${orderId}/capture`, {
    method: "POST",
  });
}

describe("admin order capture staging-persona boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireAdmin.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    mockedApplyRateLimit.mockResolvedValue({ ok: true });
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryAdmin);
    mockedPrisma.order.findUnique.mockResolvedValue({
      id: orderId,
      status: "PENDING",
      totalCents: 5495,
      currency: "CAD",
      items: [{ id: "item-1", ticketId: "ticket-1" }],
    });
    mockedPrisma.ticket.findMany.mockResolvedValue([{
      id: "ticket-1",
      status: "RESERVED",
      reservedByOrderId: orderId,
      reservedUntil: new Date("2099-01-01T00:00:00.000Z"),
    }]);
    mockedPrisma.payment.upsert.mockResolvedValue({
      id: "payment-1",
      orderId,
      status: "SUCCEEDED",
    });
    mockedPrisma.order.update.mockResolvedValue({
      id: orderId,
      status: "PAID",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      items: [{ id: "item-1", ticketId: "ticket-1" }],
      payment: { updatedAt: new Date("2026-01-01T00:01:00.000Z") },
      seller: { user: { id: "seller-user-1" } },
    });
    mockedAuditLog.mockResolvedValue(undefined);
    mockedNotifySellerTransferRequired.mockResolvedValue({ ok: true } as never);
  });

  it("refuses a restored managed administrator before payment mutation", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedAdmin);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.payment.upsert).not.toHaveBeenCalled();
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
    expect(mockedNotifySellerTransferRequired).not.toHaveBeenCalled();
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
    expect(mockedPrisma.payment.upsert).not.toHaveBeenCalled();
  });

  it("refuses an ordinary role downgrade before payment mutation", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryAdmin, role: "USER" });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "FORBIDDEN" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.payment.upsert).not.toHaveBeenCalled();
  });

  it("captures through one serializable transaction for a current administrator", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      order: { id: orderId, status: "PAID" },
      payment: { id: "payment-1", status: "SUCCEEDED" },
    });
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockedPrisma.payment.upsert).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.update).toHaveBeenCalledTimes(1);
    expect(mockedNotifySellerTransferRequired).toHaveBeenCalledWith(
      expect.objectContaining({ sellerUserId: "seller-user-1", orderId }),
    );
  });
});
