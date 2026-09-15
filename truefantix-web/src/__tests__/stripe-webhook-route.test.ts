/**
 * @jest-environment node
 */

import { POST } from "@/app/api/webhooks/stripe/route";
import { prisma } from "@/lib/prisma";

const mockConstructEvent = jest.fn();
const mockSendEmail = jest.fn();
const mockNotifyTicketSold = jest.fn();
const mockNotifyPurchaseConfirmed = jest.fn();
const mockNotifySellerTransferRequired = jest.fn();

jest.mock("stripe", () => {
  return jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
  }));
});

jest.mock("@/lib/prisma", () => ({
  prisma: {
    eventDelivery: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
    emailDelivery: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  generatePurchaseConfirmationEmail: jest.fn(() => ({ subject: "Purchase", text: "ok", html: "<p>ok</p>" })),
  generateSaleNotificationEmail: jest.fn(() => ({ subject: "Sale", text: "ok", html: "<p>ok</p>" })),
}));

jest.mock("@/lib/notifications/service", () => ({
  notifyTicketSold: (...args: unknown[]) => mockNotifyTicketSold(...args),
  notifyPurchaseConfirmed: (...args: unknown[]) => mockNotifyPurchaseConfirmed(...args),
}));

jest.mock("@/lib/orders/transferWorkflow", () => ({
  notifySellerTransferRequired: (...args: unknown[]) => mockNotifySellerTransferRequired(...args),
  sellerTransferDeadline: jest.fn(() => new Date("2030-01-02T00:00:00.000Z")),
}));

const mockedPrisma = prisma as unknown as {
  eventDelivery: {
    create: jest.Mock;
    deleteMany: jest.Mock;
  };
  $transaction: jest.Mock;
  emailDelivery: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
};

function makeWebhookRequest(payload: string) {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "stripe-signature": "test-signature",
      "content-type": "application/json",
    },
    body: payload,
  });
}

