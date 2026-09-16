/** @jest-environment node */
import {
  OutreachReplyProviderError,
  retrieveOutreachReplyEmail,
} from "@/lib/outreach-reply-email";

const validEmail = Object.freeze({
  object: "email",
  id: "inbound-email-1",
  subject: "A reply",
  text: "Plain body",
  html: "<p>HTML body</p>",
  attachments: Object.freeze([]),
});

function jsonResponse(value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function expectProviderFailure(promise: Promise<unknown>) {
  return expect(promise).rejects.toBeInstanceOf(OutreachReplyProviderError);
}

describe("bounded Resend received-email retrieval", () => {
  afterEach(() => jest.useRealTimers());

  it("uses the fixed origin, refuses redirects, and returns bounded primitives", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({
      ...validEmail,
      subject: null,
      text: null,
      html: null,
      attachments: [{ id: "attachment-1" }],
    }));

    const result = await retrieveOutreachReplyEmail(
      "inbound-email-1",
      "re_test_key",
      { fetchImpl },
    );

    expect(result).toEqual({
      subject: null,
      text: null,
      html: null,
      attachmentCount: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails/receiving/inbound-email-1?html_format=cid");
    expect(init).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: {
        Authorization: "Bearer re_test_key",
        Accept: "application/json",
      },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["non-object response", []],
    ["wrong object kind", { ...validEmail, object: "message" }],
    ["mismatched returned id", { ...validEmail, id: "inbound-email-2" }],
    ["overlong subject", { ...validEmail, subject: "s".repeat(1_001) }],
    ["overlong text", { ...validEmail, text: "t".repeat(100_001) }],
    ["overlong html", { ...validEmail, html: "h".repeat(250_001) }],
    ["missing attachments", { ...validEmail, attachments: undefined }],
    ["too many attachments", { ...validEmail, attachments: Array(101).fill({}) }],
    ["non-object attachment", { ...validEmail, attachments: ["attachment"] }],
  ])("rejects a structurally invalid provider response: %s", async (_label, value) => {
    await expectProviderFailure(retrieveOutreachReplyEmail(
      "inbound-email-1",
      "re_test_key",
      { fetchImpl: jest.fn().mockResolvedValue(jsonResponse(value)) },
    ));
  });

  it("rejects a mismatched media type and cancels the response body", async () => {
    const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel,
    });
    await expectProviderFailure(retrieveOutreachReplyEmail(
      "inbound-email-1",
      "re_test_key",
      { fetchImpl: jest.fn().mockResolvedValue(new Response(body, {
        status: 200,
        headers: { "content-type": "text/plain" },
      })) },
    ));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["malformed UTF-8", new Uint8Array([0xc3, 0x28])],
    ["malformed JSON", new TextEncoder().encode("{not-json")],
  ])("rejects %s", async (_label, bytes) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    await expectProviderFailure(retrieveOutreachReplyEmail(
      "inbound-email-1",
      "re_test_key",
      { fetchImpl: jest.fn().mockResolvedValue(new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      })) },
    ));
  });

  it("rejects an oversized declared response before reading and cancels it", async () => {
    const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel,
    });
    await expectProviderFailure(retrieveOutreachReplyEmail(
      "inbound-email-1",
      "re_test_key",
      { fetchImpl: jest.fn().mockResolvedValue(new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(512 * 1024 + 1),
        },
      })) },
    ));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized streamed response and cancels it once", async () => {
    const cancel = jest.fn();
    let index = 0;
    const chunks = [new Uint8Array(512 * 1024), new Uint8Array([1])];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(chunks[index++]);
          return;
        }
        return new Promise<void>(() => undefined);
      },
      cancel,
    });
    await expectProviderFailure(retrieveOutreachReplyEmail(
      "inbound-email-1",
      "re_test_key",
      { fetchImpl: jest.fn().mockResolvedValue(new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      })) },
    ));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("applies one deadline to a stalled fetch and aborts it", async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = jest.fn((_url: URL | RequestInfo, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    });
    const outcome = retrieveOutreachReplyEmail(
      "inbound-email-1",
      "re_test_key",
      { fetchImpl, timeoutMs: 100 },
    );
    const assertion = expectProviderFailure(outcome);

    await jest.advanceTimersByTimeAsync(101);
    await assertion;
    expect(signal).toBeDefined();
    expect((signal as unknown as AbortSignal).aborted).toBe(true);
  });

  it("applies the same deadline to a stalled body and cancels once", async () => {
    jest.useFakeTimers();
    const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel,
    });
    const outcome = retrieveOutreachReplyEmail(
      "inbound-email-1",
      "re_test_key",
      {
        fetchImpl: jest.fn().mockResolvedValue(new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        })),
        timeoutMs: 100,
      },
    );
    const assertion = expectProviderFailure(outcome);

    await jest.advanceTimersByTimeAsync(101);
    await assertion;
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
