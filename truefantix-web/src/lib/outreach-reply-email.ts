const RESEND_RECEIVED_EMAIL_MAX_BYTES = 512 * 1024;
const RESEND_RECEIVED_EMAIL_TIMEOUT_MS = 15_000;
const MAX_SUBJECT_LENGTH = 1_000;
const MAX_TEXT_LENGTH = 100_000;
const MAX_HTML_LENGTH = 250_000;
const MAX_ATTACHMENTS = 100;

type ReceivedEmailOptions = Readonly<{
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}>;

export type ReceivedOutreachReply = Readonly<{
  subject: string | null;
  text: string | null;
  html: string | null;
  attachmentCount: number;
}>;

export class OutreachReplyProviderError extends Error {
  constructor() {
    super("OUTREACH_REPLY_PROVIDER_INVALID");
    this.name = "OutreachReplyProviderError";
  }
}

function providerTimeout(value: number | undefined) {
  if (value === undefined) return RESEND_RECEIVED_EMAIL_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0 || value > 60_000) {
    throw new Error("Outreach reply provider timeout is invalid.");
  }
  return value;
}

function isJsonContentType(value: string | null) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableBoundedString(value: unknown, maxLength: number) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new OutreachReplyProviderError();
  }
  return value;
}

function validateReceivedEmail(
  value: unknown,
  expectedEmailId: string,
): ReceivedOutreachReply {
  if (!isRecord(value) || value.object !== "email" || value.id !== expectedEmailId) {
    throw new OutreachReplyProviderError();
  }
  if (!Array.isArray(value.attachments) || value.attachments.length > MAX_ATTACHMENTS) {
    throw new OutreachReplyProviderError();
  }
  if (!value.attachments.every(isRecord)) throw new OutreachReplyProviderError();
  return Object.freeze({
    subject: nullableBoundedString(value.subject, MAX_SUBJECT_LENGTH),
    text: nullableBoundedString(value.text, MAX_TEXT_LENGTH),
    html: nullableBoundedString(value.html, MAX_HTML_LENGTH),
    attachmentCount: value.attachments.length,
  });
}

function nonBlockingCancel(cancel: () => Promise<unknown> | unknown) {
  try {
    void Promise.resolve(cancel()).catch(() => undefined);
  } catch {
    // Cleanup must never replace the canonical provider outcome.
  }
}

export async function retrieveOutreachReplyEmail(
  emailId: string,
  apiKey: string,
  options: ReceivedEmailOptions = {},
): Promise<ReceivedOutreachReply> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = providerTimeout(options.timeoutMs);
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    if (!controller.signal.aborted) controller.abort();
    if (reader) nonBlockingCancel(() => reader?.cancel());
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      cancel();
      reject(new OutreachReplyProviderError());
    }, timeoutMs);
  });

  const operation = (async () => {
    let response: Response;
    try {
      response = await fetchImpl(
        `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}?html_format=cid`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
          redirect: "error",
          signal: controller.signal,
        },
      );
    } catch {
      throw new OutreachReplyProviderError();
    }

    reader = response.body?.getReader() ?? null;
    if (!reader) {
      cancel();
      throw new OutreachReplyProviderError();
    }
    if (!response.ok || !isJsonContentType(response.headers.get("content-type"))) {
      cancel();
      throw new OutreachReplyProviderError();
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      if (!/^(0|[1-9]\d*)$/.test(contentLength) || contentLength.length > 12) {
        cancel();
        throw new OutreachReplyProviderError();
      }
      const declaredLength = Number(contentLength);
      if (
        !Number.isSafeInteger(declaredLength)
        || declaredLength > RESEND_RECEIVED_EMAIL_MAX_BYTES
      ) {
        cancel();
        throw new OutreachReplyProviderError();
      }
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) throw new OutreachReplyProviderError();
        total += chunk.value.byteLength;
        if (total > RESEND_RECEIVED_EMAIL_MAX_BYTES) {
          throw new OutreachReplyProviderError();
        }
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return validateReceivedEmail(JSON.parse(raw) as unknown, emailId);
    } catch (error) {
      cancel();
      if (error instanceof OutreachReplyProviderError) throw error;
      throw new OutreachReplyProviderError();
    }
  })();

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
