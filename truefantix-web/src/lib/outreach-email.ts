function clean(value: string | undefined) { return value?.trim().replace(/^['"]|['"]$/g, ""); }
const RESEND_RESPONSE_MAX_BYTES = 65_536;
const RESEND_RESPONSE_TIMEOUT_MS = 15_000;

type OutreachProviderOptions = Readonly<{
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}>;

class OutreachProviderBoundaryError extends Error {
  constructor(readonly code:
    | "RESEND_HTTP_4XX"
    | "RESEND_HTTP_NON_4XX"
    | "RESEND_PROVIDER_TIMEOUT"
    | "RESEND_PROVIDER_RESPONSE_INVALID"
    | "RESEND_TRANSPORT_UNCERTAIN"
  ) {
    super(code);
    this.name = "OutreachProviderBoundaryError";
  }
}

function providerTimeout(value: number | undefined) {
  if (value === undefined) return RESEND_RESPONSE_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0 || value > 60_000) {
    throw new Error("Outreach provider timeout is invalid.");
  }
  return value;
}

function isJsonContentType(value: string | null) {
  if (!value) return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function boundedResendJson(
  init: RequestInit,
  options: OutreachProviderOptions,
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = providerTimeout(options.timeoutMs);
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let readerCancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelActiveResponse = () => {
    if (!controller.signal.aborted) controller.abort();
    if (reader && !readerCancelled) {
      readerCancelled = true;
      void reader.cancel().catch(() => undefined);
    }
  };
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      cancelActiveResponse();
      reject(new OutreachProviderBoundaryError("RESEND_PROVIDER_TIMEOUT"));
    }, timeoutMs);
  });
  const operation = (async () => {
    let response: Response;
    try {
      response = await fetchImpl("https://api.resend.com/emails", {
        ...init,
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new OutreachProviderBoundaryError("RESEND_TRANSPORT_UNCERTAIN");
    }

    reader = response.body?.getReader() ?? null;
    if (!response.ok) {
      cancelActiveResponse();
      throw new OutreachProviderBoundaryError(
        response.status >= 400 && response.status < 500
          ? "RESEND_HTTP_4XX"
          : "RESEND_HTTP_NON_4XX",
      );
    }
    if (!reader || !isJsonContentType(response.headers.get("content-type"))) {
      cancelActiveResponse();
      throw new OutreachProviderBoundaryError("RESEND_PROVIDER_RESPONSE_INVALID");
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > RESEND_RESPONSE_MAX_BYTES) {
      cancelActiveResponse();
      throw new OutreachProviderBoundaryError("RESEND_PROVIDER_RESPONSE_INVALID");
    }

    const decoder = new TextDecoder("utf-8", { fatal: true });
    let raw = "";
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > RESEND_RESPONSE_MAX_BYTES) {
          throw new OutreachProviderBoundaryError("RESEND_PROVIDER_RESPONSE_INVALID");
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new OutreachProviderBoundaryError("RESEND_PROVIDER_RESPONSE_INVALID");
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      cancelActiveResponse();
      if (error instanceof OutreachProviderBoundaryError) throw error;
      throw new OutreachProviderBoundaryError("RESEND_PROVIDER_RESPONSE_INVALID");
    }
  })();

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function outreachSenderEmail() { return (clean(process.env.OUTREACH_FROM_EMAIL) || "marc@truefantix.com").toLowerCase(); }
export function outreachSender() { return `Marc at TrueFanTix <${outreachSenderEmail()}>`; }
export function outreachProviderConfigured() { return Boolean(clean(process.env.OUTREACH_RESEND_API_KEY)); }
export function outreachReplyDomain() { return clean(process.env.OUTREACH_REPLY_DOMAIN) || "replies.truefantix.com"; }
export function outreachReplyAddress(token: string) { return `reply+${token}@${outreachReplyDomain()}`; }
export function outreachReplyCaptureConfigured() { return Boolean(clean(process.env.OUTREACH_RESEND_INBOUND_API_KEY) && clean(process.env.OUTREACH_RESEND_INBOUND_WEBHOOK_SECRET) && clean(process.env.OUTREACH_REPLY_FORWARD_TO)); }

export type OutreachEmailResult = { provider: "RESEND"; messageId: string };
export class OutreachEmailRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutreachEmailRejectedError";
  }
}

export class OutreachEmailOutcomeUncertainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutreachEmailOutcomeUncertainError";
  }
}

export async function sendOutreachEmail(input: { to:string; subject:string; text:string; html?:string; unsubscribeUrl:string; replyTo?:string; idempotencyKey?:string }, options: OutreachProviderOptions = {}): Promise<OutreachEmailResult> {
  const resendKey=clean(process.env.OUTREACH_RESEND_API_KEY); const from=outreachSenderEmail();
  const headers={ "List-Unsubscribe": `<${input.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  if(resendKey){
    let data: Record<string, unknown>;
    try {
      data = await boundedResendJson({method:"POST",headers:{Authorization:`Bearer ${resendKey}`,"Content-Type":"application/json",...(input.idempotencyKey?{"Idempotency-Key":input.idempotencyKey}:{})},body:JSON.stringify({from:outreachSender(),to:[input.to],reply_to:input.replyTo||from,subject:input.subject,text:input.text,...(input.html?{html:input.html}:{}),headers,...(input.idempotencyKey?{tags:[{name:"truefantix_outreach_attempt",value:input.idempotencyKey}]}:{})})}, options);
    } catch (error) {
      if (error instanceof OutreachProviderBoundaryError) {
        if (error.code === "RESEND_HTTP_4XX") {
          throw new OutreachEmailRejectedError(error.code);
        }
        throw new OutreachEmailOutcomeUncertainError(error.code);
      }
      throw error;
    }
    const messageId=typeof data.id === "string" ? data.id.trim() : "";
    if(!messageId || messageId.length > 512) throw new OutreachEmailOutcomeUncertainError("RESEND_ACCEPTANCE_IDENTITY_INVALID");
    return {provider:"RESEND",messageId};
  }
  throw new OutreachEmailRejectedError("The TrueFanTix outreach email provider is not configured.");
}
