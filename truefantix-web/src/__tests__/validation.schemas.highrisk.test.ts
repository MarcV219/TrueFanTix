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

    it("accepts multiple optional supporting documents", () => {
      expect(
        schemas.orderOpenDispute.safeParse({
          ...validPayload,
          evidenceFiles: [
            {
              data: "data:application/pdf;base64,JVBERi0xLjQ=",
              fileName: "transfer-evidence.pdf",
            },
            {
              data: "data:image/png;base64,iVBORw0KGgo=",
              fileName: "ticket.png",
            },
          ],
        }).success
      ).toBe(true);
    });

    it("rejects an unsupported evidence file type", () => {
      expect(
        schemas.orderOpenDispute.safeParse({
          ...validPayload,
          evidenceFiles: [
            {
              data: "data:text/html;base64,PGgxPk5vPC9oMT4=",
              fileName: "unsafe.html",
            },
          ],
        }).success
      ).toBe(false);
    });

    it("rejects more than five supporting documents", () => {
      expect(
        schemas.orderOpenDispute.safeParse({
          ...validPayload,
          evidenceFiles: Array.from({ length: 6 }, (_, index) => ({
            data: "data:application/pdf;base64,JVBERi0xLjQ=",
            fileName: `evidence-${index}.pdf`,
          })),
        }).success
      ).toBe(false);
    });
  });

  describe("orderDisputeEvidence", () => {
    const orderId = "ckx1234567890abcdef123458";

    it("accepts comments, documents, or both", () => {
      expect(schemas.orderDisputeEvidence.safeParse({ orderId, comments: "Additional context." }).success).toBe(true);
      expect(schemas.orderDisputeEvidence.safeParse({
        orderId,
        evidenceFiles: [{ data: "data:application/pdf;base64,JVBERi0xLjQ=", fileName: "proof.pdf" }],
      }).success).toBe(true);
    });

    it("rejects an empty update", () => {
      expect(schemas.orderDisputeEvidence.safeParse({ orderId, comments: "", evidenceFiles: [] }).success).toBe(false);
    });

    it("rejects unsupported files and more than five documents", () => {
      expect(schemas.orderDisputeEvidence.safeParse({
        orderId,
        evidenceFiles: [{ data: "data:text/html;base64,PGgxPk5vPC9oMT4=", fileName: "unsafe.html" }],
      }).success).toBe(false);
      expect(schemas.orderDisputeEvidence.safeParse({
        orderId,
        evidenceFiles: Array.from({ length: 6 }, (_, index) => ({
          data: "data:application/pdf;base64,JVBERi0xLjQ=",
          fileName: `proof-${index}.pdf`,
        })),
      }).success).toBe(false);
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
