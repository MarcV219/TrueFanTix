/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendDisputeEmails } from "@/lib/disputes";

jest.mock("@/lib/prisma", () => ({
  prisma: { emailDelivery: { upsert: jest.fn() } },
}));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  emailDelivery: { upsert: jest.Mock };
};
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;

describe("dispute email transaction client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendEmail.mockResolvedValue({ ok: true, provider: "SENDGRID" });
  });

  it("records delivery through the supplied transaction client", async () => {
    const transaction = { emailDelivery: { upsert: jest.fn().mockResolvedValue({ id: "delivery-1" }) } };

    await sendDisputeEmails({
      orderId: "order-synthetic",
      kind: "RESOLVED",
      parties: [{ email: "buyer@example.test", role: "Buyer" }],
      submittedBy: "Synthetic Support",
      comments: "Synthetic resolution.",
      ticketCount: 1,
      fileNames: [],
    }, transaction as never);

    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(transaction.emailDelivery.upsert).toHaveBeenCalledTimes(1);
    expect(transaction.emailDelivery.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ provider: "SENDGRID" }),
      update: expect.objectContaining({ provider: "SENDGRID" }),
    }));
    expect(mockedPrisma.emailDelivery.upsert).not.toHaveBeenCalled();
  });

  it("records neutral evidence when the sender rejects without provider identity", async () => {
    const previousResendApiKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "synthetic-configured-but-unattributed-key";
    mockedSendEmail.mockRejectedValueOnce(new Error("synthetic providerless failure"));
    const transaction = { emailDelivery: { upsert: jest.fn().mockResolvedValue({ id: "delivery-2" }) } };

    try {
      await sendDisputeEmails({
        orderId: "order-providerless",
        kind: "OPENED",
        parties: [{ email: "buyer@example.test", role: "Buyer" }],
        submittedBy: "Synthetic Buyer",
        comments: "Synthetic dispute.",
        ticketCount: 1,
        fileNames: [],
      }, transaction as never);

      expect(transaction.emailDelivery.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({
          provider: "CONSOLE",
          status: "FAILED",
          error: "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: synthetic providerless failure",
        }),
        update: expect.objectContaining({
          provider: "CONSOLE",
          status: "FAILED",
          error: "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: synthetic providerless failure",
        }),
      }));
    } finally {
      if (previousResendApiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResendApiKey;
    }
  });
});
