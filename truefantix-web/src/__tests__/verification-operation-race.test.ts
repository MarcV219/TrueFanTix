/** @jest-environment node */

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { validateRequest } from "@/lib/validation";
import { POST as sendEmailCode } from "@/app/api/verify/email/send/route";
import { POST as confirmEmailCode } from "@/app/api/verify/email/confirm/route";
import { POST as sendPhoneCode } from "@/app/api/verify/phone/send/route";
import { POST as confirmPhoneCode } from "@/app/api/verify/phone/confirm/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    verificationCode: {
      count: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({ requireUser: jest.fn() }));
jest.mock("@/lib/email", () => ({
  generateVerificationEmail: jest.fn(() => ({
    subject: "Synthetic verification",
    text: "Synthetic verification",
    html: "<p>Synthetic verification</p>",
  })),
  sendEmail: jest.fn(),
}));
jest.mock("@/lib/sms", () => ({
  generateVerificationSms: jest.fn(() => ({ body: "Synthetic verification" })),
  sendSms: jest.fn(),
}));
jest.mock("@/lib/validation", () => ({
  schemas: { verificationCodeConfirm: { kind: "verification-confirm" } },
  validateRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock };
  verificationCode: {
    count: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireUser = requireUser as jest.MockedFunction<
  typeof requireUser
>;
const mockedSendEmail = sendEmail as jest.Mock;
const mockedSendSms = sendSms as jest.Mock;
const mockedValidateRequest = validateRequest as jest.Mock;

const secret = "verification-secret-that-is-long-enough";
const code = "123456";
const ordinaryUser = {
  id: "ordinary-user",
  email: "ordinary@example.test",
  firstName: "Ordinary",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
  isBanned: false,
  emailVerifiedAt: null,
  phoneVerifiedAt: null,
};
const managedUser = {
  ...ordinaryUser,
  email: "admin@primary-staging.example.invalid",
  phone: "+15550001002",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
};

function request(path: string) {
  return new Request(`https://preview.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

describe("verification staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VERIFICATION_SECRET = secret;
    mockedRequireUser.mockResolvedValue({
      ok: true,
      user: ordinaryUser,
    } as never);
    mockedValidateRequest.mockReturnValue(
      jest.fn().mockResolvedValue({
        success: true,
        data: { code },
      }),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.user.update.mockResolvedValue(ordinaryUser);
    mockedPrisma.verificationCode.count.mockResolvedValue(0);
    mockedPrisma.verificationCode.findFirst.mockResolvedValue(null);
    mockedPrisma.verificationCode.create.mockResolvedValue({ id: "code-1" });
    mockedPrisma.verificationCode.update.mockResolvedValue({ id: "code-1" });
    mockedPrisma.$queryRaw.mockResolvedValue([{ id: ordinaryUser.id }]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedSendEmail.mockResolvedValue({ ok: true });
    mockedSendSms.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    delete process.env.VERIFICATION_SECRET;
  });

  it.each([
    ["email send", sendEmailCode, "/api/verify/email/send", "EMAIL"],
    ["phone send", sendPhoneCode, "/api/verify/phone/send", "PHONE"],
  ] as const)(
    "locks and rechecks the user for %s",
    async (_label, handler, path, kind) => {
      const response = await handler(request(path));

      expect(response.status).toBe(200);
      expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.verificationCode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: ordinaryUser.id, kind }),
      });
      expect(mockedPrisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: "Serializable", timeout: 120_000 },
      );
    },
  );

  it.each([
    [
      "email confirmation",
      confirmEmailCode,
      "/api/verify/email/confirm",
      "emailVerifiedAt",
    ],
    [
      "phone confirmation",
      confirmPhoneCode,
      "/api/verify/phone/confirm",
      "phoneVerifiedAt",
    ],
  ] as const)(
    "locks and atomically applies %s",
    async (_label, handler, path, verifiedField) => {
      mockedPrisma.verificationCode.findFirst.mockResolvedValue({
        id: "code-1",
        codeHash: crypto
          .createHash("sha256")
          .update(secret + code)
          .digest("hex"),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const response = await handler(request(path));

      expect(response.status).toBe(200);
      expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(mockedPrisma.verificationCode.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "code-1" },
          data: expect.objectContaining({
            usedAt: expect.any(Date),
            attemptCount: 1,
          }),
        }),
      );
      expect(mockedPrisma.user.update).toHaveBeenCalledWith({
        where: { id: ordinaryUser.id },
        data: { [verifiedField]: expect.any(Date) },
      });
    },
  );

  it.each([
    ["email send", sendEmailCode, "/api/verify/email/send"],
    ["phone send", sendPhoneCode, "/api/verify/phone/send"],
    ["email confirmation", confirmEmailCode, "/api/verify/email/confirm"],
    ["phone confirmation", confirmPhoneCode, "/api/verify/phone/confirm"],
  ] as const)(
    "refuses a restored managed user before %s residue or delivery",
    async (_label, handler, path) => {
      mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

      const response = await handler(request(path));

      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toContain("private");
      expect(response.headers.get("cache-control")).toContain("no-store");
      await expect(response.json()).resolves.toMatchObject({
        error: "STAGING_CONSOLE_ONLY",
      });
      expect(mockedPrisma.verificationCode.create).not.toHaveBeenCalled();
      expect(mockedPrisma.verificationCode.update).not.toHaveBeenCalled();
      expect(mockedPrisma.user.update).not.toHaveBeenCalled();
      expect(mockedSendEmail).not.toHaveBeenCalled();
      expect(mockedSendSms).not.toHaveBeenCalled();
    },
  );

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" }),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await sendEmailCode(request("/api/verify/email/send"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "STAGING_CONSOLE_ONLY",
    });
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("reports the successful delivery path instead of re-reading changed provider configuration", async () => {
    const originalResend = process.env.RESEND_API_KEY;
    const originalSendGrid = process.env.SENDGRID_API_KEY;
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    delete process.env.SENDGRID_API_KEY;
    mockedSendEmail.mockImplementation(async () => {
      delete process.env.RESEND_API_KEY;
      return { ok: true, provider: "SENDGRID" };
    });

    try {
      const response = await sendEmailCode(request("/api/verify/email/send"));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        delivered: true,
        dev: false,
      });
    } finally {
      if (originalResend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalResend;
      if (originalSendGrid === undefined) delete process.env.SENDGRID_API_KEY;
      else process.env.SENDGRID_API_KEY = originalSendGrid;
    }
  });
});
