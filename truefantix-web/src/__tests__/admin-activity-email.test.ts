const sendEmail = jest.fn();

jest.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

import { ADMIN_ACTIVITY_EMAIL, sendAdminActivityEmail } from "@/lib/adminActivityEmail";

describe("admin activity email", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendEmail.mockResolvedValue({ ok: true, provider: "CONSOLE", providerResult: "LOGGED" });
  });

  it("sends activity details to the fixed admin inbox and escapes HTML", async () => {
    await sendAdminActivityEmail({
      activity: "TICKETS_LISTED",
      summary: "Tickets listed — Show <One>",
      details: { "Listing ID": "ticket-1", Seller: "seller@example.com", Empty: null },
    });

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: ADMIN_ACTIVITY_EMAIL,
      subject: "[TrueFanTix] Tickets listed — Show <One>",
      text: expect.stringContaining("Listing ID: ticket-1"),
      html: expect.stringContaining("Show &lt;One&gt;"),
    }));
    expect(sendEmail.mock.calls[0][0].text).not.toContain("Empty:");
  });

  it("returns explicit no-provider evidence when the sender rejects unexpectedly", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    sendEmail.mockRejectedValueOnce(new Error("synthetic providerless failure"));

    try {
      await expect(sendAdminActivityEmail({
        activity: "TICKETS_PURCHASED",
        summary: "Synthetic purchase",
        details: { "Order ID": "order-1" },
      })).resolves.toEqual({
        ok: false,
        error: "synthetic providerless failure",
        provider: "CONSOLE",
        providerResult: "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE",
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
