import { analyzeTransferProof } from "@/lib/orders/transferProofReview";

const baseOpenAiPayload = {
  hasCompletedTransfer: true,
  recipientEmail: "buyer@example.com",
  eventTitle: "Ice Cube",
  venue: "Casino Rama Resort",
  eventDate: "2026-06-26",
  ticketQuantity: 2,
  confirmationId: "TM-12345",
  confidence: 0.92,
  rawTextSummary: "Ticketmaster transfer completed to buyer@example.com for 2 Ice Cube tickets.",
  reason: null,
};

function mockOpenAi(payload: Record<string, unknown>) {
  jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ output_text: JSON.stringify(payload) }),
  } as Response);
}

describe("transfer proof review", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-openai-key";
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.OPENAI_API_KEY = originalApiKey;
  });

  it("accepts clear matching transfer proof", async () => {
    mockOpenAi(baseOpenAiPayload);

    const result = await analyzeTransferProof({
      proofDataUrl: "data:image/png;base64,cHJvb2Y=",
      proofFileName: "transfer.png",
      expectedBuyerEmail: "buyer@example.com",
      expectedEventTitles: ["Ice Cube"],
      expectedVenue: "Casino Rama Resort",
      expectedEventDate: "2026-06-26 9:00 PM",
      expectedTicketCount: 2,
      sellerNote: "TM-12345",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("matched");
    expect(result.issues).toEqual([]);

    const payload = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body));
    expect(payload.input[0].content[1]).toEqual({
      type: "input_image",
      image_url: "data:image/png;base64,cHJvb2Y=",
    });
    expect(payload.input[0].content[0].text).toContain("Expected buyer email: buyer@example.com");
    expect(payload.input[0].content[0].text).toContain("Expected ticket count: 2");
  });

  it("flags proof sent to the wrong visible recipient", async () => {
    mockOpenAi({
      ...baseOpenAiPayload,
      recipientEmail: "someone-else@example.com",
    });

    const result = await analyzeTransferProof({
      proofDataUrl: "data:application/pdf;base64,JVBERi0=",
      proofFileName: "transfer.pdf",
      expectedBuyerEmail: "buyer@example.com",
      expectedEventTitles: ["Ice Cube"],
      expectedVenue: "Casino Rama Resort",
      expectedEventDate: "2026-06-26",
      expectedTicketCount: 2,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("needs_review");
    expect(result.issues).toContain("RECIPIENT_EMAIL_MISMATCH");

    const payload = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body));
    expect(payload.input[0].content[1]).toEqual({
      type: "input_file",
      filename: "transfer.pdf",
      file_data: "data:application/pdf;base64,JVBERi0=",
    });
  });

  it("rejects unsupported proof upload formats before review", async () => {
    const result = await analyzeTransferProof({
      proofDataUrl: "data:text/plain;base64,cHJvb2Y=",
      proofFileName: "transfer.txt",
    });

    expect(result.status).toBe("unsupported");
    expect(result.reason).toBe("transfer-proof-unsupported-file-type");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
