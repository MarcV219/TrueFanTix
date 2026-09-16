import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ManagedAccountSpotifyOperationError,
} from "@/lib/integrations/ordinary-spotify-user";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

const SPOTIFY_PROVIDER = "spotify";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const MAX_PROVIDER_BODY_BYTES = 65_536;

type RootDatabase = typeof prisma;
type Transaction = Prisma.TransactionClient;

type StagedRefresh = {
  userId: string;
  commandId: string;
  attemptId: string;
  commandStatus: "PENDING" | "ATTEMPTING" | "SUCCEEDED" | "RECONNECT_REQUIRED";
  connectionId: string;
  providerAccountId: string;
  sourceVersionDigest: string;
};

type ClaimedRefresh = StagedRefresh & {
  refreshTokenEncrypted: string | null;
};

type ValidRefreshResult = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string | null;
  expiresAt: Date;
  providerHttpStatus: number;
};

export type SpotifyRefreshCommandResult =
  | { status: "NO_CONNECTION" }
  | { status: "IN_PROGRESS"; commandId: string }
  | { status: "RECONNECT_REQUIRED"; commandId: string }
  | { status: "SUCCEEDED"; commandId: string; accessToken?: string };

type RefreshOptions = {
  db?: RootDatabase;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  attemptIdFactory?: () => string;
  providerTimeoutMs?: number;
  testHooks?: {
    afterStageCommitted?: (command: Readonly<StagedRefresh>) => Promise<void> | void;
    afterClaimCommitted?: (command: Readonly<ClaimedRefresh>) => Promise<void> | void;
  };
};

class SpotifyRefreshSourceChangedError extends Error {}

export type SpotifyRefreshAccessChangedCode = "NOT_AUTHENTICATED" | "BANNED" | "NOT_VERIFIED";

export class SpotifyRefreshAccessChangedError extends Error {
  constructor(readonly code: SpotifyRefreshAccessChangedCode) {
    super(code);
  }
}

function cleanSecret(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, "");
}

function encryptionKey(env: NodeJS.ProcessEnv) {
  const secret = cleanSecret(env.SPOTIFY_TOKEN_ENCRYPTION_KEY) || cleanSecret(env.SESSION_SECRET);
  if (!secret || secret.length < 32) throw new Error("SPOTIFY_REFRESH_INPUT_UNAVAILABLE");
  return crypto.createHash("sha256").update(secret).digest();
}

function decrypt(value: string, env: NodeJS.ProcessEnv) {
  const [ivRaw, tagRaw, ciphertextRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !ciphertextRaw) throw new Error("SPOTIFY_REFRESH_INPUT_UNAVAILABLE");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(env), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  if (!plaintext || plaintext.length > 16_384) throw new Error("SPOTIFY_REFRESH_INPUT_UNAVAILABLE");
  return plaintext;
}

function encrypt(value: string, env: NodeJS.ProcessEnv) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function providerAuthorization(env: NodeJS.ProcessEnv) {
  const clientId = cleanSecret(env.SPOTIFY_CLIENT_ID);
  const clientSecret = cleanSecret(env.SPOTIFY_CLIENT_SECRET);
  if (!clientId || !clientSecret || clientId.length > 4_096 || clientSecret.length > 4_096) {
    throw new Error("SPOTIFY_REFRESH_INPUT_UNAVAILABLE");
  }
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function boundedSecret(value: unknown, maxLength: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) return null;
  return value;
}

function boundedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

async function lockUser(tx: Transaction, userId: string, requireOrdinary: boolean) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      phone: true,
      termsVersion: true,
      privacyVersion: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      isBanned: true,
    },
  });
  if (!user) throw new SpotifyRefreshAccessChangedError("NOT_AUTHENTICATED");
  if (requireOrdinary && isPrimaryStagingManagedUser(user)) {
    throw new ManagedAccountSpotifyOperationError();
  }
  if (requireOrdinary && user.isBanned) {
    throw new SpotifyRefreshAccessChangedError("BANNED");
  }
  if (requireOrdinary && (!user.emailVerifiedAt || !user.phoneVerifiedAt)) {
    throw new SpotifyRefreshAccessChangedError("NOT_VERIFIED");
  }
}

