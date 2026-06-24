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
    totalPaidCents: 23000,
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

  it("sends listing context so screenshot PDF dates without years can be normalized", async () => {
    await analyzeReceiptProof({
      receiptDataUrl: "data:application/pdf;base64,JVBERi0=",
      receiptFileName: "ticketmaster-receipt.pdf",
      expectedEventTitle: "Ice Cube",
      expectedVenue: "Casino Rama Resort",
      expectedEventDate: "2026-06-26 9:00 PM",
    });

    const payload = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body));
    const prompt = payload.input[0].content[0].text;
    expect(prompt).toContain('event title "Ice Cube"');
    expect(prompt).toContain('venue "Casino Rama Resort"');
    expect(prompt).toContain('date "2026-06-26 9:00 PM"');
    expect(prompt).toContain("If a visible receipt date omits the year but its month/day matches the expected listing date");
    expect(prompt).toContain("include every non-face-value amount visibly paid");
    expect(prompt).toContain("order processing fees");
    expect(prompt).toContain("facility fees");
    expect(prompt).toContain("Preserve visible seat ranges exactly");
    expect(prompt).toContain('Seats 3-6 should be seat "3-6"');
    expect(prompt).toContain("Preserve visible ticket type wording");
    expect(prompt).toContain("Verified Resale Ticket");
  });

  it("normalizes visible month/day receipt dates to the expected event year when they match", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          ...JSON.parse(openAiResponse.output_text),
          eventDate: "Fri Jun 26",
          eventTime: "9:00 PM",
        }),
      }),
    } as Response);

    const result = await analyzeReceiptProof({
      receiptDataUrl: "data:application/pdf;base64,JVBERi0=",
      receiptFileName: "ticketmaster-receipt.pdf",
      expectedEventDate: "2026-06-26 9:00 PM",
    });

    expect(result.eventDate).toBe("2026-06-26");
    expect(result.eventTime).toBe("9:00 PM");
  });

  it("does not force a visible receipt month/day onto a conflicting expected date", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          ...JSON.parse(openAiResponse.output_text),
          eventDate: "Fri Jun 26",
        }),
      }),
    } as Response);

    const result = await analyzeReceiptProof({
      receiptDataUrl: "data:application/pdf;base64,JVBERi0=",
      receiptFileName: "ticketmaster-receipt.pdf",
      expectedEventDate: "2026-06-27 9:00 PM",
    });

    expect(result.eventDate).toBe("Fri Jun 26");
  });

  it("uses raw summary date and ticket evidence when structured OCR fields are missing", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          ...JSON.parse(openAiResponse.output_text),
          hasPurchaseReceipt: true,
          hasTickets: false,
          eventDate: null,
          eventTime: null,
          ticketQuantity: 3,
          seats: [{ section: "N", row: "13", seat: null }],
          faceValueCents: 8500,
          totalFaceValueCents: 25500,
          serviceFeesCents: 1215,
          totalServiceFeesCents: 3645,
          totalPaidCents: 29145,
          rawTextSummary:
            "Ticketmaster page for Ice Cube at Casino Rama Resort, Rama, ON. Visible date/time: Fri Jun 26, 9:00 PM. Selected location Sec N, Row 13. Quantity 3 Standard Adult Tickets at CA $97.15 each. Face Value CA $255.00; Service Fee CA $36.45.",
        }),
      }),
    } as Response);

    const result = await analyzeReceiptProof({
      receiptDataUrl: "data:application/pdf;base64,JVBERi0=",
      receiptFileName: "ticketmaster-receipt.pdf",
      expectedEventDate: "2026-06-26 9:00 PM",
    });

    expect(result.hasTickets).toBe(true);
    expect(result.eventDate).toBe("2026-06-26");
    expect(result.eventTime).toBe("9:00 PM");
    expect(result.ok).toBe(true);
  });

  it("recovers Ticketmaster section row and seat range from the raw summary", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          ...JSON.parse(openAiResponse.output_text),
          eventTitle: "Chicago Bears vs. Green Bay Packers",
          venue: "Soldier Field",
          eventDate: "2026-12-25",
          eventTime: "12:00 PM",
          ticketQuantity: 4,
          seats: [],
          faceValueCents: 30000,
          totalFaceValueCents: 120000,
          serviceFeesCents: 5700,
          totalServiceFeesCents: 22800,
          totalPaidCents: 142800,
          currency: "USD",
          rawTextSummary:
            "Ticketmaster Chicago Bears vs. Green Bay Packers at Soldier Field, Chicago, IL. UPPER (400 LEVEL) • Sec 429 • Row 34 • Seats 3-6. 4 tickets. Face Value x4 US$1,200.00; Service Fee x4 US$228.00.",
        }),
      }),
    } as Response);

    const result = await analyzeReceiptProof({
      receiptDataUrl: "data:application/pdf;base64,JVBERi0=",
      receiptFileName: "ticketmaster-receipt.pdf",
      expectedEventDate: "2026-12-25 12:00 PM",
    });

    expect(result.seats).toEqual([{ section: "429", row: "34", seat: "3-6" }]);
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
