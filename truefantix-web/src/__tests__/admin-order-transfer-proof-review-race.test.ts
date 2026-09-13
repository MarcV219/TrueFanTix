/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { auditLog } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { createNotification } from "@/lib/notifications/service";
import { notifyBuyerTransferConfirmationRequired } from "@/lib/orders/transferWorkflow";
import { validateRequest } from "@/lib/validation";
import { sendAdminActivityEmail } from "@/lib/adminActivityEmail";
import { POST } from "@/app/api/admin/orders/[id]/review-transfer-proof/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    order: { findUnique: jest.fn(), updateMany: jest.fn() },
    emailDelivery: { create: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth/guards", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/audit", () => ({ auditLog: jest.fn(), createAuditContext: jest.fn(() => ({})) }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }));
jest.mock("@/lib/notifications/service", () => ({ createNotification: jest.fn() }));
jest.mock("@/lib/orders/transferWorkflow", () => ({
  BUYER_CONFIRMATION_DEADLINE_HOURS: 72,
  addHours: jest.fn((date: Date, hours: number) => new Date(date.getTime() + hours * 60 * 60 * 1000)),
  notifyBuyerTransferConfirmationRequired: jest.fn(),
}));
jest.mock("@/lib/validation", () => ({
  schemas: { adminReviewTransferProof: { kind: "admin-review-transfer-proof" } },
  validateRequest: jest.fn(),
}));
jest.mock("@/lib/adminActivityEmail", () => ({ sendAdminActivityEmail: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  order: { findUnique: jest.Mock; updateMany: jest.Mock };
  emailDelivery: { create: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockedAuditLog = auditLog as jest.MockedFunction<typeof auditLog>;
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;
const mockedCreateNotification = createNotification as jest.MockedFunction<typeof createNotification>;
const mockedNotifyBuyer = notifyBuyerTransferConfirmationRequired as jest.MockedFunction<
  typeof notifyBuyerTransferConfirmationRequired
>;
const mockedValidateRequest = validateRequest as jest.Mock;
const mockedSendAdminActivityEmail = sendAdminActivityEmail as jest.MockedFunction<typeof sendAdminActivityEmail>;

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
  return new Request(`http://localhost/api/admin/orders/${orderId}/review-transfer-proof`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "APPROVE", note: "Synthetic approval." }),
  });
}

describe("admin transfer-proof review staging-persona boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRequireAdmin.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", email: "admin@example.test", role: "ADMIN" },
    } as never);
    mockedValidateRequest.mockReturnValue(
      jest.fn().mockResolvedValue({
        success: true,
        data: { action: "APPROVE", note: "Synthetic approval." },
      }),
    );
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryAdmin);
    mockedPrisma.order.findUnique.mockResolvedValue({
      id: orderId,
      status: "PAID",
      buyerConfirmationStatus: "PENDING",
      transferVerificationStatus: "MANUAL_REVIEW",
      transferProofData: JSON.stringify({ proofUpload: "synthetic" }),
      seller: { user: { id: "seller-user-1", email: "seller@example.test", firstName: "Seller" } },
      buyerSeller: { user: { id: "buyer-user-1" } },
      items: [{ id: "item-1" }],
    });
    mockedPrisma.order.updateMany.mockResolvedValue({ count: 1 });
    mockedPrisma.emailDelivery.create.mockResolvedValue({ id: "delivery-1" });
    mockedSendEmail.mockResolvedValue({ ok: true });
    mockedCreateNotification.mockResolvedValue({ ok: true } as never);
    mockedNotifyBuyer.mockResolvedValue(undefined as never);
    mockedSendAdminActivityEmail.mockResolvedValue(undefined as never);
    mockedAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("refuses a restored managed administrator before review or delivery", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedAdmin);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.order.updateMany).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedCreateNotification).not.toHaveBeenCalled();
    expect(mockedNotifyBuyer).not.toHaveBeenCalled();
    expect(mockedSendAdminActivityEmail).not.toHaveBeenCalled();
    expect(mockedAuditLog).not.toHaveBeenCalled();
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
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("refuses an ordinary role downgrade before review or delivery", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryAdmin, role: "USER" });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "FORBIDDEN" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("reviews and dispatches through one serializable current-admin boundary", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, warning: false });
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockedPrisma.order.updateMany).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.emailDelivery.create).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockedNotifyBuyer).toHaveBeenCalledTimes(1);
    expect(mockedSendAdminActivityEmail).toHaveBeenCalledTimes(1);
    expect(mockedAuditLog).toHaveBeenCalledTimes(1);
  });
});
