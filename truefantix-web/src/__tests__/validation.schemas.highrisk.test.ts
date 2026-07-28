import { schemas } from "@/lib/validation";

describe("high-risk schema contracts", () => {
  describe("orderCheckout", () => {
    it("accepts valid payload", () => {
      const parsed = schemas.orderCheckout.safeParse({
        ticketIds: ["ckx1234567890abcdef123456", "ckx1234567890abcdef123457"],
        buyerSellerId: "ckx1234567890abcdef123458",
        idempotencyKey: "idem_1234567890",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects empty ticketIds", () => {
      const parsed = schemas.orderCheckout.safeParse({
        ticketIds: [],
        buyerSellerId: "ckx1234567890abcdef123458",
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("paymentsCreateIntent", () => {
    it("accepts valid orderId", () => {
      const parsed = schemas.paymentsCreateIntent.safeParse({
        orderId: "ckx1234567890abcdef123458",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects missing orderId", () => {
      const parsed = schemas.paymentsCreateIntent.safeParse({});
      expect(parsed.success).toBe(false);
    });
  });

  describe("orderOpenDispute", () => {
    const validPayload = {
      orderId: "ckx1234567890abcdef123458",
      ticketIds: ["ckx1234567890abcdef123456", "ckx1234567890abcdef123457"],
      reason: "The selected tickets were not transferred.",
    };

    it("accepts one or more selected tickets", () => {
      expect(schemas.orderOpenDispute.safeParse(validPayload).success).toBe(true);
    });

    it("rejects a dispute without selected tickets", () => {
      expect(
        schemas.orderOpenDispute.safeParse({ ...validPayload, ticketIds: [] }).success
      ).toBe(false);
    });

    it("rejects duplicate selected tickets", () => {
      expect(
        schemas.orderOpenDispute.safeParse({
          ...validPayload,
          ticketIds: [validPayload.ticketIds[0], validPayload.ticketIds[0]],
        }).success
      ).toBe(false);
    });
  });

  describe("ticketPurchaseQuery", () => {
    it("accepts buyerSellerId with optional idempotencyKey", () => {
      const parsed = schemas.ticketPurchaseQuery.safeParse({
        buyerSellerId: "ckx1234567890abcdef123458",
        idempotencyKey: "idem_1234567890",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects missing buyerSellerId", () => {
      const parsed = schemas.ticketPurchaseQuery.safeParse({
        idempotencyKey: "idem_1234567890",
      });
      expect(parsed.success).toBe(false);
    });
  });
});
