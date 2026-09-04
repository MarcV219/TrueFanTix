/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({ prisma: {
  outreachSuppression: { findUnique: jest.fn(), deleteMany: jest.fn() },
  outreachResubscribeRequest: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  outreachContact: { updateMany: jest.fn() },
  $transaction: jest.fn(),
} }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }));
jest.mock("@/lib/rate-limit", () => ({
  applyRateLimit: jest.fn(async () => ({ ok: true })),
  getClientIp: jest.fn(() => "127.0.0.1"),
}));

import { GET, POST } from "@/app/resubscribe/outreach/route";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

const prismaMock = prisma as any;
const sendEmailMock = sendEmail as jest.Mock;

describe("outreach double opt-in re-subscribe flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.APP_ORIGIN = "https://truefantix.ca";
    sendEmailMock.mockResolvedValue({ ok: true, provider: "RESEND" });
  });

  it("shows the public request form", async () => {
    const response = await GET(new Request("https://truefantix.ca/resubscribe/outreach"));
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("Send confirmation email");
  });

  it("keeps the address suppressed and emails a one-time confirmation link", async () => {
    prismaMock.outreachSuppression.findUnique.mockResolvedValue({ id: "suppression_1" });
    prismaMock.outreachResubscribeRequest.create.mockResolvedValue({ id: "request_1" });
    const response = await POST(new Request("https://truefantix.ca/resubscribe/outreach", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "Person@Example.com" }),
    }));
    expect(response.status).toBe(200);
    expect(prismaMock.outreachResubscribeRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ normalizedEmail: "person@example.com" }) }));
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: "person@example.com", subject: expect.stringContaining("Confirm") }));
    expect(prismaMock.outreachSuppression.deleteMany).not.toHaveBeenCalled();
  });

  it("records express consent only after the confirmation form is submitted", async () => {
    prismaMock.outreachResubscribeRequest.findUnique.mockResolvedValue({ id: "request_1", email: "person@example.com", normalizedEmail: "person@example.com", confirmedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    prismaMock.outreachResubscribeRequest.update.mockReturnValue({ operation: "confirm" });
    prismaMock.outreachSuppression.deleteMany.mockReturnValue({ operation: "unsuppress" });
    prismaMock.outreachContact.updateMany.mockReturnValue({ operation: "consent" });
    prismaMock.$transaction.mockResolvedValue([]);
    const response = await POST(new Request("https://truefantix.ca/resubscribe/outreach", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: "valid-one-time-token" }),
    }));
    expect(response.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.outreachSuppression.deleteMany).toHaveBeenCalledWith({ where: { normalizedEmail: "person@example.com" } });
    expect(prismaMock.outreachContact.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ consentBasis: "EXPRESS_CONSENT", unsubscribedAt: null }) }));
  });
});
