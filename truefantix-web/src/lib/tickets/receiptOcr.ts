export type ReceiptSeat = {
  section: string | null;
  row: string | null;
  seat: string | null;
};

export type ReceiptOcrReview = {
  ok: boolean;
  status: "verified" | "needs_review" | "unavailable" | "unsupported";
  provider: "openai" | "none";
  model: string | null;
  reason: string | null;
  hasPurchaseReceipt: boolean | null;
  hasTickets: boolean | null;
  eventTitle: string | null;
  artistOrTeam: string | null;
  venue: string | null;
  eventDate: string | null;
  eventTime: string | null;
  ticketQuantity: number | null;
  seats: ReceiptSeat[];
  faceValueCents: number | null;
  totalFaceValueCents: number | null;
  serviceFeesCents: number | null;
  totalServiceFeesCents: number | null;
  currency: string | null;
  confidence: number;
  rawTextSummary: string | null;
};

type AnalyzeReceiptInput = {
  receiptDataUrl: string | null;
  receiptFileName?: string | null;
};

function unavailable(reason: string, status: ReceiptOcrReview["status"] = "unavailable"): ReceiptOcrReview {
  return {
    ok: false,
    status,
    provider: "none",
    model: null,
    reason,
    hasPurchaseReceipt: null,
    hasTickets: null,
    eventTitle: null,
    artistOrTeam: null,
    venue: null,
    eventDate: null,
    eventTime: null,
    ticketQuantity: null,
    seats: [],
    faceValueCents: null,
    totalFaceValueCents: null,
    serviceFeesCents: null,
    totalServiceFeesCents: null,
    currency: null,
    confidence: 0,
    rawTextSummary: null,
  };
}

function isImageDataUrl(value: string) {
  return /^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(value);
}

function isPdfDataUrl(value: string) {
  return /^data:application\/pdf;base64,/i.test(value);
}

function receiptInputContent(receiptDataUrl: string, receiptFileName?: string | null) {
  if (isPdfDataUrl(receiptDataUrl)) {
    return {
      type: "input_file",
      filename: receiptFileName || "receipt.pdf",
      file_data: receiptDataUrl,
    };
  }

  return { type: "input_image", image_url: receiptDataUrl };
}

function normalizeCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function normalizeSeats(value: unknown): ReceiptSeat[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((seat) => {
    const item = seat && typeof seat === "object" ? seat as Record<string, unknown> : {};
    return {
      section: normalizeString(item.section),
      row: normalizeString(item.row),
      seat: normalizeString(item.seat),
    };
  });
}

function receiptReviewFromParsed(parsed: Record<string, unknown>, model: string): ReceiptOcrReview {
  const confidence = Math.max(0, Math.min(1, normalizeNumber(parsed.confidence) ?? 0));
  const hasPurchaseReceipt = normalizeBoolean(parsed.hasPurchaseReceipt);
  const hasTickets = normalizeBoolean(parsed.hasTickets);
  const faceValueCents = normalizeCents(parsed.faceValueCents);
  const serviceFeesCents = normalizeCents(parsed.serviceFeesCents);

  return {
    ok: Boolean(hasPurchaseReceipt && hasTickets && confidence >= 0.55),
    status: hasPurchaseReceipt === false || hasTickets === false ? "needs_review" : "verified",
    provider: "openai",
    model,
    reason: normalizeString(parsed.reason),
    hasPurchaseReceipt,
    hasTickets,
    eventTitle: normalizeString(parsed.eventTitle),
    artistOrTeam: normalizeString(parsed.artistOrTeam),
    venue: normalizeString(parsed.venue),
    eventDate: normalizeString(parsed.eventDate),
    eventTime: normalizeString(parsed.eventTime),
    ticketQuantity: normalizeNumber(parsed.ticketQuantity),
    seats: normalizeSeats(parsed.seats),
    faceValueCents,
    totalFaceValueCents: normalizeCents(parsed.totalFaceValueCents),
    serviceFeesCents,
    totalServiceFeesCents: normalizeCents(parsed.totalServiceFeesCents),
    currency: normalizeString(parsed.currency),
    confidence,
    rawTextSummary: normalizeString(parsed.rawTextSummary),
  };
}