function retryablePreProviderConflict(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  if (["P2002", "P2034", "23505", "40001", "40P01"].includes(code)) return true;
  const message = String(error);
  return message.includes("40001") || message.includes("could not serialize access");
}

async function retryPreProvider<T>(operation: () => Promise<T>) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === 4 || !retryablePreProviderConflict(error)) throw error;
    }
  }
  throw new Error("SPOTIFY_PRE_PROVIDER_RETRY_EXHAUSTED");
}

async function lockConnectionForUser(tx: Transaction, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "ConnectedAccount"
    WHERE "userId" = ${userId} AND "provider" = ${SPOTIFY_PROVIDER}
    FOR UPDATE
  `;
  if (!rows[0]) return null;
  return tx.connectedAccount.findUnique({
    where: { id: rows[0].id },
    select: {
      id: true,
      userId: true,
      provider: true,
      providerAccountId: true,
      refreshTokenEncrypted: true,
      expiresAt: true,
      updatedAt: true,
    },
  });
}

async function lockConnectionById(tx: Transaction, connectionId: string) {
  await tx.$queryRaw`SELECT "id" FROM "ConnectedAccount" WHERE "id" = ${connectionId} FOR UPDATE`;
  return tx.connectedAccount.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      userId: true,
      provider: true,
      providerAccountId: true,
      refreshTokenEncrypted: true,
      expiresAt: true,
      updatedAt: true,
    },
  });
}

async function connectionDigest(tx: Transaction, connectionId: string) {
  const rows = await tx.$queryRaw<Array<{ digest: string }>>`
    SELECT spotify_connected_account_version_digest(account_row) AS digest
    FROM "ConnectedAccount" account_row
    WHERE account_row.id = ${connectionId}
  `;
  return rows[0]?.digest ?? null;
}

async function lockCommand(tx: Transaction, commandId: string) {
  await tx.$queryRaw`SELECT "id" FROM "SpotifyRefreshCommand" WHERE "id" = ${commandId} FOR UPDATE`;
  return tx.spotifyRefreshCommand.findUnique({ where: { id: commandId } });
}

async function stageRefresh(
  db: RootDatabase,
  userId: string,
  attemptIdFactory: () => string,
): Promise<StagedRefresh | null> {
  return db.$transaction(async (tx) => {
    await lockUser(tx, userId, true);
    const account = await lockConnectionForUser(tx, userId);
    if (!account) return null;
    const sourceVersionDigest = await connectionDigest(tx, account.id);
    if (!sourceVersionDigest) throw new SpotifyRefreshSourceChangedError();

    let command = await tx.spotifyRefreshCommand.findUnique({
      where: {
        connectionId_sourceVersionDigest: {
          connectionId: account.id,
          sourceVersionDigest,
        },
      },
    });
    if (command) command = await lockCommand(tx, command.id);
    if (!command) {
      command = await tx.spotifyRefreshCommand.create({
        data: {
          userId,
          connectionId: account.id,
          provider: SPOTIFY_PROVIDER,
          providerAccountId: account.providerAccountId,
          sourceVersionDigest,
          sourceExpiresAt: account.expiresAt,
          sourceUpdatedAt: account.updatedAt,
          attemptId: attemptIdFactory(),
        },
      });
    }
    if (
      command.userId !== userId
      || command.connectionId !== account.id
      || command.provider !== SPOTIFY_PROVIDER
      || command.providerAccountId !== account.providerAccountId
      || command.sourceVersionDigest !== sourceVersionDigest
    ) {
      throw new SpotifyRefreshSourceChangedError();
    }
    return {
      userId,
      commandId: command.id,
      attemptId: command.attemptId,
      commandStatus: command.status,
      connectionId: account.id,
      providerAccountId: account.providerAccountId,
      sourceVersionDigest,
    };
  }, { isolationLevel: "Serializable", timeout: 120_000 });
}

async function claimRefresh(
  db: RootDatabase,
  userId: string,
  staged: StagedRefresh,
  claimedAt: Date,
): Promise<ClaimedRefresh | StagedRefresh> {
  return db.$transaction(async (tx) => {
    await lockUser(tx, userId, true);
    const account = await lockConnectionById(tx, staged.connectionId);
    const command = await lockCommand(tx, staged.commandId);
    if (!command || command.userId !== userId || command.attemptId !== staged.attemptId) {
      throw new SpotifyRefreshSourceChangedError();
    }
    if (command.status !== "PENDING") {
      return { ...staged, commandStatus: command.status };
    }
    const digest = account ? await connectionDigest(tx, account.id) : null;
    if (
      !account
      || account.userId !== userId
      || account.provider !== SPOTIFY_PROVIDER
      || account.providerAccountId !== staged.providerAccountId
      || digest !== staged.sourceVersionDigest
    ) {
      throw new SpotifyRefreshSourceChangedError();
    }
    const claim = await tx.spotifyRefreshCommand.updateMany({
      where: { id: command.id, attemptId: command.attemptId, status: "PENDING" },
      data: { status: "ATTEMPTING", claimedAt },
    });
    if (claim.count !== 1) {
      const observed = await tx.spotifyRefreshCommand.findUniqueOrThrow({ where: { id: command.id } });
      return { ...staged, commandStatus: observed.status };
    }
    return {
      ...staged,
      commandStatus: "ATTEMPTING",
      refreshTokenEncrypted: account.refreshTokenEncrypted,
    };
  }, { isolationLevel: "Serializable", timeout: 120_000 });
}

async function recordTerminal(
  db: RootDatabase,
  staged: StagedRefresh,
  completedAt: Date,
  evidence: {
    providerContactStatus: "NOT_CONTACTED" | "CONTACTED" | "CONTACT_UNCERTAIN";
    providerHttpStatus?: number;
    resultExpiresAt?: Date;
    refreshTokenRotated?: boolean;
    failureCode:
      | "REFRESH_INPUT_UNAVAILABLE"
      | "PROVIDER_REJECTED"
      | "PROVIDER_INVALID_RESPONSE"
      | "PROVIDER_OUTCOME_UNCERTAIN"
      | "LOCAL_FINALIZATION_FAILED";
  },
) {
  return db.$transaction(async (tx) => {
    await lockUser(tx, staged.userId, false);
    await lockConnectionById(tx, staged.connectionId);
    const command = await lockCommand(tx, staged.commandId);
    if (!command || command.attemptId !== staged.attemptId || command.status !== "ATTEMPTING") {
      return command?.status ?? null;
    }
    const updated = await tx.spotifyRefreshCommand.update({
      where: { id: command.id },
      data: {
        status: "RECONNECT_REQUIRED",
        terminalAttemptId: command.attemptId,
        providerContactStatus: evidence.providerContactStatus,
        providerHttpStatus: evidence.providerHttpStatus,
        resultExpiresAt: evidence.resultExpiresAt,
        refreshTokenRotated: evidence.refreshTokenRotated,
        failureCode: evidence.failureCode,
        completedAt,
      },
    });
    return updated.status;
  }, { isolationLevel: "Serializable", timeout: 120_000 });
}

async function requestRefresh(
  sourceRefreshToken: string,
  authorization: string,
  fetchImpl: typeof fetch,
  now: () => Date,
  timeoutMs: number,
): Promise<
  | { kind: "success"; value: ValidRefreshResult }
  | { kind: "rejected"; status: number }
  | { kind: "invalid"; status: number }
  | { kind: "uncertain" }
> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: sourceRefreshToken });
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let response: Response;
  try {
    response = await Promise.race([
      fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: controller.signal,
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("SPOTIFY_PROVIDER_TIMEOUT"));
        }, timeoutMs);
      }),
    ]);
  } catch {
    return { kind: "uncertain" };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    return { kind: "uncertain" };
  }
  if (!response.ok) return { kind: "rejected", status: response.status };

  let raw: string;
  let bodyTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    raw = await Promise.race([
      response.text(),
      new Promise<never>((_resolve, reject) => {
        bodyTimeout = setTimeout(() => {
          controller.abort();
          reject(new Error("SPOTIFY_PROVIDER_BODY_TIMEOUT"));
        }, timeoutMs);
      }),
    ]);
  } catch {
    return { kind: "uncertain" };
  } finally {
    if (bodyTimeout) clearTimeout(bodyTimeout);
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_PROVIDER_BODY_BYTES) {
    return { kind: "invalid", status: response.status };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid", status: response.status };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "invalid", status: response.status };
  }
  const value = parsed as Record<string, unknown>;
  const accessToken = boundedSecret(value.access_token, 16_384);
  const tokenType = value.token_type === undefined
    ? "Bearer"
    : boundedText(value.token_type, 128);
  const scope = value.scope === undefined ? null : boundedText(value.scope, 2_048);
  const expiresIn = typeof value.expires_in === "number" && Number.isInteger(value.expires_in)
    && value.expires_in > 0 && value.expires_in <= 31_536_000
    ? value.expires_in
    : null;
  const refreshToken = value.refresh_token === undefined
    ? null
    : boundedSecret(value.refresh_token, 16_384);
  if (!accessToken || !tokenType || expiresIn === null || (value.scope !== undefined && !scope)
    || (value.refresh_token !== undefined && !refreshToken)) {
    return { kind: "invalid", status: response.status };
  }
  return {
    kind: "success",
    value: {
      accessToken,
      refreshToken,
      tokenType,
      scope,
      expiresAt: new Date(now().getTime() + expiresIn * 1_000),
      providerHttpStatus: response.status,
    },
  };
}

async function finalizeSuccess(
  db: RootDatabase,
  userId: string,
  staged: StagedRefresh,
  result: ValidRefreshResult,
  encrypted: { accessToken: string; refreshToken: string | null },
  completedAt: Date,
) {
  return db.$transaction(async (tx) => {
    await lockUser(tx, userId, true);
    const account = await lockConnectionById(tx, staged.connectionId);
    const command = await lockCommand(tx, staged.commandId);
    const digest = account ? await connectionDigest(tx, account.id) : null;
    if (
      !account
      || !command
      || command.status !== "ATTEMPTING"
      || command.attemptId !== staged.attemptId
      || account.userId !== userId
      || account.provider !== SPOTIFY_PROVIDER
      || account.providerAccountId !== staged.providerAccountId
      || digest !== staged.sourceVersionDigest
    ) {
      throw new SpotifyRefreshSourceChangedError();
    }
    await tx.connectedAccount.update({
      where: { id: account.id },
      data: {
        accessTokenEncrypted: encrypted.accessToken,
        refreshTokenEncrypted: encrypted.refreshToken ?? account.refreshTokenEncrypted,
        tokenType: result.tokenType,
        ...(result.scope === null ? {} : { scope: result.scope }),
        expiresAt: result.expiresAt,
        currentRefreshCommandId: command.id,
      },
    });
    const resultVersionDigest = await connectionDigest(tx, account.id);
    if (!resultVersionDigest) throw new SpotifyRefreshSourceChangedError();
    await tx.spotifyRefreshCommand.update({
      where: { id: command.id },
      data: {
        status: "SUCCEEDED",
        terminalAttemptId: command.attemptId,
        providerContactStatus: "CONTACTED",
        providerHttpStatus: result.providerHttpStatus,
        resultVersionDigest,
        resultExpiresAt: result.expiresAt,
        refreshTokenRotated: encrypted.refreshToken !== null,
        completedAt,
      },
    });
  }, { isolationLevel: "Serializable", timeout: 120_000 });
}

function replayResult(staged: StagedRefresh): SpotifyRefreshCommandResult | null {
  if (staged.commandStatus === "ATTEMPTING") {
    return { status: "IN_PROGRESS", commandId: staged.commandId };
  }
  if (staged.commandStatus === "RECONNECT_REQUIRED") {
    return { status: "RECONNECT_REQUIRED", commandId: staged.commandId };
  }
  if (staged.commandStatus === "SUCCEEDED") {
    return { status: "SUCCEEDED", commandId: staged.commandId };
  }
  return null;
}

export async function executeSpotifyRefreshCommand(
  userId: string,
  options: RefreshOptions = {},
): Promise<SpotifyRefreshCommandResult> {
  const db = options.db ?? prisma;
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const attemptIdFactory = options.attemptIdFactory
    ?? (() => `spotify-refresh-${crypto.randomUUID()}`);
  const providerTimeoutMs = options.providerTimeoutMs ?? 10_000;
  if (!Number.isInteger(providerTimeoutMs) || providerTimeoutMs < 1 || providerTimeoutMs > 120_000) {
    throw new Error("SPOTIFY_PROVIDER_TIMEOUT_INVALID");
  }

  const staged = await retryPreProvider(() => stageRefresh(db, userId, attemptIdFactory));
  if (!staged) return { status: "NO_CONNECTION" };
  const stagedReplay = replayResult(staged);
  if (stagedReplay) return stagedReplay;
  await options.testHooks?.afterStageCommitted?.(staged);

  let claimed: ClaimedRefresh | StagedRefresh;
  try {
    claimed = await retryPreProvider(() => claimRefresh(db, userId, staged, now()));
  } catch (error) {
    if (error instanceof SpotifyRefreshSourceChangedError) {
      return { status: "RECONNECT_REQUIRED", commandId: staged.commandId };
    }
    throw error;
  }
  const claimReplay = replayResult(claimed);
  if (claimReplay && !("refreshTokenEncrypted" in claimed)) return claimReplay;
  if (!("refreshTokenEncrypted" in claimed)) {
    return { status: "IN_PROGRESS", commandId: staged.commandId };
  }
  await options.testHooks?.afterClaimCommitted?.(claimed);

  let refreshToken: string;
  let authorization: string;
  try {
    if (!claimed.refreshTokenEncrypted) throw new Error("SPOTIFY_REFRESH_INPUT_UNAVAILABLE");
    refreshToken = decrypt(claimed.refreshTokenEncrypted, env);
    authorization = providerAuthorization(env);
  } catch {
    await recordTerminal(db, staged, now(), {
      providerContactStatus: "NOT_CONTACTED",
      failureCode: "REFRESH_INPUT_UNAVAILABLE",
    });
    return { status: "RECONNECT_REQUIRED", commandId: staged.commandId };
  }

  const provider = await requestRefresh(refreshToken, authorization, fetchImpl, now, providerTimeoutMs);
  if (provider.kind === "uncertain") {
    await recordTerminal(db, staged, now(), {
      providerContactStatus: "CONTACT_UNCERTAIN",
      failureCode: "PROVIDER_OUTCOME_UNCERTAIN",
    });
    return { status: "RECONNECT_REQUIRED", commandId: staged.commandId };
  }
  if (provider.kind === "rejected") {
    await recordTerminal(db, staged, now(), {
      providerContactStatus: "CONTACTED",
      providerHttpStatus: provider.status,
      failureCode: "PROVIDER_REJECTED",
    });
    return { status: "RECONNECT_REQUIRED", commandId: staged.commandId };
  }
  if (provider.kind === "invalid") {
    await recordTerminal(db, staged, now(), {
      providerContactStatus: "CONTACTED",
      providerHttpStatus: provider.status,
      failureCode: "PROVIDER_INVALID_RESPONSE",
    });
    return { status: "RECONNECT_REQUIRED", commandId: staged.commandId };
  }

  let encrypted: { accessToken: string; refreshToken: string | null };
  try {
    encrypted = {
      accessToken: encrypt(provider.value.accessToken, env),
      refreshToken: provider.value.refreshToken ? encrypt(provider.value.refreshToken, env) : null,
    };
    await finalizeSuccess(db, userId, staged, provider.value, encrypted, now());
  } catch {
    await recordTerminal(db, staged, now(), {
      providerContactStatus: "CONTACTED",
      providerHttpStatus: provider.value.providerHttpStatus,
      resultExpiresAt: provider.value.expiresAt,
      refreshTokenRotated: provider.value.refreshToken !== null,
      failureCode: "LOCAL_FINALIZATION_FAILED",
    });
    return { status: "RECONNECT_REQUIRED", commandId: staged.commandId };
  }
  return { status: "SUCCEEDED", commandId: staged.commandId, accessToken: provider.value.accessToken };
}
