/** @jest-environment node */
const mockVerify = jest.fn();
const mockRecordOutreachDeliveryEvent = jest.fn();
const mockSettleOutreachCampaign = jest.fn();

jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    webhooks: { verify: mockVerify },
  })),
}));
jest.mock("@/lib/outreach-delivery-event", () => ({
  recordOutreachDeliveryEvent: (...args: unknown[]) => mockRecordOutreachDeliveryEvent(...args),
}));
jest.mock("@/lib/outreach-send", () => ({
  settleOutreachCampaign: (...args: unknown[]) => mockSettleOutreachCampaign(...args),
}));

import { contactUpdateForDeliveryEvent, POST } from "@/app/api/webhooks/resend-outreach/route";

const endpoint = "https://truefantix.ca/api/webhooks/resend-outreach";
const validHeaders = Object.freeze({
  "svix-id": "evt_bounded",
  "svix-timestamp": "1789569000",
  "svix-signature": "v1,bounded-signature",
});
const validEvent = Object.freeze({
  type: "email.delivered",
  created_at: "2026-09-16T14:30:00.000Z",
  data: Object.freeze({
    email_id: "provider-message-1",
    to: Object.freeze(["  Fan@Example.COM  "]),
    tags: Object.freeze({ truefantix_outreach_attempt: "b73e2e3f-4f34-4e17-9a4e-b1683b1596a9" }),
  }),
});

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

function streamFrom(chunks: Uint8Array[], cancel = jest.fn(), remainOpen = false) {
  let index = 0;
  return {
    stream: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= chunks.length) {
          if (!remainOpen) controller.close();
          return remainOpen ? new Promise<void>(() => undefined) : undefined;
        }
        else controller.enqueue(chunks[index++]);
      },
      cancel,
    }),
    cancel,
  };
}

function encoded(value: string) {
  return new TextEncoder().encode(value);
}

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}

