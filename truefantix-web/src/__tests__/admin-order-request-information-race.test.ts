/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { auditLog } from "@/lib/audit";
import { generateDisputeInformationRequestEmail, sendEmail } from "@/lib/email";
import { parseDisputeCase } from "@/lib/disputes";
import { createNotification } from "@/lib/notifications/service";
import { validateRequest } from "@/lib/validation";
import { POST } from "@/app/api/admin/orders/[id]/request-information/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    order: { findUnique: jest.fn(), update: jest.fn() },
    emailDelivery: { create: jest.fn(), updateMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth/guards", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/audit", () => ({ auditLog: jest.fn(), createAuditContext: jest.fn(() => ({})) }));
jest.mock("@/lib/email", () => ({
  generateDisputeInformationRequestEmail: jest.fn(),
  sendEmail: jest.fn(),
}));
jest.mock("@/lib/disputes", () => ({ parseDisputeCase: jest.fn() }));
jest.mock("@/lib/notifications/service", () => ({ createNotification: jest.fn() }));
jest.mock("@/lib/validation", () => ({
  schemas: { adminRequestDisputeInformation: { kind: "admin-request-dispute-information" } },
  validateRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  order: { findUnique: jest.Mock; update: jest.Mock };
  emailDelivery: { create: jest.Mock; updateMany: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockedAuditLog = auditLog as jest.MockedFunction<typeof auditLog>;
const mockedGenerateEmail = generateDisputeInformationRequestEmail as jest.MockedFunction<
  typeof generateDisputeInformationRequestEmail
>;
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;
const mockedParseDisputeCase = parseDisputeCase as jest.MockedFunction<typeof parseDisputeCase>;
const mockedCreateNotification = createNotification as jest.MockedFunction<typeof createNotification>;
const mockedValidateRequest = validateRequest as jest.Mock;

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
  return new Request(`http://localhost/api/admin/orders/${orderId}/request-information`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: "BUYER", message: "Please send synthetic evidence." }),
  });
}

describe("admin dispute-information staging-persona boundary", () => {
  let storedReason: string;

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
        data: { recipient: "BUYER", message: "Please send synthetic evidence." },
      }),
    );
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryAdmin);
    storedReason = JSON.stringify({ type: "BUYER_DISPUTE", adminRequests: [] });
    mockedPrisma.order.findUnique.mockImplementation(async () => ({
      id: orderId,
      buyerConfirmationStatus: "DISPUTED",
      transferVerificationReason: storedReason,
      seller: { user: { id: "seller-user-1", email: "seller@example.test", firstName: "Seller" } },
      buyerSeller: { user: { id: "buyer-user-1", email: "buyer@example.test", firstName: "Buyer" } },
    }));
    mockedPrisma.order.update.mockImplementation(async ({ data }: { data: { transferVerificationReason?: string } }) => {
      if (data.transferVerificationReason) storedReason = data.transferVerificationReason;
      return { id: orderId };
    });
    mockedPrisma.emailDelivery.create.mockResolvedValue({ id: "delivery-1" });
    mockedPrisma.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
    mockedParseDisputeCase.mockImplementation((value) => JSON.parse(value || "null"));
    mockedGenerateEmail.mockReturnValue({ subject: "Synthetic request", text: "Synthetic request" } as never);
    mockedSendEmail.mockResolvedValue({ ok: true, provider: "SENDGRID" });
    mockedCreateNotification.mockResolvedValue({ ok: true } as never);
    mockedAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("refuses a restored managed administrator before dispute reads or delivery", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedAdmin);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedCreateNotification).not.toHaveBeenCalled();
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

  it("refuses an ordinary role downgrade before dispute reads or delivery", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryAdmin, role: "USER" });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "FORBIDDEN" });
    expect(mockedPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("commits the request before dispatch and then finalizes delivery evidence", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, warning: false });
    expect(mockedPrisma.$transaction).toHaveBeenNthCalledWith(1, expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockedPrisma.$transaction).toHaveBeenNthCalledWith(2, expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(3);
    expect(mockedPrisma.order.update).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.emailDelivery.create).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.emailDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ provider: "CONSOLE", status: "ATTEMPTING" }),
    });
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^dispute-info-request:/),
    }));
    expect(mockedPrisma.order.update.mock.invocationCallOrder[0])
      .toBeLessThan(mockedSendEmail.mock.invocationCallOrder[0]);
    expect(mockedPrisma.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "ATTEMPTING" }),
      data: expect.objectContaining({ provider: "SENDGRID", status: "SENT" }),
    }));
    expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockedCreateNotification).toHaveBeenCalledWith(expect.any(Object), mockedPrisma);
    expect(mockedAuditLog).toHaveBeenCalledTimes(1);
    expect(mockedAuditLog).toHaveBeenCalledWith(expect.any(Object), mockedPrisma);
  });

  it("performs no email send when the request transaction does not commit", async () => {
    mockedPrisma.$transaction.mockImplementationOnce(
      async (work: (tx: typeof mockedPrisma) => unknown) => {
        await work(mockedPrisma);
        throw Object.assign(new Error("synthetic commit failure"), { code: "P2034" });
      },
    );

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedPrisma.emailDelivery.updateMany).not.toHaveBeenCalled();
  });

  it("records neutral evidence when the sender rejects without provider identity", async () => {
    const previousResendApiKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "synthetic-configured-but-unattributed-key";
    mockedSendEmail.mockRejectedValueOnce(new Error("synthetic providerless failure"));

    try {
      const response = await POST(request());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, warning: true });
      expect(mockedPrisma.emailDelivery.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ provider: "CONSOLE", status: "ATTEMPTING" }),
      });
      expect(mockedPrisma.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          provider: "CONSOLE",
          status: "FAILED",
          error: "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: synthetic providerless failure",
        }),
      }));
      expect(mockedPrisma.order.update).toHaveBeenCalledTimes(2);
      expect(mockedCreateNotification).toHaveBeenCalledTimes(1);
      expect(mockedAuditLog).toHaveBeenCalledTimes(1);
    } finally {
      if (previousResendApiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResendApiKey;
    }
  });
});
