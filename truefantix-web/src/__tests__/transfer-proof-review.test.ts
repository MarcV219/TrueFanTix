import { analyzeTransferProof } from "@/lib/orders/transferProofReview";

const baseOpenAiPayload = {
  hasCompletedTransfer: true,
  recipientName: "Buyer Example",
  recipientEmail: "buyer@example.com",
  eventTitle: "Ice Cube",
  venue: "Casino Rama Resort",
  eventDate: "2026-06-26",
  ticketQuantity: 2,
  ticketDetails: "Section 101, Row A, Seats 1-2",
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
      expectedBuyerName: "Buyer Example",
      expectedBuyerEmail: "buyer@example.com",
      expectedEventTitles: ["Ice Cube"],
      expectedVenue: "Casino Rama Resort",
      expectedEventDate: "2026-06-26 9:00 PM",
      expectedTicketCount: 2,
      expectedTicketDetails: ["Row A, Seat 1", "Row A, Seat 2"],
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
    expect(payload.input[0].content[0].text).toContain("Expected buyer name: Buyer Example");
    expect(payload.input[0].content[0].text).toContain("Expected ticket count: 2");
    expect(payload.input[0].content[0].text).toContain("Expected ticket details: Row A, Seat 1 | Row A, Seat 2");
  });

  it("flags proof sent to the wrong visible recipient", async () => {
    mockOpenAi({
      ...baseOpenAiPayload,
      recipientName: "Someone Else",
      recipientEmail: "someone-else@example.com",
    });

    const result = await analyzeTransferProof({
      proofDataUrl: "data:application/pdf;base64,JVBERi0=",
      proofFileName: "transfer.pdf",
      expectedBuyerName: "Buyer Example",
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

  it("accepts a matching buyer name when the recipient email is not visible", async () => {
    mockOpenAi({
      ...baseOpenAiPayload,
      recipientName: "Buyer Example",
      recipientEmail: null,
    });

    const result = await analyzeTransferProof({
      proofDataUrl: "data:application/pdf;base64,JVBERi0=",
      proofFileName: "transfer.pdf",
      expectedBuyerName: "Buyer Example",
      expectedBuyerEmail: "buyer@example.com",
      expectedEventTitles: ["Ice Cube"],
      expectedVenue: "Casino Rama Resort",
      expectedEventDate: "2026-06-26",
      expectedTicketCount: 2,
    });

    expect(result.ok).toBe(true);
    expect(result.recipientName).toBe("Buyer Example");
    expect(result.recipientEmail).toBeNull();
    expect(result.issues).not.toContain("MISSING_RECIPIENT");
    expect(result.issues).not.toContain("RECIPIENT_EMAIL_MISMATCH");
  });

  it("accepts a matching buyer email when the visible recipient name differs", async () => {
    mockOpenAi({
      ...baseOpenAiPayload,
      recipientName: "Preferred Ticketmaster Name",
      recipientEmail: "buyer@example.com",
    });

    const result = await analyzeTransferProof({
      proofDataUrl: "data:image/png;base64,cHJvb2Y=",
      expectedBuyerName: "Buyer Example",
      expectedBuyerEmail: "buyer@example.com",
      expectedEventTitles: ["Ice Cube"],
      expectedVenue: "Casino Rama Resort",
      expectedEventDate: "2026-06-26",
      expectedTicketCount: 2,
    });

    expect(result.ok).toBe(true);
    expect(result.issues).not.toContain("RECIPIENT_EMAIL_MISMATCH");
  });

  it("rejects proof showing different assigned seats", async () => {
    mockOpenAi({
      ...baseOpenAiPayload,
      ticketDetails: "Section 101, Row D, Seats 3-4",
    });

    const result = await analyzeTransferProof({
      proofDataUrl: "data:image/png;base64,cHJvb2Y=",
      expectedBuyerName: "Buyer Example",
      expectedBuyerEmail: "buyer@example.com",
      expectedEventTitles: ["Ice Cube"],
      expectedVenue: "Casino Rama Resort",
      expectedEventDate: "2026-06-26",
      expectedTicketCount: 2,
      expectedTicketDetails: ["Row D, Seat 1", "Row D, Seat 2"],
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("needs_review");
    expect(result.issues).toContain("TICKET_DETAILS_MISMATCH");
  });

  it("rejects a different venue that shares only a generic venue word", async () => {
    mockOpenAi({
      ...baseOpenAiPayload,
      venue: "Rogers Centre",
    });

    const result = await analyzeTransferProof({
      proofDataUrl: "data:image/png;base64,cHJvb2Y=",
      expectedBuyerName: "Buyer Example",
      expectedBuyerEmail: "buyer@example.com",
      expectedEventTitles: ["Ice Cube"],
      expectedVenue: "Avenir Centre",
      expectedEventDate: "2026-06-26",
      expectedTicketCount: 2,
      expectedTicketDetails: ["Section 101, Row A, Seat 1", "Section 101, Row A, Seat 2"],
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("VENUE_MISMATCH");
  });

  it("accepts a visible seat range covering every assigned seat", async () => {
    mockOpenAi({
      ...baseOpenAiPayload,
      ticketDetails: "Section 101, Row D, Seats 1-2",
    });

    const result = await analyzeTransferProof({
      proofDataUrl: "data:image/png;base64,cHJvb2Y=",
      expectedBuyerName: "Buyer Example",
      expectedBuyerEmail: "buyer@example.com",
      expectedEventTitles: ["Ice Cube"],
      expectedVenue: "Casino Rama Resort",
      expectedEventDate: "2026-06-26",
      expectedTicketCount: 2,
      expectedTicketDetails: ["Row D, Seat 1", "Row D, Seat 2"],
    });

    expect(result.ok).toBe(true);
    expect(result.issues).not.toContain("TICKET_DETAILS_MISMATCH");
  });

  it("rejects proof that omits seat details for assigned seating", async () => {
    mockOpenAi({
      ...baseOpenAiPayload,
      ticketDetails: "Two reserved tickets",
    });

    const result = await analyzeTransferProof({
      proofDataUrl: "data:image/png;base64,cHJvb2Y=",
      expectedBuyerName: "Buyer Example",
      expectedBuyerEmail: "buyer@example.com",
      expectedEventTitles: ["Ice Cube"],
      expectedVenue: "Casino Rama Resort",
      expectedEventDate: "2026-06-26",
      expectedTicketCount: 2,
      expectedTicketDetails: ["Row D, Seat 1", "Row D, Seat 2"],
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("TICKET_DETAILS_MISMATCH");
  });

  it("rejects proof that omits the ordered section", async () => {
    mockOpenAi({
      ...baseOpenAiPayload,
      ticketDetails: "Row A, Seats 1-2",
    });

    const result = await analyzeTransferProof({
      proofDataUrl: "data:image/png;base64,cHJvb2Y=",
      expectedBuyerName: "Buyer Example",
      expectedBuyerEmail: "buyer@example.com",
      expectedEventTitles: ["Ice Cube"],
      expectedVenue: "Casino Rama Resort",
      expectedEventDate: "2026-06-26",
      expectedTicketCount: 2,
      expectedTicketDetails: ["Section 101, Row A, Seat 1", "Section 101, Row A, Seat 2"],
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("TICKET_DETAILS_MISMATCH");
  });

  it("accepts a bare section at the start of a compact seating line", async () => {
    mockOpenAi({
      ...baseOpenAiPayload,
      ticketQuantity: 1,
      ticketDetails: "FL2, Row 4, Seat 2",
    });

    const result = await analyzeTransferProof({
      proofDataUrl: "data:image/png;base64,cHJvb2Y=",
      expectedBuyerName: "Buyer Example",
      expectedBuyerEmail: "buyer@example.com",
      expectedEventTitles: ["Ice Cube"],
      expectedVenue: "Casino Rama Resort",
      expectedEventDate: "2026-06-26",
      expectedTicketCount: 1,
      expectedTicketDetails: ["Section FL2, Row 4, Seat 2"],
    });

    expect(result.ok).toBe(true);
    expect(result.issues).not.toContain("TICKET_DETAILS_MISMATCH");
  });

  it.each([
    "FL2, R4, S2",
    "FL2, 4, 2",
    "Section FL2 / R 4 / S 2",
    "Sec. FL2 • Row 4 • Seat 2",
  ])("accepts flexible compact seating wording: %s", async (ticketDetails) => {
    mockOpenAi({
      ...baseOpenAiPayload,
      ticketQuantity: 1,
      ticketDetails,
    });

    const result = await analyzeTransferProof({
      proofDataUrl: "data:image/png;base64,cHJvb2Y=",
      expectedBuyerName: "Buyer Example",
      expectedBuyerEmail: "buyer@example.com",
      expectedEventTitles: ["Ice Cube"],
      expectedVenue: "Casino Rama Resort",
      expectedEventDate: "2026-06-26",
      expectedTicketCount: 1,
      expectedTicketDetails: ["Section FL2, Row 4, Seat 2"],
    });

    expect(result.ok).toBe(true);
    expect(result.issues).not.toContain("TICKET_DETAILS_MISMATCH");
  });

  it("rejects a flexible compact seating line when one key value differs", async () => {
    mockOpenAi({
      ...baseOpenAiPayload,
      ticketQuantity: 1,
      ticketDetails: "FL2, R4, S3",
    });

    const result = await analyzeTransferProof({
      proofDataUrl: "data:image/png;base64,cHJvb2Y=",
      expectedBuyerName: "Buyer Example",
      expectedBuyerEmail: "buyer@example.com",
      expectedEventTitles: ["Ice Cube"],
      expectedVenue: "Casino Rama Resort",
      expectedEventDate: "2026-06-26",
      expectedTicketCount: 1,
      expectedTicketDetails: ["Section FL2, Row 4, Seat 2"],
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("TICKET_DETAILS_MISMATCH");
  });

  it("still rejects a wrong bare section in a compact seating line", async () => {
    mockOpenAi({
      ...baseOpenAiPayload,
      ticketQuantity: 1,
      ticketDetails: "FL3, Row 4, Seat 2",
    });

    const result = await analyzeTransferProof({
      proofDataUrl: "data:image/png;base64,cHJvb2Y=",
      expectedBuyerName: "Buyer Example",
      expectedBuyerEmail: "buyer@example.com",
      expectedEventTitles: ["Ice Cube"],
      expectedVenue: "Casino Rama Resort",
      expectedEventDate: "2026-06-26",
      expectedTicketCount: 1,
      expectedTicketDetails: ["Section FL2, Row 4, Seat 2"],
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("TICKET_DETAILS_MISMATCH");
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

  it("rejects proof that omits required recipient, event, or ticket information", async () => {
    mockOpenAi({
      ...baseOpenAiPayload,
      recipientName: null,
      recipientEmail: null,
      eventTitle: null,
      eventDate: null,
      venue: null,
      ticketQuantity: null,
      ticketDetails: null,
    });

    const result = await analyzeTransferProof({
      proofDataUrl: "data:image/png;base64,cHJvb2Y=",
      expectedBuyerEmail: "buyer@example.com",
      expectedEventTitles: ["Ice Cube"],
      expectedVenue: "Casino Rama Resort",
      expectedEventDate: "2026-06-26",
      expectedTicketCount: 2,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      "MISSING_RECIPIENT",
      "MISSING_EVENT_INFO",
      "MISSING_TICKET_INFO",
    ]));
  });
});
