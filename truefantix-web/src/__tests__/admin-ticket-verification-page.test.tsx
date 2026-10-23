import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TicketVerificationAdminPage from "@/app/admin/tickets/verification/page";
import { apiFetch } from "@/lib/api-fetch";

jest.mock("@/lib/api-fetch", () => ({ apiFetch: jest.fn() }));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as Response;
}

describe("admin ticket verification queue", () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/me") {
        return jsonResponse({ user: { flags: { isAdmin: true } } });
      }
      if (url.startsWith("/api/admin/tickets/verification-queue")) {
        return jsonResponse({
          ok: true,
          tickets: [{
            id: "ticket-1",
            title: "Wrapped in Wonder",
            image: "/ticket.jpg",
            venue: "Collier Street United Church",
            date: "2026-11-27T19:30:00.000Z",
            priceCents: 3328,
            faceValueCents: 3000,
            status: "AVAILABLE",
            verificationStatus: "PENDING",
            verificationScore: 0,
            verificationReason: "Manual review required.",
            verificationProvider: "seller-support-request",
            verificationEvidence: null,
            verifiedAt: null,
            barcodeType: null,
            barcodeLast4: null,
            createdAt: "2026-10-23T12:00:00.000Z",
            seller: { id: "seller-1", name: "Pam Villeneuve", rating: 0, reviews: 0 },
          }],
        });
      }
      if (url === "/api/admin/tickets/verification-count") {
        return jsonResponse({
          ok: true,
          counts: {
            pending: 1,
            needsReview: 0,
            rejected: 0,
            catalogRequests: 0,
            sellerStripe: 0,
            suspendedSellers: 0,
            expiredReservations: 0,
            openEscrows: 0,
            disputes: 0,
            transferProofReviews: 0,
            failedPayments: 0,
            pendingPayouts: 0,
            failedEmails: 0,
            moderatedForumItems: 0,
            actionable: 1,
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as jest.Mock;
  });

  it("uses the CSRF-aware request helper when approving a ticket", async () => {
    mockedApiFetch.mockResolvedValue(jsonResponse({ ok: true }));
    const user = userEvent.setup();

    render(<TicketVerificationAdminPage />);
    await user.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(1));
    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/api/tickets/ticket-1/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ status: "VERIFIED", provider: "admin-queue" }),
      }),
    );
  });
});
