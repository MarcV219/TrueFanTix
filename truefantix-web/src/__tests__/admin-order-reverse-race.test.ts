/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { refundOrderAccessTokens } from "@/lib/accessTokenHolds";
import { POST } from "@/app/api/orders/[id]/reverse/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
    ticket: { updateMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth/guards", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/accessTokenHolds", () => ({ refundOrderAccessTokens: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  order: { findUnique: jest.Mock; update: jest.Mock };
  ticket: { updateMany: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockedRefundOrderAccessTokens = refundOrderAccessTokens as jest.MockedFunction<
  typeof refundOrderAccessTokens
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
  return new Request(`http://localhost/api/orders/${orderId}/reverse`, { method: "POST" });
}

function context() {
  return { params: Promise.resolve({ id: orderId }) };
}

describe("admin order reversal staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
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
      items: [{ ticketId: "ticket-1" }],
      payment: { status: "SUCCEEDED" },
      buyer: { user: { id: "buyer-user-1" } },
    });
    mockedPrisma.order.update.mockResolvedValue({ id: orderId, status: "CANCELLED" });
    mockedPrisma.ticket.updateMany.mockResolvedValue({ count: 1 });
    mockedRefundOrderAccessTokens.mockResolvedValue({ refunded: 1 } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it("refuses a restored managed administrator before order reads or mutation", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedAdmin);

    const response = await POST(request(), context());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
    expect(mockedRefundOrderAccessTokens).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedAdmin);
    mockedPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" }),
    );

    const response = await POST(request(), context());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
  });

  it("refuses an ordinary role downgrade before order reads or mutation", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryAdmin, role: "USER" });

    const response = await POST(request(), context());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "FORBIDDEN" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
    expect(mockedRefundOrderAccessTokens).not.toHaveBeenCalled();
  });

  it("reverses through one locked serializable transaction for a current administrator", async () => {
    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      message: "Order reversed and tickets restored.",
    });
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: orderId },
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
    expect(mockedPrisma.ticket.updateMany).toHaveBeenCalledTimes(1);
    expect(mockedRefundOrderAccessTokens).toHaveBeenCalledWith(mockedPrisma, orderId);
  });

  it("rechecks the locked order state before restoring tickets or access tokens", async () => {
    mockedPrisma.order.findUnique.mockResolvedValue({
      id: orderId,
      status: "CANCELLED",
      items: [{ ticketId: "ticket-1" }],
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "BAD_STATE" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.order.update).not.toHaveBeenCalled();
    expect(mockedPrisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(mockedRefundOrderAccessTokens).not.toHaveBeenCalled();
  });
});
