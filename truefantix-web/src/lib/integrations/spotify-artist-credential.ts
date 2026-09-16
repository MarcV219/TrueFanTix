import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  executeSpotifyRefreshCommand,
  SpotifyRefreshAccessChangedError,
  SpotifyRefreshSourceChangedError,
  type SpotifyRefreshCommandResult,
} from "@/lib/integrations/spotify-refresh-command";
import {
  ManagedAccountSpotifyOperationError,
} from "@/lib/integrations/ordinary-spotify-user";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

const SPOTIFY_PROVIDER = "spotify" as const;
const EXPIRY_LEEWAY_MS = 60_000;
const MAX_CIPHERTEXT_LENGTH = 65_536;

type RootDatabase = typeof prisma;
type Transaction = Prisma.TransactionClient;

type CredentialSnapshot = Readonly<{
  userId: string;
  connectionId: string;
  provider: typeof SPOTIFY_PROVIDER;
  providerAccountId: string;
  accessTokenEncrypted: string | null;
  versionDigest: string;
  expiresAt: string | null;
  currentRefreshCommandId: string | null;
  refreshRequired: boolean;
}>;

export type SpotifyArtistReadCredential = Readonly<{
  userId: string;
  connectionId: string;
  provider: typeof SPOTIFY_PROVIDER;
  providerAccountId: string;
  accessToken: string;
  versionDigest: string;
  expiresAt: string;
  refreshCommandId: string | null;
}>;

export type SpotifyArtistCredentialResult =
  | Readonly<{ status: "NO_CONNECTION" }>
  | Readonly<{ status: "IN_PROGRESS"; commandId: string }>
  | Readonly<{ status: "RECONNECT_REQUIRED"; commandId?: string }>
  | Readonly<{ status: "READY"; credential: SpotifyArtistReadCredential }>;

type CredentialHooks = {
  afterInitialSnapshotCommitted?: (snapshot: CredentialSnapshot | null) => Promise<void> | void;
  afterRefreshCompleted?: (result: SpotifyRefreshCommandResult) => Promise<void> | void;
  afterRefreshedSnapshotCommitted?: (snapshot: CredentialSnapshot | null) => Promise<void> | void;
};

type CredentialOptions = {
  db?: RootDatabase;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  attemptIdFactory?: () => string;
  providerTimeoutMs?: number;
  refreshCommand?: typeof executeSpotifyRefreshCommand;
  hooks?: CredentialHooks;
};

function cleanSecret(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, "");
}

function encryptionKey(env: NodeJS.ProcessEnv) {
  const secret = cleanSecret(env.SPOTIFY_TOKEN_ENCRYPTION_KEY) || cleanSecret(env.SESSION_SECRET);
  if (!secret || secret.length < 32) throw new Error("SPOTIFY_ARTIST_CREDENTIAL_UNAVAILABLE");
  return crypto.createHash("sha256").update(secret).digest();
}

