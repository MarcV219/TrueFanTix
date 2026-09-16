/** @jest-environment node */
const mockVerify = jest.fn();
const mockRetrieveReply = jest.fn();
const mockForwardConfig = jest.fn();
const mockBuildForwardIntent = jest.fn();
const mockDrainForwards = jest.fn();
const mockFindRecipient = jest.fn();
const mockCreateReply = jest.fn();
const mockUpdateRecipient = jest.fn();
const mockUpdateContact = jest.fn();
const mockTransaction = jest.fn();

jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    webhooks: { verify: mockVerify },
  })),
}));

jest.mock("@/lib/outreach-reply-email", () => ({
  retrieveOutreachReplyEmail: (...args: unknown[]) => mockRetrieveReply(...args),
}));

jest.mock("@/lib/outreach-reply-forwarding", () => ({
  outreachReplyForwardingConfig: () => mockForwardConfig(),
  buildOutreachReplyForwardIntent: (...args: unknown[]) => mockBuildForwardIntent(...args),
  drainOutreachReplyForwardIntents: (...args: unknown[]) => mockDrainForwards(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    outreachRecipient: {
      findUnique: (...args: unknown[]) => mockFindRecipient(...args),
      update: (...args: unknown[]) => mockUpdateRecipient(...args),
    },
    outreachReply: {
      create: (...args: unknown[]) => mockCreateReply(...args),
    },
    outreachContact: {
      update: (...args: unknown[]) => mockUpdateContact(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

import { POST } from "@/app/api/webhooks/resend-outreach-replies/route";
import { Prisma } from "@prisma/client";

const endpoint = "https://truefantix.ca/api/webhooks/resend-outreach-replies";
const validHeaders = Object.freeze({
  "svix-id": "evt_inbound_bounded",
  "svix-timestamp": "1789569000",
  "svix-signature": "v1,bounded-signature",
});
const validEvent = Object.freeze({
  type: "email.received",
  created_at: "2026-09-16T14:30:00.000Z",
  data: Object.freeze({
    email_id: "inbound-email-1",
    message_id: "message-1",
    from: "Fan <Fan@Example.COM>",
    to: Object.freeze(["Marc <reply+abc123@replies.truefantix.com>"]),
  }),
});

function encoded(value: string) {
  return new TextEncoder().encode(value);
}

function streamFrom(chunks: Uint8Array[], cancel = jest.fn(), remainOpen = false) {
  let index = 0;
  return {
    stream: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= chunks.length) {
          if (!remainOpen) controller.close();
          return remainOpen ? new Promise<void>(() => undefined) : undefined;
        }
        controller.enqueue(chunks[index++]);
      },
      cancel,
    }),
    cancel,
  };
}

function requestWithBody(
  body: ReadableStream<Uint8Array> | null,
  headers: Record<string, string> = validHeaders,
) {
  return {
    url: endpoint,
    method: "POST",
    headers: new Headers(headers),
    body,
  } as Request;
}

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}

describe("Resend outreach reply webhook ingress", () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    process.env.OUTREACH_RESEND_INBOUND_WEBHOOK_SECRET = "whsec_inbound_test";
    process.env.OUTREACH_RESEND_INBOUND_API_KEY = "re_inbound_test";
    delete process.env.OUTREACH_REPLY_FORWARD_TO;
    mockTransaction.mockResolvedValue([]);
    mockCreateReply.mockResolvedValue({});
    mockUpdateRecipient.mockResolvedValue({});
    mockUpdateContact.mockResolvedValue({});
    mockForwardConfig.mockReturnValue(null);
    mockBuildForwardIntent.mockReturnValue({});
    mockDrainForwards.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.OUTREACH_RESEND_INBOUND_WEBHOOK_SECRET;
    delete process.env.OUTREACH_RESEND_INBOUND_API_KEY;
    delete process.env.OUTREACH_REPLY_FORWARD_TO;
  });

  it("stays disabled before touching an attacker-controlled request stream", async () => {
    delete process.env.OUTREACH_RESEND_INBOUND_WEBHOOK_SECRET;
    const getReader = jest.fn();
    const cancel = jest.fn();
    const request = {
      url: endpoint,
      method: "POST",
      headers: new Headers(),
      body: { locked: false, getReader, cancel },
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(503);
    expectPrivate(response);
    expect(getReader).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("refuses and cancels an oversized declared body before verification", async () => {
    const cancel = jest.fn();
    const response = await POST(requestWithBody(
      new ReadableStream({ cancel }),
      { ...validHeaders, "content-length": String(256 * 1024 + 1) },
    ));

    expect(response.status).toBe(400);
    expectPrivate(response);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockFindRecipient).not.toHaveBeenCalled();
  });

  it("times out and cancels a stalled body without provider or database work", async () => {
    jest.useFakeTimers();
    const cancel = jest.fn();
    const responsePromise = POST(requestWithBody(new ReadableStream({
      pull: () => new Promise<void>(() => undefined),
      cancel,
    })));

    await jest.advanceTimersByTimeAsync(5_001);
    const response = await responsePromise;

    expect(response.status).toBe(400);
    expectPrivate(response);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockRetrieveReply).not.toHaveBeenCalled();
  });

  it("canonicalizes signature refusal without exposing verifier detail", async () => {
    mockVerify.mockImplementation(() => { throw new Error("provider verifier detail"); });
    const response = await POST(requestWithBody(streamFrom([encoded("signed")]).stream));

    expect(response.status).toBe(400);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Invalid webhook." });
    expect(mockFindRecipient).not.toHaveBeenCalled();
    expect(mockRetrieveReply).not.toHaveBeenCalled();
  });

  it.each([
    ["missing email id", { ...validEvent, data: { ...validEvent.data, email_id: "" } }],
    ["missing sender", { ...validEvent, data: { ...validEvent.data, from: "" } }],
    ["missing recipients", { ...validEvent, data: { ...validEvent.data, to: [] } }],
    ["too many recipients", { ...validEvent, data: { ...validEvent.data, to: Array(21).fill("reply+abc123@replies.truefantix.com") } }],
    ["invalid timestamp", { ...validEvent, created_at: "not-a-time" }],
    ["non-string message id", { ...validEvent, data: { ...validEvent.data, message_id: 7 } }],
  ])("rejects a signed malformed reply event: %s", async (_label, event) => {
    mockVerify.mockReturnValue(event);
    const response = await POST(requestWithBody(streamFrom([encoded("signed")]).stream));

    expect(response.status).toBe(400);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Invalid webhook." });
    expect(mockFindRecipient).not.toHaveBeenCalled();
    expect(mockRetrieveReply).not.toHaveBeenCalled();
  });

  it("ignores an unrelated signed event without database or provider work", async () => {
    mockVerify.mockReturnValue({ type: "email.delivered" });
    const response = await POST(requestWithBody(streamFrom([encoded("signed")]).stream));

    expect(response.status).toBe(200);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({ ok: true, ignored: true });
    expect(mockFindRecipient).not.toHaveBeenCalled();
    expect(mockRetrieveReply).not.toHaveBeenCalled();
  });

  it("returns canonical provider failure without starting database writes", async () => {
    mockVerify.mockReturnValue(validEvent);
    mockFindRecipient.mockResolvedValue({ id: "recipient-1", contactId: "contact-1" });
    mockRetrieveReply.mockRejectedValue(new Error("provider detail"));

    const response = await POST(requestWithBody(streamFrom([encoded("signed")]).stream));

    expect(response.status).toBe(502);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Could not retrieve received email.",
    });
    expect(mockCreateReply).not.toHaveBeenCalled();
    expect(mockUpdateRecipient).not.toHaveBeenCalled();
    expect(mockUpdateContact).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("persists only bounded normalized primitives from a valid signed reply", async () => {
    mockVerify.mockReturnValue(validEvent);
    mockFindRecipient.mockResolvedValue({ id: "recipient-1", contactId: "contact-1" });
    mockRetrieveReply.mockResolvedValue({
      subject: "A reply",
      text: "Plain body",
      html: "<p>HTML body</p>",
      attachmentCount: 0,
    });

    const response = await POST(requestWithBody(streamFrom([encoded("signed-payload")]).stream));

    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(mockVerify).toHaveBeenCalledWith({
      payload: "signed-payload",
      headers: {
        id: "evt_inbound_bounded",
        timestamp: "1789569000",
        signature: "v1,bounded-signature",
      },
      webhookSecret: "whsec_inbound_test",
    });
    expect(mockFindRecipient).toHaveBeenCalledWith({ where: { replyToken: "abc123" } });
    expect(mockRetrieveReply).toHaveBeenCalledWith("inbound-email-1", "re_inbound_test");
    expect(mockCreateReply).toHaveBeenCalledWith({ data: {
      providerEmailId: "inbound-email-1",
      providerMessageId: "message-1",
      recipientId: "recipient-1",
      contactId: "contact-1",
      fromEmail: "fan@example.com",
      toEmail: "reply+abc123@replies.truefantix.com",
      subject: "A reply",
      textBody: "Plain body",
      htmlBody: "<p>HTML body</p>",
      receivedAt: new Date("2026-09-16T14:30:00.000Z"),
      attachmentCount: 0,
    } });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockDrainForwards).not.toHaveBeenCalled();
  });

  it("atomically stages a bounded forward intent and drains only after reply commit", async () => {
    const config = {
      apiKey: "re_inbound_test",
      fromEmail: "marc@truefantix.com",
      toEmail: "owner@example.test",
    };
    const intent = {
      providerEmailId: "inbound-email-1",
      fromEmailSnapshot: config.fromEmail,
      toEmailSnapshot: config.toEmail,
      subjectSnapshot: "Outreach reply: A reply",
      textBodySnapshot: "bounded notice",
      attachmentCount: 0,
      idempotencyKey: "tft-outreach-reply-forward-v1-test",
    };
    mockVerify.mockReturnValue(validEvent);
    mockFindRecipient.mockResolvedValue({ id: "recipient-1", contactId: "contact-1" });
    mockRetrieveReply.mockResolvedValue({
      subject: "A reply",
      text: "Plain body",
      html: "<p>HTML body</p>",
      attachmentCount: 0,
    });
    mockForwardConfig.mockReturnValue(config);
    mockBuildForwardIntent.mockReturnValue(intent);

    const response = await POST(requestWithBody(streamFrom([encoded("signed-payload")]).stream));

    expect(response.status).toBe(200);
    expect(mockBuildForwardIntent).toHaveBeenCalledWith(expect.objectContaining({
      providerEmailId: "inbound-email-1",
      fromEmail: "fan@example.com",
      textBody: "Plain body",
    }), config);
    expect(mockCreateReply).toHaveBeenCalledWith({ data: expect.objectContaining({
      forwardIntent: { create: intent },
    }) });
    expect(mockTransaction.mock.invocationCallOrder[0])
      .toBeLessThan(mockDrainForwards.mock.invocationCallOrder[0]);
    expect(mockDrainForwards).toHaveBeenCalledWith({
      providerEmailId: "inbound-email-1",
      limit: 1,
    });
  });

  it("lets a duplicate webhook recover the already committed forward intent", async () => {
    mockVerify.mockReturnValue(validEvent);
    mockFindRecipient.mockResolvedValue({ id: "recipient-1", contactId: "contact-1" });
    mockRetrieveReply.mockResolvedValue({
      subject: "A reply",
      text: "Plain body",
      html: null,
      attachmentCount: 0,
    });
    mockForwardConfig.mockReturnValue({
      apiKey: "re_inbound_test",
      fromEmail: "marc@truefantix.com",
      toEmail: "owner@example.test",
    });
    mockTransaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      "synthetic duplicate",
      { code: "P2002", clientVersion: "synthetic" },
    ));

    const response = await POST(requestWithBody(streamFrom([encoded("signed-payload")]).stream));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: true });
    expect(mockDrainForwards).toHaveBeenCalledWith({
      providerEmailId: "inbound-email-1",
      limit: 1,
    });
  });
});
