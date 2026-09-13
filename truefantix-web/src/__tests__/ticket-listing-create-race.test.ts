/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireSellerApproved } from "@/lib/auth/guards";
import { applyRateLimit } from "@/lib/rate-limit";
import { validateRequest } from "@/lib/validation";
import { POST } from "@/app/api/tickets/route";
import { verifyWithProvider } from "@/lib/tickets/provider";
import { fetchOfficialSnapshot } from "@/lib/officialPricing";
import { getTicketImage } from "@/lib/imageSearch";
import { analyzeReceiptProof } from "@/lib/tickets/receiptOcr";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({ requireSellerApproved: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({ applyRateLimit: jest.fn() }));
jest.mock("@/lib/validation", () => ({
  schemas: { ticketCreateApi: {} },
  validateRequest: jest.fn(),
}));
jest.mock("@/lib/tickets/provider", () => ({ verifyWithProvider: jest.fn() }));
jest.mock("@/lib/officialPricing", () => ({ fetchOfficialSnapshot: jest.fn() }));
jest.mock("@/lib/imageSearch", () => ({ getTicketImage: jest.fn() }));
jest.mock("@/lib/tickets/receiptOcr", () => ({ analyzeReceiptProof: jest.fn() }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }));
jest.mock("@/lib/adminActivityEmail", () => ({ sendAdminActivityEmail: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireSellerApproved = requireSellerApproved as jest.MockedFunction<
  typeof requireSellerApproved
>;
const mockedApplyRateLimit = applyRateLimit as jest.MockedFunction<typeof applyRateLimit>;
const mockedValidateRequest = validateRequest as jest.MockedFunction<typeof validateRequest>;
const mockedProvider = verifyWithProvider as jest.MockedFunction<typeof verifyWithProvider>;
const mockedOfficialSnapshot = fetchOfficialSnapshot as jest.MockedFunction<
  typeof fetchOfficialSnapshot
>;
const mockedTicketImage = getTicketImage as jest.MockedFunction<typeof getTicketImage>;
const mockedReceiptProof = analyzeReceiptProof as jest.MockedFunction<typeof analyzeReceiptProof>;

const ordinaryUser = {
  id: "user-1",
  email: "ordinary@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
  isBanned: false,
  canSell: true,
  seller: { id: "current-seller", status: "APPROVED" },
};

const managedUser = {
  ...ordinaryUser,
  email: "admin@primary-staging.example.invalid",
  phone: "+15550001002",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
  canSell: false,
  seller: null,
};

function request() {
  return new Request("http://localhost/api/tickets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

describe("ticket listing creation staging-persona boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApplyRateLimit.mockResolvedValue({ ok: true } as never);
    mockedRequireSellerApproved.mockResolvedValue({
      ok: true,
      user: { id: ordinaryUser.id, sellerId: "stale-seller" },
    } as never);
    mockedValidateRequest.mockReturnValue((async () => ({
      success: true,
      data: {
        title: "Synthetic Concert",
        venue: "Synthetic Arena",
        date: "2099-09-13T20:00:00.000Z",
        section: "General Admission",
        priceCents: 5000,
        faceValueCents: 5000,
        eventTypeOverride: "concert",
      },
    })) as never);
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedProvider.mockRejectedValue(new Error("provider must not be called"));
    mockedOfficialSnapshot.mockRejectedValue(new Error("official lookup must not be called"));
    mockedTicketImage.mockRejectedValue(new Error("image lookup must not be called"));
    mockedReceiptProof.mockRejectedValue(new Error("receipt OCR must not be called"));
  });

  it("refuses a restored managed user before listing or provider work", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("private");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedProvider).not.toHaveBeenCalled();
    expect(mockedOfficialSnapshot).not.toHaveBeenCalled();
    expect(mockedTicketImage).not.toHaveBeenCalled();
    expect(mockedReceiptProof).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);
    mockedPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" }),
    );

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedProvider).not.toHaveBeenCalled();
  });

  it("preserves an ordinary seller-status downgrade refusal", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ ...ordinaryUser, canSell: false });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "SELLER_NOT_APPROVED" });
    expect(mockedProvider).not.toHaveBeenCalled();
  });
});
