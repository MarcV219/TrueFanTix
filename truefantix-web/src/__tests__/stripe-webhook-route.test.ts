/**
 * @jest-environment node
 */

import { POST } from "@/app/api/webhooks/stripe/route";
import { prisma } from "@/lib/prisma";

const mockConstructEvent = jest.fn();

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
  sendEmail: jest.fn(),
  generatePurchaseConfirmationEmail: jest.fn(() => ({ subject: "Purchase", text: "ok", html: "<p>ok</p>" })),
  generateSaleNotificationEmail: jest.fn(() => ({ subject: "Sale", text: "ok", html: "<p>ok</p>" })),
}));

jest.mock("@/lib/notifications/service", () => ({
  notifyTicketSold: jest.fn(),
  notifyPurchaseConfirmed: jest.fn(),
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
});