function decryptAccessToken(ciphertext: string, env: NodeJS.ProcessEnv) {
  if (!ciphertext || ciphertext.length > MAX_CIPHERTEXT_LENGTH) {
    throw new Error("SPOTIFY_ARTIST_CREDENTIAL_UNAVAILABLE");
  }
  const [ivRaw, tagRaw, ciphertextRaw] = ciphertext.split(".");
  if (!ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("SPOTIFY_ARTIST_CREDENTIAL_UNAVAILABLE");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(env),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  if (!plaintext || plaintext.length > 16_384) {
    throw new Error("SPOTIFY_ARTIST_CREDENTIAL_UNAVAILABLE");
  }
  return plaintext;
}

async function lockOrdinaryUser(tx: Transaction, userId: string) {
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
  if (isPrimaryStagingManagedUser(user)) throw new ManagedAccountSpotifyOperationError();
  if (user.isBanned) throw new SpotifyRefreshAccessChangedError("BANNED");
  if (!user.emailVerifiedAt || !user.phoneVerifiedAt) {
    throw new SpotifyRefreshAccessChangedError("NOT_VERIFIED");
  }
}

async function connectionDigest(tx: Transaction, connectionId: string) {
  const rows = await tx.$queryRaw<Array<{ digest: string }>>`
    SELECT spotify_connected_account_version_digest(account_row) AS digest
    FROM "ConnectedAccount" account_row
    WHERE account_row.id = ${connectionId}
  `;
  return rows[0]?.digest ?? null;
}

function requiresRefresh(expiresAt: Date | null, now: Date) {
  return !expiresAt || expiresAt.getTime() < now.getTime() + EXPIRY_LEEWAY_MS;
}

async function initialSnapshot(
  db: RootDatabase,
  userId: string,
  now: Date,
): Promise<CredentialSnapshot | null> {
  return db.$transaction(async (tx) => {
    await lockOrdinaryUser(tx, userId);
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "ConnectedAccount"
      WHERE "userId" = ${userId} AND "provider" = ${SPOTIFY_PROVIDER}
      FOR UPDATE
    `;
    if (!rows[0]) return null;
    const account = await tx.connectedAccount.findUnique({
      where: { id: rows[0].id },
      select: {
        id: true,
        userId: true,
        provider: true,
        providerAccountId: true,
        accessTokenEncrypted: true,
        expiresAt: true,
        currentRefreshCommandId: true,
      },
    });
    if (!account || account.userId !== userId || account.provider !== SPOTIFY_PROVIDER) return null;
    const versionDigest = await connectionDigest(tx, account.id);
    if (!versionDigest) throw new Error("SPOTIFY_ARTIST_CREDENTIAL_UNAVAILABLE");
    const refreshRequired = requiresRefresh(account.expiresAt, now);
    return Object.freeze({
      userId,
      connectionId: account.id,
      provider: SPOTIFY_PROVIDER,
      providerAccountId: account.providerAccountId,
      accessTokenEncrypted: refreshRequired ? null : account.accessTokenEncrypted,
      versionDigest,
      expiresAt: account.expiresAt?.toISOString() ?? null,
      currentRefreshCommandId: account.currentRefreshCommandId,
      refreshRequired,
    });
  }, { isolationLevel: "Serializable", timeout: 120_000 });
}

async function refreshedSnapshot(
  db: RootDatabase,
  source: CredentialSnapshot,
  commandId: string,
  now: Date,
): Promise<CredentialSnapshot | null> {
  return db.$transaction(async (tx) => {
    await lockOrdinaryUser(tx, source.userId);
    await tx.$queryRaw`SELECT "id" FROM "ConnectedAccount" WHERE "id" = ${source.connectionId} FOR UPDATE`;
    const account = await tx.connectedAccount.findUnique({
      where: { id: source.connectionId },
      select: {
        id: true,
        userId: true,
        provider: true,
        providerAccountId: true,
        accessTokenEncrypted: true,
        expiresAt: true,
        currentRefreshCommandId: true,
      },
    });
    await tx.$queryRaw`SELECT "id" FROM "SpotifyRefreshCommand" WHERE "id" = ${commandId} FOR UPDATE`;
    const command = await tx.spotifyRefreshCommand.findUnique({ where: { id: commandId } });
    if (!account || !command) return null;
    const versionDigest = await connectionDigest(tx, account.id);
    const bindingMatches = account.userId === source.userId
      && account.provider === SPOTIFY_PROVIDER
      && account.providerAccountId === source.providerAccountId
      && account.currentRefreshCommandId === commandId
      && command.userId === source.userId
      && command.connectionId === source.connectionId
      && command.provider === SPOTIFY_PROVIDER
      && command.providerAccountId === source.providerAccountId
      && command.sourceVersionDigest === source.versionDigest
      && command.status === "SUCCEEDED"
      && command.resultVersionDigest !== null
      && command.resultVersionDigest === versionDigest
      && command.resultExpiresAt?.toISOString() === account.expiresAt?.toISOString();
    if (!bindingMatches || !versionDigest || requiresRefresh(account.expiresAt, now)) return null;
    return Object.freeze({
      userId: source.userId,
      connectionId: account.id,
      provider: SPOTIFY_PROVIDER,
      providerAccountId: account.providerAccountId,
      accessTokenEncrypted: account.accessTokenEncrypted,
      versionDigest,
      expiresAt: account.expiresAt?.toISOString() ?? null,
      currentRefreshCommandId: commandId,
      refreshRequired: false,
    });
  }, { isolationLevel: "Serializable", timeout: 120_000 });
}

function readyCredential(snapshot: CredentialSnapshot, env: NodeJS.ProcessEnv): SpotifyArtistCredentialResult {
  if (
    snapshot.refreshRequired
    || !snapshot.accessTokenEncrypted
    || !snapshot.expiresAt
  ) {
    return Object.freeze({ status: "RECONNECT_REQUIRED" });
  }
  try {
    const accessToken = decryptAccessToken(snapshot.accessTokenEncrypted, env);
    return Object.freeze({
      status: "READY",
      credential: Object.freeze({
        userId: snapshot.userId,
        connectionId: snapshot.connectionId,
        provider: snapshot.provider,
        providerAccountId: snapshot.providerAccountId,
        accessToken,
        versionDigest: snapshot.versionDigest,
        expiresAt: snapshot.expiresAt,
        refreshCommandId: snapshot.currentRefreshCommandId,
      }),
    });
  } catch {
    return Object.freeze({ status: "RECONNECT_REQUIRED" });
  }
}

export async function acquireSpotifyArtistReadCredential(
  userId: string,
  options: CredentialOptions = {},
): Promise<SpotifyArtistCredentialResult> {
  const db = options.db ?? prisma;
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const source = await initialSnapshot(db, userId, now());
  await options.hooks?.afterInitialSnapshotCommitted?.(source);
  if (!source) return Object.freeze({ status: "NO_CONNECTION" });
  if (!source.refreshRequired) return readyCredential(source, env);

  const refreshCommand = options.refreshCommand ?? executeSpotifyRefreshCommand;
  let refreshed: SpotifyRefreshCommandResult;
  try {
    refreshed = await refreshCommand(userId, {
      db,
      env,
      fetchImpl: options.fetchImpl,
      now,
      attemptIdFactory: options.attemptIdFactory,
      providerTimeoutMs: options.providerTimeoutMs,
      expectedSource: {
        connectionId: source.connectionId,
        providerAccountId: source.providerAccountId,
        sourceVersionDigest: source.versionDigest,
      },
    });
  } catch (error) {
    if (error instanceof SpotifyRefreshSourceChangedError) {
      return Object.freeze({ status: "RECONNECT_REQUIRED" });
    }
    throw error;
  }
  await options.hooks?.afterRefreshCompleted?.(refreshed);
  if (refreshed.status === "NO_CONNECTION") return Object.freeze({ status: "NO_CONNECTION" });
  if (refreshed.status === "IN_PROGRESS") {
    return Object.freeze({ status: "IN_PROGRESS", commandId: refreshed.commandId });
  }
  if (refreshed.status === "RECONNECT_REQUIRED") {
    return Object.freeze({ status: "RECONNECT_REQUIRED", commandId: refreshed.commandId });
  }

  const committed = await refreshedSnapshot(db, source, refreshed.commandId, now());
  await options.hooks?.afterRefreshedSnapshotCommitted?.(committed);
  if (!committed) {
    return Object.freeze({ status: "RECONNECT_REQUIRED", commandId: refreshed.commandId });
  }
  const result = readyCredential(committed, env);
  if (result.status === "RECONNECT_REQUIRED") {
    return Object.freeze({ status: "RECONNECT_REQUIRED", commandId: refreshed.commandId });
  }
  return result;
}
