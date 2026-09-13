/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { POST } from "@/app/api/admin/orders/[id]/deliver/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
    ticket: { findMany: jest.fn(), updateMany: jest.fn() },
    payment: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth/guards", () => ({ requireAdmin: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  order: { findUnique: jest.Mock; update: jest.Mock };
  ticket: { findMany: jest.Mock; updateMany: jest.Mock };
  payment: { findUnique: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;

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
  return new Request(`http://localhost/api/admin/orders/${orderId}/deliver`, {
    method: "POST",
  });
}

describe("admin order delivery staging-persona boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireAdmin.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryAdmin);
    mockedPrisma.order.findUnique.mockResolvedValue({
      id: orderId,
      status: "PAID",
      items: [{ id: "item-1", ticketId: "ticket-1" }],
    });
    mockedPrisma.payment.findUnique.mockResolvedValue({ id: "payment-1", status: "SUCCEEDED" });
    mockedPrisma.ticket.findMany.mockResolvedValue([{
      id: "ticket-1",
      status: "RESERVED",
      reservedByOrderId: orderId,
      reservedUntil: new Date("2099-01-01T00:00:00.000Z"),
    }]);
    mockedPrisma.ticket.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.order.update.mockResolvedValue({
      id: orderId,
      status: "DELIVERED",
      items: [{ id: "item-1", ticketId: "ticket-1" }],
      payment: { id: "payment-1", status: "SUCCEEDED" },
    });
  });

  it("refuses a restored managed administrator before ticket mutation", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedAdmin);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
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
    expect(mockedPrisma.ticket.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an ordinary role downgrade before ticket mutation", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryAdmin, role: "USER" });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "FORBIDDEN" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.ticket.updateMany).not.toHaveBeenCalled();
  });

  it("delivers through one serializable transaction for a current administrator", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      order: { id: orderId, status: "DELIVERED" },
      ticketsUpdated: 1,
    });
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockedPrisma.ticket.updateMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.update).toHaveBeenCalledTimes(1);
  });
});