function outputText(data: unknown): string {
  const root = data && typeof data === "object" ? data as Record<string, unknown> : {};
  if (typeof root.output_text === "string") return root.output_text;

  const output = Array.isArray(root.output) ? root.output : [];
  const pieces: string[] = [];
  for (const item of output) {
    const outputItem = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const contentItems = Array.isArray(outputItem.content) ? outputItem.content : [];
    for (const content of contentItems) {
      const contentItem = content && typeof content === "object" ? content as Record<string, unknown> : {};
      if (typeof contentItem.text === "string") pieces.push(contentItem.text);
    }
  }
  return pieces.join("\n");
}

export async function analyzeReceiptProof({
  receiptDataUrl,
  receiptFileName,
}: AnalyzeReceiptInput): Promise<ReceiptOcrReview> {
  if (!receiptDataUrl) return unavailable("missing-receipt");
  if (!isImageDataUrl(receiptDataUrl) && !isPdfDataUrl(receiptDataUrl)) {
    return unavailable("receipt-ocr-unsupported-file-type", "unsupported");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return unavailable("missing-openai-api-key");

  const model = process.env.OPENAI_RECEIPT_OCR_MODEL || "gpt-5.5";
  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "hasPurchaseReceipt",
      "hasTickets",
      "eventTitle",
      "artistOrTeam",
      "venue",
      "eventDate",
      "eventTime",
      "ticketQuantity",
      "seats",
      "faceValueCents",
      "totalFaceValueCents",
      "serviceFeesCents",
      "totalServiceFeesCents",
      "currency",
      "confidence",
      "rawTextSummary",
      "reason",
    ],
    properties: {
      hasPurchaseReceipt: { type: ["boolean", "null"] },
      hasTickets: { type: ["boolean", "null"] },
      eventTitle: { type: ["string", "null"] },
      artistOrTeam: { type: ["string", "null"] },
      venue: { type: ["string", "null"] },
      eventDate: { type: ["string", "null"], description: "YYYY-MM-DD when visible." },
      eventTime: { type: ["string", "null"], description: "HH:MM AM/PM when visible." },
      ticketQuantity: { type: ["number", "null"] },
      seats: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["section", "row", "seat"],
          properties: {
            section: { type: ["string", "null"] },
            row: { type: ["string", "null"] },
            seat: { type: ["string", "null"] },
          },
        },
      },
      faceValueCents: { type: ["number", "null"], description: "Per-ticket face value in cents." },
      totalFaceValueCents: { type: ["number", "null"] },
      serviceFeesCents: { type: ["number", "null"], description: "Per-ticket service/admin fees in cents." },
      totalServiceFeesCents: { type: ["number", "null"] },
      currency: { type: ["string", "null"] },
      confidence: { type: "number" },
      rawTextSummary: { type: ["string", "null"] },
      reason: { type: ["string", "null"] },
    },
  };

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  `Extract ticket purchase receipt data from this upload. File name: ${receiptFileName || "receipt"}. ` +
                  "Only report values visibly present on the receipt. Do not infer fees or seats. " +
                  "Return null for missing fields. Amounts must be integer cents. " +
                  "For faceValueCents and serviceFeesCents, prefer per-ticket values; also fill totals when visible.",
              },
              receiptInputContent(receiptDataUrl, receiptFileName),
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "ticket_receipt_review",
            strict: true,
            schema,
          },
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return unavailable(`openai-http-${res.status}${detail ? `:${detail.slice(0, 160)}` : ""}`);
    }

    const data: unknown = await res.json();
    const text = outputText(data);
    if (!text) return unavailable("openai-empty-response");

    const parsed = JSON.parse(text) as Record<string, unknown>;
    return receiptReviewFromParsed(parsed, model);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return unavailable(`receipt-ocr-error:${message}`);
  }
}
