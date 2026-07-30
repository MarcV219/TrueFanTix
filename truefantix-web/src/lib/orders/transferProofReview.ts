export type TransferProofIssue =
  | "NO_COMPLETED_TRANSFER"
  | "MISSING_RECIPIENT"
  | "MISSING_EVENT_INFO"
  | "MISSING_TICKET_INFO"
  | "RECIPIENT_EMAIL_MISMATCH"
  | "EVENT_TITLE_MISMATCH"
  | "VENUE_MISMATCH"
  | "EVENT_DATE_MISMATCH"
  | "TICKET_COUNT_MISMATCH"
  | "TICKET_DETAILS_MISMATCH"
  | "LOW_CONFIDENCE";

export type TransferProofReview = {
  ok: boolean;
  status: "matched" | "needs_review" | "unavailable" | "unsupported";
  provider: "openai" | "none";
  model: string | null;
  reason: string | null;
  hasCompletedTransfer: boolean | null;
  recipientName: string | null;
  recipientEmail: string | null;
  eventTitle: string | null;
  venue: string | null;
  eventDate: string | null;
  ticketQuantity: number | null;
  ticketDetails: string | null;
  confirmationId: string | null;
  rawTextSummary: string | null;
  confidence: number;
  issues: TransferProofIssue[];
};

type AnalyzeTransferProofInput = {
  proofDataUrl: string | null;
  proofFileName?: string | null;
  expectedBuyerName?: string | null;
  expectedBuyerEmail?: string | null;
  expectedEventTitles?: string[];
  expectedVenue?: string | null;
  expectedEventDate?: string | null;
  expectedTicketCount?: number;
  expectedTicketDetails?: string[];
  sellerNote?: string | null;
};

function unavailable(reason: string, status: TransferProofReview["status"] = "unavailable"): TransferProofReview {
  return {
    ok: false,
    status,
    provider: "none",
    model: null,
    reason,
    hasCompletedTransfer: null,
    recipientName: null,
    recipientEmail: null,
    eventTitle: null,
    venue: null,
    eventDate: null,
    ticketQuantity: null,
    ticketDetails: null,
    confirmationId: null,
    rawTextSummary: null,
    confidence: 0,
    issues: [],
  };
}

function isImageDataUrl(value: string) {
  return /^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(value);
}

function isPdfDataUrl(value: string) {
  return /^data:application\/pdf;base64,/i.test(value);
}

function proofInputContent(proofDataUrl: string, proofFileName?: string | null) {
  if (isPdfDataUrl(proofDataUrl)) {
    return {
      type: "input_file",
      filename: proofFileName || "transfer-proof.pdf",
      file_data: proofDataUrl,
    };
  }

  return { type: "input_image", image_url: proofDataUrl };
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

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function normalizeName(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recipientNameMatches(visibleName: string | null, expectedName?: string | null) {
  const visible = normalizeName(visibleName);
  const expected = normalizeName(expectedName);
  if (!visible || !expected) return false;
  if (visible === expected) return true;

  const visibleWords = visible.split(" ");
  const expectedWords = expected.split(" ");
  if (visibleWords.length === 1) return expectedWords.includes(visible);
  if (expectedWords.length === 1) return visibleWords.includes(expected);
  return overlapScore(visible, expected) >= 1;
}

function ymd(value: string | null | undefined): string | null {
  if (!value) return null;
  const direct = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function words(value: string | null | undefined) {
  return new Set(
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 3)
  );
}

function overlapScore(left: string | null | undefined, right: string | null | undefined) {
  const leftWords = words(left);
  const rightWords = words(right);
  if (!leftWords.size || !rightWords.size) return 0;
  let matches = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) matches += 1;
  }
  return matches / Math.min(leftWords.size, rightWords.size);
}

function titleMatches(visibleTitle: string | null, expectedTitles: string[]) {
  if (!visibleTitle || !expectedTitles.length) return true;
  return expectedTitles.some((title) => overlapScore(visibleTitle, title) >= 0.5);
}

