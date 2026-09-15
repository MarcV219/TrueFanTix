/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendDisputeEmails } from "@/lib/disputes";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    emailDelivery: {
      create: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  emailDelivery: {
    create: jest.Mock;
    updateMany: jest.Mock;
    upsert: jest.Mock;
  };
};
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;

describe("dispute email transaction client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendEmail.mockResolvedValue({ ok: true, provider: "SENDGRID" });
    mockedPrisma.emailDelivery.create.mockResolvedValue({ id: "reserved-delivery" });
    mockedPrisma.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
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

  it("reserves stable buyer, seller, and support identities before sending", async () => {
    await sendDisputeEmails({
      orderId: "order-stable-open",
      kind: "OPENED",
      parties: [
        { email: "buyer@example.test", role: "Buyer" },
        { email: "seller@example.test", role: "Seller" },
        { email: "support@example.test", role: "TrueFanTix Support" },
      ],
      submittedBy: "Synthetic Buyer",
      comments: "Synthetic dispute.",
      ticketCount: 1,
      fileNames: [],
      idempotencyKeyPrefix: "dispute-opened:order-stable-open",
    });

    expect(mockedPrisma.emailDelivery.create).toHaveBeenCalledTimes(3);
    expect(mockedSendEmail).toHaveBeenCalledTimes(3);
    expect(mockedSendEmail).toHaveBeenNthCalledWith(1, expect.objectContaining({
      idempotencyKey: "dispute-opened:order-stable-open:BUYER",
    }));
    expect(mockedSendEmail).toHaveBeenNthCalledWith(2, expect.objectContaining({
      idempotencyKey: "dispute-opened:order-stable-open:SELLER",
    }));
    expect(mockedSendEmail).toHaveBeenNthCalledWith(3, expect.objectContaining({
      idempotencyKey: "dispute-opened:order-stable-open:TRUEFANTIX_SUPPORT",
    }));
    expect(mockedPrisma.emailDelivery.updateMany).toHaveBeenCalledTimes(3);
    expect(mockedPrisma.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "ATTEMPTING" }),
      data: expect.objectContaining({ status: "SENT", provider: "SENDGRID" }),
    }));
    expect(mockedPrisma.emailDelivery.upsert).not.toHaveBeenCalled();
  });

  it("treats pre-existing terminal delivery evidence as no-send and no-overwrite", async () => {
    mockedPrisma.emailDelivery.create.mockRejectedValueOnce({ code: "P2002" });

    await sendDisputeEmails({
      orderId: "order-already-sent",
      kind: "OPENED",
      parties: [{ email: "buyer@example.test", role: "Buyer" }],
      submittedBy: "Synthetic Buyer",
      comments: "Synthetic dispute.",
      ticketCount: 1,
      fileNames: [],
      idempotencyKeyPrefix: "dispute-opened:order-already-sent",
    });

    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedPrisma.emailDelivery.updateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.emailDelivery.upsert).not.toHaveBeenCalled();
  });

  it("cannot downgrade delivery evidence changed after the owned reservation", async () => {
    mockedPrisma.emailDelivery.updateMany.mockResolvedValueOnce({ count: 0 });
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    await sendDisputeEmails({
      orderId: "order-concurrent-terminal",
      kind: "OPENED",
      parties: [{ email: "buyer@example.test", role: "Buyer" }],
      submittedBy: "Synthetic Buyer",
      comments: "Synthetic dispute.",
      ticketCount: 1,
      fileNames: [],
      idempotencyKeyPrefix: "dispute-opened:order-concurrent-terminal",
    });

    expect(mockedPrisma.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "ATTEMPTING" }),
    }));
    expect(mockedPrisma.emailDelivery.upsert).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "Could not finalize owned dispute email delivery for buyer@example.test: delivery evidence changed",
    );
  });
});
