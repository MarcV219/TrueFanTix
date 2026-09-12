/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { validateRequest } from "@/lib/validation";
import { GET, POST } from "@/app/api/auth/verify-email/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: jest.fn(), update: jest.fn() },
  },
}));

jest.mock("@/lib/email", () => ({
  sendEmail: jest.fn(),
}));

jest.mock("@/lib/validation", () => ({
  schemas: {
    authVerifyEmailSend: {},
    authVerifyEmailConfirm: { safeParse: jest.fn() },
  },
  validateRequest: jest.fn(),
}));

jest.mock("@/lib/rate-limit", () => ({
  applyRateLimit: jest.fn().mockResolvedValue({ ok: true }),
}));

const mockedPrisma = prisma as unknown as {
  user: { findFirst: jest.Mock; update: jest.Mock };
};
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;
const mockedValidateRequest = validateRequest as jest.MockedFunction<typeof validateRequest>;
const mockedSafeParse = jest.requireMock("@/lib/validation").schemas.authVerifyEmailConfirm.safeParse as jest.Mock;
const originalEnv = process.env;

async function expectPrivateError(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
  await expect(response.json()).resolves.toMatchObject({ ok: false, error });
}

describe("reserved staging personas cannot use legacy email verification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      VERIFICATION_SECRET: "legacy-verification-secret-at-least-32-characters",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("conceals a reserved identity and does not issue or deliver a token", async () => {
    mockedValidateRequest.mockReturnValue(jest.fn().mockResolvedValue({
      success: true,
      data: { email: "admin@primary-staging.example.invalid" },
    }) as never);
    mockedPrisma.user.findFirst.mockResolvedValue({
      id: "staging-admin",
      email: "admin@primary-staging.example.invalid",
      firstName: "Staging",
      emailVerifiedAt: null,
      emailVerificationToken: null,
    });

    const response = await POST(new Request("https://preview.example/api/auth/verify-email", {
      method: "POST",
    }));

    await expectPrivateError(response, 404, "USER_NOT_FOUND");
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("rejects a matching legacy token before changing a reserved identity", async () => {
    mockedSafeParse.mockReturnValue({
      success: true,
      data: { token: "a".repeat(64), userId: "staging-organizer" },
    });
    mockedPrisma.user.findFirst.mockResolvedValue({
      id: "staging-organizer",
      email: "organizer@primary-staging.example.invalid",
      emailVerifiedAt: null,
    });

    const response = await GET(new Request(
      `https://preview.example/api/auth/verify-email?token=${"a".repeat(64)}&userId=staging-organizer`,
    ));

    await expectPrivateError(response, 400, "INVALID_TOKEN");
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });
});
