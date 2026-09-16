/** @jest-environment node */

import {
  buildOutreachReplyForwardIntent,
  outreachReplyForwardingConfig,
  OutreachReplyForwardRateLimitedError,
  OutreachReplyForwardRejectedError,
  OutreachReplyForwardUncertainError,
  sendOutreachReplyForward,
} from "@/lib/outreach-reply-forwarding";

const config = Object.freeze({
  apiKey: "re_synthetic",
  fromEmail: "marc@truefantix.com",
  toEmail: "owner@example.test",
});

const claimed = Object.freeze({
  id: "intent-1",
  claimToken: "claim-1",
  providerEmailId: "inbound-email-1",
  fromEmailSnapshot: config.fromEmail,
  toEmailSnapshot: config.toEmail,
  subjectSnapshot: "Outreach reply: Hello",
  textBodySnapshot: "Bounded reply notice",
  idempotencyKey: "tft-outreach-reply-forward-v1-synthetic",
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("outreach reply forward provider boundary", () => {
  afterEach(() => jest.useRealTimers());

  it("normalizes strict forwarding configuration", () => {
    expect(outreachReplyForwardingConfig({
      NODE_ENV: "test",
      OUTREACH_RESEND_INBOUND_API_KEY: " re_synthetic ",
      OUTREACH_REPLY_FORWARD_TO: "Owner <OWNER@Example.Test>",
      OUTREACH_FROM_EMAIL: "Marc <MARC@TrueFanTix.com>",
    } as NodeJS.ProcessEnv)).toEqual(config);
    expect(outreachReplyForwardingConfig({
      NODE_ENV: "test",
      OUTREACH_RESEND_INBOUND_API_KEY: "re_synthetic",
      OUTREACH_REPLY_FORWARD_TO: "bad\n@example.test",
    } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("builds a stable bounded text-only envelope with explicit fidelity limits", () => {
    const input = {
      providerEmailId: "inbound-email-1",
      fromEmail: "fan@example.test",
      subject: "Hello",
      textBody: null,
      htmlBody: "<p>HTML only</p>",
      attachmentCount: 2,
      receivedAt: new Date("2026-09-16T15:00:00.000Z"),
    };
    const first = buildOutreachReplyForwardIntent(input, config);
    const second = buildOutreachReplyForwardIntent(input, config);

    expect(first).toEqual(second);
    expect(first.idempotencyKey).toMatch(/^tft-outreach-reply-forward-v1-[a-f0-9]{64}$/);
    expect(first.idempotencyKey.length).toBeLessThanOrEqual(256);
    expect(first.textBodySnapshot).toContain("not a passthrough copy");
    expect(first.textBodySnapshot).toContain("attachments are not forwarded");
    expect(first.textBodySnapshot).toContain("captured HTML body is not forwarded");
  });

  it("uses the fixed endpoint, refusal semantics, and exact idempotency key", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ id: "provider-message-1" }));

    await expect(sendOutreachReplyForward(claimed, config, { fetchImpl }))
      .resolves.toEqual({ messageId: "provider-message-1" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: expect.objectContaining({
        Authorization: "Bearer re_synthetic",
        "Idempotency-Key": claimed.idempotencyKey,
        "User-Agent": "TrueFanTix/1.0",
      }),
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      from: config.fromEmail,
      to: [config.toEmail],
      subject: claimed.subjectSnapshot,
      text: claimed.textBodySnapshot,
    });
  });

  it.each([400, 401, 403, 422])(
    "classifies explicit HTTP %i refusal as terminal rejection",
    async (status) => {
      await expect(sendOutreachReplyForward(claimed, config, {
        fetchImpl: jest.fn().mockResolvedValue(new Response(null, { status })),
      })).rejects.toBeInstanceOf(OutreachReplyForwardRejectedError);
    },
  );

  it("classifies HTTP 429 as a bounded retry-safe refusal", async () => {
    await expect(sendOutreachReplyForward(claimed, config, {
      fetchImpl: jest.fn().mockResolvedValue(new Response(null, {
        status: 429,
        headers: { "retry-after": "120" },
      })),
    })).rejects.toMatchObject({
      name: "OutreachReplyForwardRateLimitedError",
      retryAfterMs: 120_000,
    });
    await expect(sendOutreachReplyForward(claimed, config, {
      fetchImpl: jest.fn().mockResolvedValue(new Response(null, {
        status: 429,
        headers: { "retry-after": "999999" },
      })),
    })).rejects.toBeInstanceOf(OutreachReplyForwardRateLimitedError);
  });

  it.each([409, 500, 503])(
    "classifies HTTP %i as ambiguous without exposing provider detail",
    async (status) => {
      await expect(sendOutreachReplyForward(claimed, config, {
        fetchImpl: jest.fn().mockResolvedValue(new Response("provider detail", { status })),
      })).rejects.toBeInstanceOf(OutreachReplyForwardUncertainError);
    },
  );

  it("classifies a network failure as ambiguous", async () => {
    await expect(sendOutreachReplyForward(claimed, config, {
      fetchImpl: jest.fn().mockRejectedValue(new Error("synthetic network failure")),
    })).rejects.toMatchObject({
      name: "OutreachReplyForwardUncertainError",
      code: "RESEND_FORWARD_TRANSPORT_UNCERTAIN",
    });
  });

  it("refuses an oversized provider acceptance body", async () => {
    await expect(sendOutreachReplyForward(claimed, config, {
      fetchImpl: jest.fn().mockResolvedValue(new Response(
        JSON.stringify({ id: "x".repeat(65 * 1024) }),
        { status: 200, headers: { "content-type": "application/json" } },
      )),
    })).rejects.toMatchObject({
      name: "OutreachReplyForwardUncertainError",
      code: "RESEND_FORWARD_ACCEPTANCE_INVALID",
    });
  });

  it.each([
    ["missing id", {}],
    ["empty id", { id: "" }],
    ["overlong id", { id: "x".repeat(513) }],
    ["non-object", []],
  ])("treats malformed accepted evidence as ambiguous: %s", async (_label, value) => {
    await expect(sendOutreachReplyForward(claimed, config, {
      fetchImpl: jest.fn().mockResolvedValue(jsonResponse(value)),
    })).rejects.toBeInstanceOf(OutreachReplyForwardUncertainError);
  });

  it("applies one deadline to a stalled provider request", async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    const result = sendOutreachReplyForward(claimed, config, {
      timeoutMs: 100,
      fetchImpl: jest.fn((_url: URL | RequestInfo, init?: RequestInit) => {
        signal = init?.signal as AbortSignal;
        return new Promise<Response>(() => undefined);
      }),
    });
    const assertion = expect(result).rejects.toBeInstanceOf(OutreachReplyForwardUncertainError);
    await jest.advanceTimersByTimeAsync(101);
    await assertion;
    expect(signal?.aborted).toBe(true);
  });
});