describe("Stripe webhook route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendEmail.mockResolvedValue({ ok: true, provider: "CONSOLE", providerResult: "LOGGED" });
    process.env = {
      ...originalEnv,
      STRIPE_SECRET_KEY: "sk_test_webhook",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns 200 for duplicate Stripe event deliveries without processing twice", async () => {
    const event = {
      id: "evt_duplicate_payment",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_test",
          amount: 12500,
          currency: "cad",
          metadata: { orderId: "order_123" },
        },
      },
    };

    mockConstructEvent.mockReturnValue(event);
    mockedPrisma.eventDelivery.create
      .mockResolvedValueOnce({ id: "delivery_1" })
      .mockRejectedValueOnce({ code: "P2002" });

    const tx = {
      payment: { upsert: jest.fn().mockResolvedValue({}) },
      order: {
        update: jest.fn().mockResolvedValue({
          id: "order_123",
          amountCents: 10000,
          totalCents: 12500,
          items: [],
          buyerSeller: null,
          seller: null,
        }),
      },
    };
    mockedPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const first = await POST(makeWebhookRequest(JSON.stringify(event)));
    const second = await POST(makeWebhookRequest(JSON.stringify(event)));

    await expect(first.json()).resolves.toEqual({ ok: true });
    await expect(second.json()).resolves.toEqual({ ok: true, replay: true });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockedPrisma.eventDelivery.create).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.payment.upsert).toHaveBeenCalledTimes(1);
    expect(tx.order.update).toHaveBeenCalledTimes(1);
  });

  it("records each returned email provider instead of inferring it from configuration", async () => {
    const event = {
      id: "evt_provider_evidence",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_provider_evidence",
          amount: 12500,
          currency: "cad",
          metadata: { orderId: "order_provider_evidence" },
        },
      },
    };
    mockConstructEvent.mockReturnValue(event);
    mockedPrisma.eventDelivery.create.mockResolvedValue({ id: "delivery-provider-evidence" });
    mockedPrisma.emailDelivery.findUnique.mockResolvedValue(null);
    mockSendEmail
      .mockResolvedValueOnce({ ok: true, provider: "SENDGRID" })
      .mockResolvedValueOnce({ ok: true, provider: "RESEND" });

    const tx = {
      payment: { upsert: jest.fn().mockResolvedValue({}) },
      order: {
        update: jest.fn().mockResolvedValue({
          id: "order_provider_evidence",
          amountCents: 10000,
          totalCents: 12500,
          payment: { currency: "CAD" },
          items: [{ ticket: { title: "Synthetic Event", venue: "Synthetic Venue", date: "2030-01-01" } }],
          buyerSeller: { user: { id: "buyer-provider-evidence", email: "buyer@example.test", firstName: "Buyer" } },
          seller: null,
        }),
      },
    };
    mockedPrisma.$transaction.mockImplementation((callback) => callback(tx));

    const response = await POST(makeWebhookRequest(JSON.stringify(event)));

    expect(response.status).toBe(200);
    expect(mockedPrisma.emailDelivery.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ emailType: "PURCHASE_CONFIRMATION", provider: "SENDGRID" }),
    });
    expect(mockedPrisma.emailDelivery.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ emailType: "ADMIN_PURCHASE_COMPLETED", provider: "RESEND" }),
    });
  });

  it("does not infer external provider evidence after an unexpected providerless rejection", async () => {
    const event = {
      id: "evt_providerless_failure",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_providerless_failure",
          amount: 12500,
          currency: "cad",
          metadata: { orderId: "order_providerless_failure" },
        },
      },
    };
    process.env.RESEND_API_KEY = "synthetic-configured-but-unattempted-key";
    mockConstructEvent.mockReturnValue(event);
    mockedPrisma.eventDelivery.create.mockResolvedValue({ id: "delivery-providerless-failure" });
    mockedPrisma.emailDelivery.findUnique.mockResolvedValue(null);
    mockSendEmail
      .mockResolvedValueOnce({ ok: true, provider: "SENDGRID", providerResult: "accepted-buyer" })
      .mockRejectedValueOnce(new Error("synthetic providerless failure"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const tx = {
      payment: { upsert: jest.fn().mockResolvedValue({}) },
      order: {
        update: jest.fn().mockResolvedValue({
          id: "order_providerless_failure",
          amountCents: 10000,
          totalCents: 12500,
          payment: { currency: "CAD" },
          items: [{ ticket: { title: "Synthetic Event", venue: "Synthetic Venue", date: "2030-01-01" } }],
          buyerSeller: { user: { id: "buyer-providerless-failure", email: "buyer@example.test", firstName: "Buyer" } },
          seller: null,
        }),
      },
    };
    mockedPrisma.$transaction.mockImplementation((callback) => callback(tx));

    try {
      const response = await POST(makeWebhookRequest(JSON.stringify(event)));

      expect(response.status).toBe(200);
      expect(mockedPrisma.emailDelivery.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          emailType: "ADMIN_PURCHASE_COMPLETED",
          provider: "CONSOLE",
          status: "FAILED",
          error: "synthetic providerless failure",
        }),
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it("records providerless buyer and seller rejections without releasing the webhook claim", async () => {
    const event = {
      id: "evt_transactional_providerless_failures",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_transactional_providerless_failures",
          amount: 12500,
          currency: "cad",
          metadata: { orderId: "order_transactional_providerless_failures" },
        },
      },
    };
    process.env.RESEND_API_KEY = "synthetic-configured-but-unattempted-key";
    mockConstructEvent.mockReturnValue(event);
    mockedPrisma.eventDelivery.create
      .mockResolvedValueOnce({ id: "delivery-transactional-providerless-failures" })
      .mockRejectedValueOnce({ code: "P2002" });
    mockedPrisma.emailDelivery.findUnique.mockResolvedValue(null);
    mockSendEmail
      .mockRejectedValueOnce(new Error("synthetic buyer providerless failure"))
      .mockRejectedValueOnce("synthetic seller providerless failure")
      .mockResolvedValueOnce({ ok: true, provider: "CONSOLE", providerResult: "LOGGED" });
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const tx = {
      payment: { upsert: jest.fn().mockResolvedValue({}) },
      order: {
        update: jest.fn().mockResolvedValue({
          id: "order_transactional_providerless_failures",
          amountCents: 10000,
          totalCents: 12500,
          payment: { currency: "CAD" },
          items: [{ ticket: { title: "Synthetic Event", venue: "Synthetic Venue", date: "2030-01-01" } }],
          buyerSeller: {
            user: {
              id: "buyer-transactional-providerless-failures",
              email: "buyer@example.test",
              firstName: "Buyer",
            },
          },
          seller: {
            user: {
              id: "seller-transactional-providerless-failures",
              email: "seller@example.test",
              firstName: "Seller",
            },
          },
        }),
      },
    };
    mockedPrisma.$transaction.mockImplementation((callback) => callback(tx));

    try {
      const response = await POST(makeWebhookRequest(JSON.stringify(event)));
      const replay = await POST(makeWebhookRequest(JSON.stringify(event)));

      expect(response.status).toBe(200);
      await expect(replay.json()).resolves.toEqual({ ok: true, replay: true });
      expect(mockedPrisma.emailDelivery.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          emailType: "PURCHASE_CONFIRMATION",
          provider: "CONSOLE",
          status: "FAILED",
          error: "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: synthetic buyer providerless failure",
        }),
      });
      expect(mockedPrisma.emailDelivery.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          emailType: "SALE_NOTIFICATION",
          provider: "CONSOLE",
          status: "FAILED",
          error: "EXCEPTION_WITHOUT_PROVIDER_EVIDENCE: Unknown email error",
        }),
      });
      expect(mockedPrisma.eventDelivery.deleteMany).not.toHaveBeenCalled();
      expect(mockSendEmail).toHaveBeenCalledTimes(3);
      expect(mockNotifyPurchaseConfirmed).toHaveBeenCalledTimes(1);
      expect(mockNotifyTicketSold).toHaveBeenCalledTimes(1);
      expect(mockNotifySellerTransferRequired).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("releases the webhook claim when delivery-evidence persistence fails", async () => {
    const event = {
      id: "evt_delivery_persistence_failure",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_delivery_persistence_failure",
          amount: 12500,
          currency: "cad",
          metadata: { orderId: "order_delivery_persistence_failure" },
        },
      },
    };
    mockConstructEvent.mockReturnValue(event);
    mockedPrisma.eventDelivery.create.mockResolvedValue({ id: "delivery-persistence-failure" });
    mockedPrisma.eventDelivery.deleteMany.mockResolvedValue({ count: 1 });
    mockedPrisma.emailDelivery.findUnique.mockResolvedValue(null);
    mockedPrisma.emailDelivery.create.mockRejectedValueOnce(new Error("synthetic delivery persistence failure"));
    mockSendEmail.mockResolvedValueOnce({ ok: true, provider: "SENDGRID", providerResult: "accepted-buyer" });
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const tx = {
      payment: { upsert: jest.fn().mockResolvedValue({}) },
      order: {
        update: jest.fn().mockResolvedValue({
          id: "order_delivery_persistence_failure",
          amountCents: 10000,
          totalCents: 12500,
          payment: { currency: "CAD" },
          items: [{ ticket: { title: "Synthetic Event", venue: "Synthetic Venue", date: "2030-01-01" } }],
          buyerSeller: {
            user: {
              id: "buyer-delivery-persistence-failure",
              email: "buyer@example.test",
              firstName: "Buyer",
            },
          },
          seller: null,
        }),
      },
    };
    mockedPrisma.$transaction.mockImplementation((callback) => callback(tx));

    try {
      const response = await POST(makeWebhookRequest(JSON.stringify(event)));

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ ok: false, error: "PROCESSING_ERROR" });
      expect(mockedPrisma.eventDelivery.deleteMany).toHaveBeenCalledWith({ where: { eventId: event.id } });
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      expect(mockNotifyPurchaseConfirmed).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
