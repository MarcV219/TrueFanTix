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
});
