import { analyzeReceiptProof } from "@/lib/tickets/receiptOcr";

const openAiResponse = {
  output_text: JSON.stringify({
    hasPurchaseReceipt: true,
    hasTickets: true,
    eventTitle: "Ice Cube",
    artistOrTeam: "Ice Cube",
    venue: "Scotiabank Arena",
    eventDate: "2026-09-01",
    eventTime: "8:00 PM",
    ticketQuantity: 2,
    seats: [],
    faceValueCents: 10000,
    totalFaceValueCents: 20000,
    serviceFeesCents: 1500,
    totalServiceFeesCents: 3000,
    currency: "CAD",
    confidence: 0.9,
    rawTextSummary: "Ticket purchase receipt",
    reason: null,
  }),
};

describe("receipt OCR upload formats", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => openAiResponse,
    } as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.OPENAI_API_KEY = originalApiKey;
  });

  it("sends supported image uploads as input_image", async () => {
    await analyzeReceiptProof({
      receiptDataUrl: "data:image/png;base64,aW1hZ2U=",
      receiptFileName: "receipt.png",
    });

    const payload = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body));
    expect(payload.input[0].content[1]).toEqual({
      type: "input_image",
      image_url: "data:image/png;base64,aW1hZ2U=",
    });
  });

  it("sends PDF uploads as input_file", async () => {
    await analyzeReceiptProof({
      receiptDataUrl: "data:application/pdf;base64,JVBERi0=",
      receiptFileName: "ticketmaster-receipt.pdf",
    });

    const payload = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body));
    expect(payload.input[0].content[1]).toEqual({
      type: "input_file",
      filename: "ticketmaster-receipt.pdf",
      file_data: "data:application/pdf;base64,JVBERi0=",
    });
  });

  it("rejects unsupported upload formats before OCR", async () => {
    const result = await analyzeReceiptProof({
      receiptDataUrl: "data:text/plain;base64,cmVjZWlwdA==",
      receiptFileName: "receipt.txt",
    });

    expect(result.status).toBe("unsupported");
    expect(result.reason).toBe("receipt-ocr-unsupported-file-type");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
