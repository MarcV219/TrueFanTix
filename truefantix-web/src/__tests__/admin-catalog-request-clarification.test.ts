/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/guards";
import { sendEmail } from "@/lib/email";
import { validateRequest } from "@/lib/validation";
import { PATCH } from "@/app/api/admin/catalog-requests/[id]/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    catalogRequest: { findUnique: jest.fn(), update: jest.fn() },
    catalogEntity: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth/guards", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }));
jest.mock("@/lib/validation", () => ({
  schemas: { catalogRequestReviewApi: { kind: "catalog-request-review" } },
  validateRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  catalogRequest: { findUnique: jest.Mock; update: jest.Mock };
  catalogEntity: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};
const mockedRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;
const mockedValidateRequest = validateRequest as jest.Mock;

const requestId = "request-clarification-1";
const question = "Which Toronto venue did you mean?";
const pendingRequest = {
  id: requestId,
  userId: "user-1",
  requestedType: "VENUE",
  requestedValue: "The Arena",
  user: { email: "buyer@example.test", firstName: "Buyer" },
};

function request() {
  return new Request(`https://preview.example/api/admin/catalog-requests/${requestId}`, {
    method: "PATCH",
  });
}

describe("admin catalog-request clarification email evidence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRequireAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1" } } as never);
    mockedValidateRequest.mockReturnValue(async () => ({
      success: true,
      data: { status: "NEEDS_CLARIFICATION", adminNotes: question },
    }));
    mockedPrisma.catalogRequest.findUnique.mockResolvedValue(pendingRequest);
    mockedPrisma.catalogRequest.update.mockImplementation(async ({ data }) => ({
      ...pendingRequest,
      ...data,
    }));
    mockedSendEmail.mockResolvedValue({ ok: true, provider: "CONSOLE", providerResult: "LOGGED" });
  });

  afterEach(() => jest.restoreAllMocks());

  it("durably records a neutral failure when the sender rejects without provider identity", async () => {
    const previousResendApiKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "configured-but-not-provider-evidence";
    mockedSendEmail.mockRejectedValueOnce(new Error("synthetic providerless failure"));

    try {
      const response = await PATCH(request());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        request: {
          id: requestId,
          status: "NEEDS_CLARIFICATION",
          adminNotes: question,
          reviewedAt: expect.any(String),
          emailError: "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: synthetic providerless failure",
        },
        emailSent: false,
        emailError: "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: synthetic providerless failure",
      });
      expect(mockedPrisma.catalogRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: {
          status: "NEEDS_CLARIFICATION",
          adminNotes: question,
          reviewedAt: expect.any(Date),
          resolvedCatalogEntityId: null,
          fulfilledPreferenceId: null,
          emailError: "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: synthetic providerless failure",
        },
      });
    } finally {
      if (previousResendApiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResendApiKey;
    }
  });

  it("still returns 500 when durable request-state persistence rejects", async () => {
    mockedPrisma.catalogRequest.update.mockRejectedValueOnce(
      new Error("synthetic persistence failure"),
    );

    const response = await PATCH(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "SERVER_ERROR",
    });
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
  });
});
