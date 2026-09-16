const MAX_WEBHOOK_BYTES = 256 * 1024;
const WEBHOOK_READ_TIMEOUT_MS = 5_000;
const MAX_SVIX_ID_LENGTH = 256;
const MAX_SVIX_TIMESTAMP_LENGTH = 64;
const MAX_SVIX_SIGNATURE_LENGTH = 2_048;
const SVIX_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class InvalidOutreachWebhookIngressError extends Error {}

function nonBlockingCancel(cancel: () => Promise<unknown> | unknown) {
  try {
    void Promise.resolve(cancel()).catch(() => undefined);
  } catch {
    // Cleanup must never replace the already determined ingress outcome.
  }
}

export function cancelUnlockedWebhookBody(body: ReadableStream<Uint8Array> | null) {
  if (body && !body.locked) nonBlockingCancel(() => body.cancel());
}

function boundedRequiredHeader(headers: Headers, name: string, maxLength: number) {
  const value = headers.get(name);
  if (!value || value.length > maxLength) {
    throw new InvalidOutreachWebhookIngressError();
  }
  return value;
}

export function verifiedOutreachWebhookHeaders(req: Request) {
  const id = boundedRequiredHeader(req.headers, "svix-id", MAX_SVIX_ID_LENGTH);
  if (!SVIX_ID_PATTERN.test(id)) throw new InvalidOutreachWebhookIngressError();
  return Object.freeze({
    id,
    timestamp: boundedRequiredHeader(
      req.headers,
      "svix-timestamp",
      MAX_SVIX_TIMESTAMP_LENGTH,
    ),
    signature: boundedRequiredHeader(
      req.headers,
      "svix-signature",
      MAX_SVIX_SIGNATURE_LENGTH,
    ),
  });
}

export async function boundedOutreachWebhookText(req: Request) {
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(contentLength) || contentLength.length > 12) {
      cancelUnlockedWebhookBody(req.body);
      throw new InvalidOutreachWebhookIngressError();
    }
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_WEBHOOK_BYTES) {
      cancelUnlockedWebhookBody(req.body);
      throw new InvalidOutreachWebhookIngressError();
    }
  }

  if (!req.body) return "";
  const reader = req.body.getReader();
  let cancelStarted = false;
  const cancel = () => {
    if (cancelStarted) return;
    cancelStarted = true;
    nonBlockingCancel(() => reader.cancel());
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      cancel();
      reject(new InvalidOutreachWebhookIngressError());
    }, WEBHOOK_READ_TIMEOUT_MS);
  });

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await Promise.race([reader.read(), deadline]);
      } catch {
        cancel();
        throw new InvalidOutreachWebhookIngressError();
      }
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) {
        cancel();
        throw new InvalidOutreachWebhookIngressError();
      }
      total += chunk.value.byteLength;
      if (total > MAX_WEBHOOK_BYTES) {
        cancel();
        throw new InvalidOutreachWebhookIngressError();
      }
      chunks.push(chunk.value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      cancel();
      throw new InvalidOutreachWebhookIngressError();
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
