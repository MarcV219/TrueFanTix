/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireSellerApproved } from "@/lib/auth/guards";
import { applyRateLimit } from "@/lib/rate-limit";
import { validateRequest } from "@/lib/validation";
import { sendEmail } from "@/lib/email";
import { sendAdminActivityEmail } from "@/lib/adminActivityEmail";
import { POST } from "@/app/api/tickets/route";
import { verifyWithProvider } from "@/lib/tickets/provider";
import { fetchOfficialSnapshot } from "@/lib/officialPricing";
import { validateListingPriceAgainstOfficial } from "@/lib/tickets/listingValidation";
import { getTicketImage } from "@/lib/imageSearch";
import { analyzeReceiptProof } from "@/lib/tickets/receiptOcr";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    ticket: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    event: { findFirst: jest.fn() },
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
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }));
jest.mock("@/lib/adminActivityEmail", () => ({
  sendAdminActivityEmail: jest.fn(),
}));
jest.mock("@/lib/tickets/provider", () => ({ verifyWithProvider: jest.fn() }));
jest.mock("@/lib/officialPricing", () => ({ fetchOfficialSnapshot: jest.fn() }));
jest.mock("@/lib/tickets/listingValidation", () => ({
  validateListingPriceAgainstOfficial: jest.fn(),
}));
jest.mock("@/lib/imageSearch", () => ({ getTicketImage: jest.fn() }));
jest.mock("@/lib/tickets/receiptOcr", () => ({ analyzeReceiptProof: jest.fn() }));
jest.mock("@/lib/tickets/verification", () => ({ autoVerifyTicketById: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  ticket: {
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
  };
  event: { findFirst: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireSellerApproved = requireSellerApproved as jest.MockedFunction<
  typeof requireSellerApproved
>;
const mockedApplyRateLimit = applyRateLimit as jest.MockedFunction<typeof applyRateLimit>;
const mockedValidateRequest = validateRequest as jest.MockedFunction<typeof validateRequest>;
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;
const mockedSendAdminActivityEmail = sendAdminActivityEmail as jest.MockedFunction<
  typeof sendAdminActivityEmail
>;
const mockedProvider = verifyWithProvider as jest.MockedFunction<typeof verifyWithProvider>;
const mockedOfficialSnapshot = fetchOfficialSnapshot as jest.MockedFunction<
  typeof fetchOfficialSnapshot
>;
const mockedListingValidation = validateListingPriceAgainstOfficial as jest.MockedFunction<
  typeof validateListingPriceAgainstOfficial
>;
const mockedTicketImage = getTicketImage as jest.MockedFunction<typeof getTicketImage>;
const mockedReceiptProof = analyzeReceiptProof as jest.MockedFunction<typeof analyzeReceiptProof>;

const user = {
  id: "user-1",
  email: "ordinary@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
  isBanned: false,
  canSell: true,
  seller: { id: "seller-1", status: "APPROVED" },
};

const ticket = {
  id: "ticket-1",
  title: "Synthetic Concert",
  venue: "Synthetic Arena",
  date: "2099-09-13T20:00:00.000Z",
  section: "General Admission",
  row: null,
  seat: null,
  priceCents: 5000,
  faceValueCents: 5000,
  adminFeePaidCents: 0,
  currency: "CAD",
  image: "/default.jpg",
  status: "AVAILABLE",
  verificationStatus: "NEEDS_REVIEW",
  verificationEvidence: null,
  sellerId: "seller-1",
  eventId: null,
  event: null,
  seller: { name: "Ordinary Seller", badges: [] },
  createdAt: new Date("2099-01-01T00:00:00.000Z"),
};

function request() {
  return new Request("http://localhost/api/tickets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

describe("ticket listing email commit boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedApplyRateLimit.mockResolvedValue({ ok: true } as never);
    mockedRequireSellerApproved.mockResolvedValue({
      ok: true,
      user: { id: user.id, email: user.email, sellerId: "stale-seller" },
    } as never);
    mockedValidateRequest.mockReturnValue((async () => ({
      success: true,
      data: {
        title: ticket.title,
        venue: ticket.venue,
        date: ticket.date,
        section: ticket.section,
        priceCents: ticket.priceCents,
        faceValueCents: ticket.faceValueCents,
        eventTypeOverride: "concert",
        requestManualReview: true,
        supportReviewNote: "Synthetic review request",
      },
    })) as never);
    mockedPrisma.user.findUnique.mockResolvedValue(user);
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedPrisma.ticket.findMany.mockResolvedValue([]);
    mockedPrisma.ticket.create.mockResolvedValue(ticket);
    mockedPrisma.ticket.update.mockResolvedValue(ticket);
    mockedPrisma.ticket.findUnique.mockResolvedValue(ticket);
    mockedPrisma.event.findFirst.mockResolvedValue(null);
    mockedProvider.mockResolvedValue({
      provider: "NONE",
      confirmed: false,
      reason: "Synthetic provider result",
    } as never);
    mockedOfficialSnapshot.mockResolvedValue({
      vendor: "NONE",
      sourceUrl: null,
      found: false,
      officialVenueName: null,
      officialPriceRangeMinCents: null,
      officialPriceRangeMaxCents: null,
      officialFaceValueCents: null,
      officialServiceFeesCents: null,
      officialServiceFeeSource: null,
      officialStatusCode: null,
      soldOut: null,
      soldOutSource: null,
      reason: "Synthetic official result",
    } as never);
    mockedListingValidation.mockReturnValue({
      ok: false,
      error: "OFFICIAL_PRICE_UNAVAILABLE",
      message: "Synthetic review required",
      details: { maxListPriceCents: 5000 },
    } as never);
    mockedTicketImage.mockResolvedValue("/default.jpg");
    mockedReceiptProof.mockResolvedValue(null as never);
    mockedSendEmail.mockResolvedValue({
      ok: true,
      provider: "CONSOLE",
      providerResult: "LOGGED",
    });
    mockedSendAdminActivityEmail.mockResolvedValue({
      ok: true,
      provider: "CONSOLE",
      providerResult: "LOGGED",
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it("attempts listing notifications only after the transaction commits", async () => {
    const sequence: string[] = [];
    mockedPrisma.$transaction.mockImplementationOnce(
      async (work: (tx: typeof mockedPrisma) => unknown) => {
        sequence.push("transaction-start");
        const result = await work(mockedPrisma);
        expect(mockedSendEmail).not.toHaveBeenCalled();
        expect(mockedSendAdminActivityEmail).not.toHaveBeenCalled();
        sequence.push("transaction-committed");
        return result;
      },
    );
    mockedPrisma.ticket.create.mockImplementationOnce(async () => {
      sequence.push("local-write");
      return ticket;
    });
    mockedSendEmail.mockImplementationOnce(async () => {
      sequence.push("review-email-attempted");
      return { ok: true, provider: "CONSOLE", providerResult: "LOGGED" };
    });
    mockedSendAdminActivityEmail.mockImplementationOnce(async () => {
      sequence.push("activity-email-attempted");
      return { ok: true, provider: "CONSOLE", providerResult: "LOGGED" };
    });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(sequence).toEqual([
      "transaction-start",
      "local-write",
      "transaction-committed",
      "review-email-attempted",
      "activity-email-attempted",
    ]);
    expect(mockedSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "ticket-listing-review:ticket-1",
    }));
    expect(mockedSendAdminActivityEmail).toHaveBeenCalledWith(expect.objectContaining({
      activity: "TICKETS_LISTED",
      idempotencyKey: "ticket-listing-activity:ticket-1",
    }));
  });

  it("does not notify when the transaction aborts after preparing the response", async () => {
    mockedPrisma.$transaction.mockImplementationOnce(
      async (work: (tx: typeof mockedPrisma) => unknown) => {
        await work(mockedPrisma);
        throw Object.assign(new Error("synthetic commit failure"), { code: "P2034" });
      },
    );

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mockedPrisma.ticket.create).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdminActivityEmail).not.toHaveBeenCalled();
  });

  it("contains a providerless review-email rejection after commit", async () => {
    const previousResendApiKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "configured-but-not-evidence";
    mockedSendEmail.mockRejectedValueOnce(new Error("synthetic providerless failure"));

    try {
      const response = await POST(request());

      expect(response.status).toBe(201);
      expect(mockedSendAdminActivityEmail).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledWith(
        "[EMAIL] Seller listing review notification failed:",
        "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: synthetic providerless failure",
      );
    } finally {
      if (previousResendApiKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = previousResendApiKey;
      }
    }
  });

  it("contains an unexpected activity-email rejection after commit", async () => {
    mockedSendAdminActivityEmail.mockRejectedValueOnce(
      new Error("synthetic activity providerless failure"),
    );

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "[EMAIL] Ticket listing activity notification failed:",
      "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: synthetic activity providerless failure",
    );
  });

  it("preserves the committed response when the activity helper reports failure", async () => {
    mockedSendAdminActivityEmail.mockResolvedValueOnce({
      ok: false,
      error: "synthetic contained provider failure",
      provider: "CONSOLE",
      providerResult: "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE",
    });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendAdminActivityEmail).toHaveBeenCalledTimes(1);
  });
});