function venueMatches(visibleVenue: string | null, expectedVenue?: string | null) {
  if (!visibleVenue || !expectedVenue) return true;
  const genericVenueWords = new Set([
    "arena", "center", "centre", "complex", "event", "events", "hall",
    "park", "pavilion", "stadium", "theater", "theatre", "venue",
  ]);
  const meaningfulWords = (value: string) => Array.from(words(value))
    .map((word) => word === "centre" ? "center" : word)
    .filter((word) => !genericVenueWords.has(word));
  const visibleWords = new Set(meaningfulWords(visibleVenue));
  const expectedWords = meaningfulWords(expectedVenue);

  if (visibleWords.size && expectedWords.length) {
    return expectedWords.some((word) => visibleWords.has(word));
  }

  const normalizedVisible = normalizeName(visibleVenue).replace(/\bcentre\b/g, "center");
  const normalizedExpected = normalizeName(expectedVenue).replace(/\bcentre\b/g, "center");
  return normalizedVisible === normalizedExpected;
}

type AssignedSeat = {
  section: string | null;
  row: string;
  seat: string;
};

function normalizeSeatValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function expectedAssignedSeats(details: string[] | undefined): AssignedSeat[] {
  return (details ?? []).flatMap((detail) => {
    const section = detail.match(/\bsection\s*[:#-]?\s*([a-z0-9-]+)/i)?.[1];
    const row = detail.match(/\brow\s*[:#-]?\s*([a-z0-9-]+)/i)?.[1];
    const seat = detail.match(/\bseats?\s*[:#-]?\s*([a-z0-9-]+)/i)?.[1];
    if (!row || !seat) return [];
    return [{
      section: section ? normalizeSeatValue(section) : null,
      row: normalizeSeatValue(row),
      seat: normalizeSeatValue(seat),
    }];
  });
}

function visibleSeatValues(ticketDetails: string) {
  const values = new Set<string>();
  const seatSegments = ticketDetails.matchAll(/\bseats?\s*[:#-]?\s*([a-z0-9]+(?:\s*(?:-|–|—|,|&|and|to)\s*[a-z0-9]+)*)/gi);

  for (const match of seatSegments) {
    const segment = match[1];
    const numericRange = segment.match(/^\s*(\d+)\s*(?:-|–|—|to)\s*(\d+)\s*$/i);
    if (numericRange) {
      const start = Number(numericRange[1]);
      const end = Number(numericRange[2]);
      if (end >= start && end - start <= 100) {
        for (let seat = start; seat <= end; seat += 1) values.add(String(seat));
        continue;
      }
    }

    for (const value of segment.split(/\s*(?:,|&|and)\s*/i)) {
      const normalized = normalizeSeatValue(value);
      if (normalized) values.add(normalized);
    }
  }

  return values;
}

function assignedTicketDetailsMatch(ticketDetails: string | null, expectedDetails?: string[]) {
  const expectedSeats = expectedAssignedSeats(expectedDetails);
  if (!expectedSeats.length) return true;
  if (!ticketDetails) return false;

  const visibleRows = new Set(
    Array.from(ticketDetails.matchAll(/\brow\s*[:#-]?\s*([a-z0-9-]+)/gi))
      .map((match) => normalizeSeatValue(match[1]))
      .filter(Boolean)
  );
  const visibleSections = new Set(
    Array.from(ticketDetails.matchAll(/\bsection\s*[:#-]?\s*([a-z0-9-]+)/gi))
      .map((match) => normalizeSeatValue(match[1]))
      .filter(Boolean)
  );
  const visibleSeats = visibleSeatValues(ticketDetails);

  return expectedSeats.every(({ section, row, seat }) =>
    (!section || visibleSections.has(section)) &&
    visibleRows.has(row) &&
    visibleSeats.has(seat)
  );
}

function uniqueIssues(issues: TransferProofIssue[]) {
  return Array.from(new Set(issues));
}

function transferReviewFromParsed(
  parsed: Record<string, unknown>,
  model: string,
  expected: Required<Pick<AnalyzeTransferProofInput, "expectedEventTitles">> & Omit<AnalyzeTransferProofInput, "expectedEventTitles" | "proofDataUrl" | "proofFileName">
): TransferProofReview {
  const confidence = Math.max(0, Math.min(1, normalizeNumber(parsed.confidence) ?? 0));
  const hasCompletedTransfer = normalizeBoolean(parsed.hasCompletedTransfer);
  const recipientName = normalizeString(parsed.recipientName);
  const recipientEmail = normalizeEmail(normalizeString(parsed.recipientEmail));
  const eventTitle = normalizeString(parsed.eventTitle);
  const venue = normalizeString(parsed.venue);
  const eventDate = ymd(normalizeString(parsed.eventDate)) ?? normalizeString(parsed.eventDate);
  const ticketQuantity = normalizeNumber(parsed.ticketQuantity);
  const ticketDetails = normalizeString(parsed.ticketDetails);
  const expectedTicketCount = Math.max(0, expected.expectedTicketCount ?? 0);
  const expectedBuyerEmail = normalizeEmail(expected.expectedBuyerEmail);
  const emailMatches = Boolean(recipientEmail && expectedBuyerEmail && recipientEmail === expectedBuyerEmail);
  const nameMatches = recipientNameMatches(recipientName, expected.expectedBuyerName);
  const hasVisibleRecipient = Boolean(recipientName || recipientEmail);
  const hasExpectedRecipient = Boolean(expectedBuyerEmail || normalizeName(expected.expectedBuyerName));

  const issues: TransferProofIssue[] = [];
  if (hasCompletedTransfer === false) issues.push("NO_COMPLETED_TRANSFER");
  if (!hasVisibleRecipient) issues.push("MISSING_RECIPIENT");
  if (!eventTitle || (!eventDate && !venue)) issues.push("MISSING_EVENT_INFO");
  if (ticketQuantity == null || !ticketDetails) issues.push("MISSING_TICKET_INFO");
  if (hasVisibleRecipient && hasExpectedRecipient && !emailMatches && !nameMatches) {
    issues.push("RECIPIENT_EMAIL_MISMATCH");
  }
  if (!titleMatches(eventTitle, expected.expectedEventTitles)) issues.push("EVENT_TITLE_MISMATCH");
  if (!venueMatches(venue, expected.expectedVenue)) issues.push("VENUE_MISMATCH");

  const visibleDate = ymd(eventDate);
  const expectedDate = ymd(expected.expectedEventDate);
  if (visibleDate && expectedDate && visibleDate !== expectedDate) issues.push("EVENT_DATE_MISMATCH");

  if (ticketQuantity != null && expectedTicketCount > 0 && ticketQuantity < expectedTicketCount) {
    issues.push("TICKET_COUNT_MISMATCH");
  }
  if (!assignedTicketDetailsMatch(ticketDetails, expected.expectedTicketDetails)) {
    issues.push("TICKET_DETAILS_MISMATCH");
  }
  if (confidence < 0.45) issues.push("LOW_CONFIDENCE");

  const finalIssues = uniqueIssues(issues);
  const ok = finalIssues.length === 0 && hasCompletedTransfer !== false && confidence >= 0.45;

  return {
    ok,
    status: ok ? "matched" : "needs_review",
    provider: "openai",
    model,
    reason: normalizeString(parsed.reason),
    hasCompletedTransfer,
    recipientName,
    recipientEmail,
    eventTitle,
    venue,
    eventDate,
    ticketQuantity,
    ticketDetails,
    confirmationId: normalizeString(parsed.confirmationId),
    rawTextSummary: normalizeString(parsed.rawTextSummary),
    confidence,
    issues: finalIssues,
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

export function transferProofIssueMessage(issue: TransferProofIssue) {
  const messages: Record<TransferProofIssue, string> = {
    NO_COMPLETED_TRANSFER: "the upload does not show a completed ticket transfer",
    MISSING_RECIPIENT: "the upload does not clearly show who received the tickets",
    MISSING_EVENT_INFO: "the upload does not clearly show the event name and its date or venue",
    MISSING_TICKET_INFO: "the upload does not clearly show the ticket quantity and ticket details",
    RECIPIENT_EMAIL_MISMATCH: "the visible recipient name or email does not match the buyer",
    EVENT_TITLE_MISMATCH: "the visible event name does not match this order",
    VENUE_MISMATCH: "the visible venue does not match this order",
    EVENT_DATE_MISMATCH: "the visible event date does not match this order",
    TICKET_COUNT_MISMATCH: "the visible ticket quantity is lower than this order",
    TICKET_DETAILS_MISMATCH: "the visible section, row, or seat numbers do not match this order",
    LOW_CONFIDENCE: "the proof is too unclear to verify automatically",
  };
  return messages[issue];
}

export async function analyzeTransferProof({
  proofDataUrl,
  proofFileName,
  expectedBuyerName,
  expectedBuyerEmail,
  expectedEventTitles = [],
  expectedVenue,
  expectedEventDate,
  expectedTicketCount,
  expectedTicketDetails,
  sellerNote,
}: AnalyzeTransferProofInput): Promise<TransferProofReview> {
  if (!proofDataUrl) return unavailable("missing-transfer-proof");
  if (!isImageDataUrl(proofDataUrl) && !isPdfDataUrl(proofDataUrl)) {
    return unavailable("transfer-proof-unsupported-file-type", "unsupported");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return unavailable("missing-openai-api-key");

  const model = process.env.OPENAI_TRANSFER_PROOF_MODEL || process.env.OPENAI_RECEIPT_OCR_MODEL || "gpt-5.5";
  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "hasCompletedTransfer",
      "recipientName",
      "recipientEmail",
      "eventTitle",
      "venue",
      "eventDate",
      "ticketQuantity",
      "ticketDetails",
      "confirmationId",
      "confidence",
      "rawTextSummary",
      "reason",
    ],
    properties: {
      hasCompletedTransfer: { type: ["boolean", "null"] },
      recipientName: {
        type: ["string", "null"],
        description: "The recipient's visible name, when shown.",
      },
      recipientEmail: { type: ["string", "null"] },
      eventTitle: { type: ["string", "null"] },
      venue: { type: ["string", "null"] },
      eventDate: { type: ["string", "null"], description: "YYYY-MM-DD when visible." },
      ticketQuantity: { type: ["number", "null"] },
      ticketDetails: {
        type: ["string", "null"],
        description: "Visible ticket-identifying information such as section, row, seat numbers, ticket type, or general-admission designation.",
      },
      confirmationId: { type: ["string", "null"] },
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
                  `Review this seller's ticket transfer proof for obvious mismatches or falsehoods. File name: ${proofFileName || "transfer-proof"}. ` +
                  `Expected buyer name: ${expectedBuyerName || "unknown"}. ` +
                  `Expected buyer email: ${expectedBuyerEmail || "unknown"}. ` +
                  `Expected event title(s): ${expectedEventTitles.join(" | ") || "unknown"}. ` +
                  `Expected venue: ${expectedVenue || "unknown"}. Expected date: ${expectedEventDate || "unknown"}. ` +
                  `Expected ticket count: ${expectedTicketCount ?? "unknown"}. Seller note/reference: ${sellerNote || "none"}. ` +
                  `Expected ticket details: ${expectedTicketDetails?.join(" | ") || "unknown"}. ` +
                  "The transfer recipient is valid when either the visible recipient name matches the expected buyer name or the visible recipient email matches the expected buyer email. " +
                  "Only report values visibly present in the proof. Do not infer hidden values. " +
                  "Set hasCompletedTransfer true only when the upload visibly indicates the tickets were sent, transferred, completed, accepted, or delivery was initiated to the recipient. " +
                  "Return null for fields that are not visible. ticketDetails must contain only visible ticket-identifying information such as section, row, seat, ticket type, or general admission. " +
                  "Use confidence 0 to 1 for how clearly the visible proof supports the extracted values.",
              },
              proofInputContent(proofDataUrl, proofFileName),
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "transfer_proof_review",
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
    return transferReviewFromParsed(parsed, model, {
      expectedBuyerName,
      expectedBuyerEmail,
      expectedEventTitles,
      expectedVenue,
      expectedEventDate,
      expectedTicketCount,
      expectedTicketDetails,
      sellerNote,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return unavailable(`transfer-proof-review-error:${message}`);
  }
}
