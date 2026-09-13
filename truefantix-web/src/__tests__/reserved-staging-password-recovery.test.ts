/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { validateRequest } from "@/lib/validation";
import {
  GET as validateResetLink,
  PATCH as completePasswordReset,
  POST as requestPasswordReset,
} from "@/app/api/auth/forgot-password/route";
import { POST as completeLegacyPasswordReset } from "@/app/api/auth/reset-password/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    passwordResetToken: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    verificationCode: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    session: { deleteMany: jest.fn() },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/email", () => ({
  sendEmail: jest.fn(),
}));

jest.mock("@/lib/validation", () => ({
  schemas: {
    authResetPassword: {},
    forgotPasswordRequest: {},
    forgotPasswordReset: {},
  },
  validateRequest: jest.fn(),
}));

jest.mock("@/lib/rate-limit", () => ({
  applyRateLimit: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock("@/lib/audit", () => ({
  auditLog: jest.fn(),
  createAuditContext: jest.fn(() => ({})),
}));

const mockedPrisma = prisma as unknown as {
  passwordResetToken: {
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  verificationCode: {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  session: { deleteMany: jest.Mock };
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
};
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;
const mockedValidateRequest = validateRequest as jest.MockedFunction<typeof validateRequest>;
const originalEnv = process.env;

const managedUser = {
  id: "staging-admin",
  email: "admin@primary-staging.example.invalid",
  phone: "+15550001002",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
  firstName: "Staging",
};

function mockValidation(data: Record<string, unknown>) {
  mockedValidateRequest.mockReturnValue(jest.fn().mockResolvedValue({
    success: true,
    data,
  }) as never);
}

async function expectPrivateInvalidToken(response: Response) {
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  await expect(response.json()).resolves.toMatchObject({ ok: false, error: "INVALID_TOKEN" });
}

describe("reserved staging personas cannot use password recovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      PASSWORD_RESET_SECRET: "password-reset-secret-at-least-32-characters",
      VERIFICATION_SECRET: "legacy-reset-secret-at-least-32-characters",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("conceals a managed identity without creating or delivering a reset token", async () => {
    mockValidation({ email: managedUser.email });
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await requestPasswordReset(new Request(
      "https://preview.example/api/auth/forgot-password",
      { method: "POST" },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mockedPrisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("rejects a matching managed reset link as private non-cacheable data", async () => {
    mockedPrisma.passwordResetToken.findFirst.mockResolvedValue({ user: managedUser });

    const response = await validateResetLink(new Request(
      `https://preview.example/api/auth/forgot-password?token=${"a".repeat(64)}&userId=${managedUser.id}`,
    ));

    await expectPrivateInvalidToken(response);
  });

  it("rejects a managed reset-token completion before account mutation", async () => {
    mockValidation({ token: "a".repeat(64), userId: managedUser.id, newPassword: "NewPassword123!" });
    mockedPrisma.passwordResetToken.findFirst.mockResolvedValue({ id: "reset-token-1" });
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await completePasswordReset(new Request(
      "https://preview.example/api/auth/forgot-password",
      { method: "PATCH" },
    ));

    await expectPrivateInvalidToken(response);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    expect(mockedPrisma.passwordResetToken.update).not.toHaveBeenCalled();
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a managed legacy reset code before incrementing its attempt counter", async () => {
    mockValidation({ token: "123456", email: managedUser.email, password: "NewPassword123!" });
    mockedPrisma.verificationCode.findFirst.mockResolvedValue({
      id: "legacy-reset-code-1",
      userId: managedUser.id,
      attemptCount: 0,
    });
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await completeLegacyPasswordReset(new Request(
      "https://preview.example/api/auth/reset-password",
      { method: "POST" },
    ));

    await expectPrivateInvalidToken(response);
    expect(mockedPrisma.verificationCode.update).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });
});