describe("Resend outreach webhook security", () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    process.env.OUTREACH_RESEND_WEBHOOK_SECRET = "whsec_test_secret_that_is_long_enough";
    mockRecordOutreachDeliveryEvent.mockResolvedValue({ status: "APPLIED", campaignId: null });
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.OUTREACH_RESEND_WEBHOOK_SECRET;
  });

  it("stays disabled before touching an attacker-controlled request stream", async () => {
    delete process.env.OUTREACH_RESEND_WEBHOOK_SECRET;
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

  it("rejects an oversized declared body and cancels it before verification", async () => {
    const cancel = jest.fn();
    const response = await POST(requestWithBody(
      new ReadableStream({ cancel }),
      { ...validHeaders, "content-length": String(256 * 1024 + 1) },
    ));

    expect(response.status).toBe(400);
    expectPrivate(response);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockRecordOutreachDeliveryEvent).not.toHaveBeenCalled();
  });

  it("bounds streamed bytes and cancels once before verification", async () => {
    const { stream, cancel } = streamFrom([
      new Uint8Array(256 * 1024),
      new Uint8Array([1]),
    ], jest.fn(), true);
    const response = await POST(requestWithBody(stream));

    expect(response.status).toBe(400);
    expectPrivate(response);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("times out a stalled body and cancels once", async () => {
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
  });

  it("rejects malformed UTF-8 canonically before verification", async () => {
    const { stream } = streamFrom([new Uint8Array([0xc3, 0x28])]);
    const response = await POST(requestWithBody(stream));

    expect(response.status).toBe(400);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Invalid webhook." });
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("turns a body read error into the same canonical refusal", async () => {
    const response = await POST(requestWithBody(new ReadableStream({
      pull(controller) { controller.error(new Error("attacker supplied detail")); },
    })));

    expect(response.status).toBe(400);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Invalid webhook." });
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it.each([
    ["svix-id", "x".repeat(257)],
    ["svix-timestamp", "1".repeat(65)],
    ["svix-signature", "x".repeat(2_049)],
  ])("refuses an overlong %s before verification", async (name, value) => {
    const response = await POST(requestWithBody(
      streamFrom([encoded("{}")]).stream,
      { ...validHeaders, [name]: value },
    ));

    expect(response.status).toBe(400);
    expectPrivate(response);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockRecordOutreachDeliveryEvent).not.toHaveBeenCalled();
  });

  it("rejects events without a valid Resend signature", async () => {
    mockVerify.mockImplementation(() => { throw new Error("provider verifier detail"); });
    const response = await POST(requestWithBody(streamFrom([encoded("{}")]).stream));

    expect(response.status).toBe(400);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Invalid webhook." });
    expect(mockRecordOutreachDeliveryEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["missing provider message id", { ...validEvent, data: { ...validEvent.data, email_id: "" } }],
    ["invalid recipient", { ...validEvent, data: { ...validEvent.data, to: ["not-an-email"] } }],
    ["missing recipient", { ...validEvent, data: { ...validEvent.data, to: [] } }],
    ["invalid provider time", { ...validEvent, created_at: "not-a-time" }],
    ["non-object tags", { ...validEvent, data: { ...validEvent.data, tags: [] } }],
    ["invalid attempt UUID", { ...validEvent, data: { ...validEvent.data, tags: { truefantix_outreach_attempt: "attempt-1" } } }],
    ["missing bounced detail", { ...validEvent, type: "email.bounced", data: { ...validEvent.data } }],
  ])("rejects a signed malformed tracked event: %s", async (_label, event) => {
    mockVerify.mockReturnValue(event);
    const response = await POST(requestWithBody(streamFrom([encoded("signed")]).stream));

    expect(response.status).toBe(400);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Invalid webhook." });
    expect(mockRecordOutreachDeliveryEvent).not.toHaveBeenCalled();
    expect(mockSettleOutreachCampaign).not.toHaveBeenCalled();
  });

  it("passes only exact bounded normalized primitives from a valid signed event", async () => {
    mockVerify.mockReturnValue(validEvent);
    const response = await POST(requestWithBody(streamFrom([encoded("signed-payload")]).stream));

    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(mockVerify).toHaveBeenCalledWith({
      payload: "signed-payload",
      headers: {
        id: "evt_bounded",
        timestamp: "1789569000",
        signature: "v1,bounded-signature",
      },
      webhookSecret: "whsec_test_secret_that_is_long_enough",
    });
    expect(mockRecordOutreachDeliveryEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordOutreachDeliveryEvent).toHaveBeenCalledWith({
      svixId: "evt_bounded",
      type: "email.delivered",
      providerMessageId: "provider-message-1",
      deliveryAttemptId: "b73e2e3f-4f34-4e17-9a4e-b1683b1596a9",
      normalizedEmail: "fan@example.com",
      occurredAt: new Date("2026-09-16T14:30:00.000Z"),
      detail: null,
      nextStatus: "DELIVERED",
      suppressionReason: null,
      contactUpdate: null,
    });
  });

  it("ignores a bounded signed event outside the tracked set without persistence", async () => {
    mockVerify.mockReturnValue({ type: "email.opened" });
    const response = await POST(requestWithBody(streamFrom([encoded("signed")]).stream));

    expect(response.status).toBe(200);
    expectPrivate(response);
    await expect(response.json()).resolves.toEqual({ ok: true, ignored: true });
    expect(mockRecordOutreachDeliveryEvent).not.toHaveBeenCalled();
  });
});

describe("Resend outreach delivery state", () => {
  it("moves a bounced recipient's contact to BOUNCED and clears follow-up", () => {
    expect(contactUpdateForDeliveryEvent("email.bounced")).toEqual({
      engagementStage: "BOUNCED",
      followUpAt: null,
    });
  });

  it("does not change the contact relationship for ordinary delivery events", () => {
    expect(contactUpdateForDeliveryEvent("email.delivered")).toBeNull();
  });
});
