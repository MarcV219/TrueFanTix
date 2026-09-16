import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type SpotifyDb = Pick<Prisma.TransactionClient, "connectedAccount">;

const SPOTIFY_PROVIDER = "spotify";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const API_BASE = "https://api.spotify.com/v1";
const SCOPES = ["user-follow-read", "user-top-read"];
export const SPOTIFY_STAGING_ORIGIN = "https://truefantix-staging-preview.vercel.app";
export const SPOTIFY_PRODUCTION_ORIGIN = "https://www.truefantix.com";
export const SPOTIFY_TEST_ORIGIN = "https://spotify.test.invalid";
const SPOTIFY_CALLBACK_PATH = "/api/integrations/spotify/callback";

export type SpotifyConnectionAuthorization = {
  userId: string;
  connectedAccountId: string | null;
  providerAccountId: string | null;
  connectionVersion: string | null;
};

export type SpotifyConnectionEvidence = {
  providerAccountId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string;
  expiresAt: Date | null;
  displayName: string | null;
  email: string | null;
};

function cleanSecret(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, "");
}

function requiredEnv(name: string) {
  const value = cleanSecret(process.env[name]);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function exactHttpsOrigin(value: string) {
  const trimmed = value.trim().replace(/\/$/, "");
  const parsed = new URL(trimmed);
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.origin !== trimmed
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("Invalid Spotify application origin.");
  }
  return parsed.origin;
}

export function canonicalSpotifyConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const origins = [env.NEXT_PUBLIC_APP_URL, env.APP_ORIGIN]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(exactHttpsOrigin);
  if (origins.length === 0 || origins.some((origin) => origin !== origins[0])) {
    throw new Error("Spotify requires one matching configured application origin.");
  }

  for (const identity of [env.PRIMARY_TICKETING_ENVIRONMENT_ID, env.PRIMARY_TICKETING_DEPLOYMENT_ID]) {
    if (identity && identity !== "isolated-preview" && identity !== "isolated-test") {
      throw new Error("Spotify requires a recognized deployment identity.");
    }
  }
  const isolatedPreview = env.PRIMARY_TICKETING_ENVIRONMENT_ID === "isolated-preview"
    || env.PRIMARY_TICKETING_DEPLOYMENT_ID === "isolated-preview"
    || env.VERCEL_ENV === "preview";
  const isolatedTest = env.PRIMARY_TICKETING_ENVIRONMENT_ID === "isolated-test"
    || env.PRIMARY_TICKETING_DEPLOYMENT_ID === "isolated-test"
    || env.NODE_ENV === "test";
  const production = env.VERCEL_ENV === "production";
  if ([isolatedPreview, isolatedTest, production].filter(Boolean).length !== 1) {
    throw new Error("Spotify deployment identity is ambiguous.");
  }
  const expectedOrigin = isolatedPreview
    ? SPOTIFY_STAGING_ORIGIN
    : isolatedTest
      ? SPOTIFY_TEST_ORIGIN
      : production
        ? SPOTIFY_PRODUCTION_ORIGIN
        : null;
  if (!expectedOrigin || origins[0] !== expectedOrigin) {
    throw new Error("Spotify origin does not match a recognized deployment identity.");
  }

  const configuredRedirect = cleanSecret(env.SPOTIFY_REDIRECT_URI);
  const redirect = new URL(configuredRedirect || `${expectedOrigin}${SPOTIFY_CALLBACK_PATH}`);
  if (
    redirect.protocol !== "https:"
    || redirect.username
    || redirect.password
    || redirect.origin !== expectedOrigin
    || redirect.pathname !== SPOTIFY_CALLBACK_PATH
    || redirect.search
    || redirect.hash
  ) {
    throw new Error("Invalid Spotify callback URI.");
  }

  return { origin: expectedOrigin, redirectUri: redirect.toString() };
}

export function spotifyRedirectUri() {
  return canonicalSpotifyConfiguration().redirectUri;
}

export function spotifyAccountRedirectUrl(status: string) {
  const target = new URL("/account/notifications", canonicalSpotifyConfiguration().origin);
  target.searchParams.set("spotify", status);
  return target;
}

export function spotifyConfigured() {
  return Boolean(cleanSecret(process.env.SPOTIFY_CLIENT_ID) && cleanSecret(process.env.SPOTIFY_CLIENT_SECRET));
}

export function spotifyAuthorizeUrl(state: string) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", requiredEnv("SPOTIFY_CLIENT_ID"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", spotifyRedirectUri());
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("show_dialog", "false");
  return url.toString();
}

function encryptionKey() {
  const secret = cleanSecret(process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY) || cleanSecret(process.env.SESSION_SECRET);
  if (!secret || secret.length < 32) throw new Error("SPOTIFY_TOKEN_ENCRYPTION_KEY or SESSION_SECRET must be at least 32 chars.");
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function basicAuthHeader() {
  const clientId = requiredEnv("SPOTIFY_CLIENT_ID");
  const clientSecret = requiredEnv("SPOTIFY_CLIENT_SECRET");
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function tokenRequest(body: URLSearchParams) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error_description || data?.error || `Spotify token request failed (${res.status}).`);
  }
  return data;
}

export async function exchangeSpotifyCode(code: string) {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", spotifyRedirectUri());
  return tokenRequest(body);
}

export async function hasSpotifyConnection(userId: string, db: SpotifyDb = prisma) {
  const account = await db.connectedAccount.findUnique({
    where: { userId_provider: { userId, provider: SPOTIFY_PROVIDER } },
    select: { id: true },
  });
  return Boolean(account);
}

export async function disconnectSpotify(userId: string, db: SpotifyDb = prisma) {
  await db.connectedAccount.deleteMany({
    where: { userId, provider: SPOTIFY_PROVIDER },
  });
}

async function spotifyApi<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || `Spotify API request failed (${res.status}).`);
  return data as T;
}

function boundedProviderText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function boundedProviderSecret(value: unknown, maxLength: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) return null;
  return value;
}

type SpotifyConnectionVersionSource = {
  id: string;
  providerAccountId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  expiresAt: Date | null;
  updatedAt: Date;
};

function spotifyConnectionVersion(connection: SpotifyConnectionVersionSource) {
  return crypto.createHash("sha256").update(JSON.stringify({
    id: connection.id,
    providerAccountId: connection.providerAccountId,
    accessTokenEncrypted: connection.accessTokenEncrypted,
    refreshTokenEncrypted: connection.refreshTokenEncrypted,
    expiresAt: connection.expiresAt?.toISOString() ?? null,
    updatedAt: connection.updatedAt.toISOString(),
  })).digest("hex");
}

export async function snapshotSpotifyConnectionAuthorization(
  userId: string,
  db: SpotifyDb,
): Promise<SpotifyConnectionAuthorization> {
  const current = await db.connectedAccount.findUnique({
    where: { userId_provider: { userId, provider: SPOTIFY_PROVIDER } },
    select: {
      id: true,
      providerAccountId: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      expiresAt: true,
      updatedAt: true,
      currentRefreshCommandId: true,
    },
  });
  return {
    userId,
    connectedAccountId: current?.id ?? null,
    providerAccountId: current?.providerAccountId ?? null,
    connectionVersion: current ? spotifyConnectionVersion(current) : null,
  };
}

export async function getSpotifyConnectionEvidence(token: unknown): Promise<SpotifyConnectionEvidence> {
  if (!token || typeof token !== "object") throw new Error("Spotify returned an invalid token response.");
  const value = token as Record<string, unknown>;
  const accessToken = boundedProviderSecret(value.access_token, 16_384);
  if (!accessToken) throw new Error("Spotify returned an invalid access token.");

  const me: unknown = await spotifyApi(accessToken, "/me");
  if (!me || typeof me !== "object") throw new Error("Spotify returned an invalid account response.");
  const account = me as Record<string, unknown>;
  const providerAccountId = boundedProviderText(account.id, 512);
  if (!providerAccountId) throw new Error("Spotify returned an invalid account identity.");

  const expiresIn = typeof value.expires_in === "number" && Number.isFinite(value.expires_in)
    ? value.expires_in
    : null;
  const expiresAt = expiresIn !== null && expiresIn >= 0 && expiresIn <= 31_536_000
    ? new Date(Date.now() + expiresIn * 1000)
    : null;

  return {
    providerAccountId,
    accessToken,
    refreshToken: boundedProviderSecret(value.refresh_token, 16_384),
    tokenType: boundedProviderText(value.token_type, 128) ?? "Bearer",
    scope: boundedProviderText(value.scope, 2_048) ?? SCOPES.join(" "),
    expiresAt,
    displayName: boundedProviderText(account.display_name, 1_024),
    email: boundedProviderText(account.email, 1_024),
  };
}

export async function storeSpotifyConnection({
  authorization,
  evidence,
  db = prisma,
}: {
  authorization: SpotifyConnectionAuthorization;
  evidence: SpotifyConnectionEvidence;
  db?: SpotifyDb;
}) {
  const current = await db.connectedAccount.findUnique({
    where: { userId_provider: { userId: authorization.userId, provider: SPOTIFY_PROVIDER } },
    select: {
      id: true,
      providerAccountId: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      expiresAt: true,
      updatedAt: true,
      currentRefreshCommandId: true,
    },
  });
  const bindingMatches = authorization.connectedAccountId === null
    ? current === null && authorization.providerAccountId === null && authorization.connectionVersion === null
    : current?.id === authorization.connectedAccountId
      && current.providerAccountId === authorization.providerAccountId
      && authorization.connectionVersion !== null
      && spotifyConnectionVersion(current) === authorization.connectionVersion;
  if (!bindingMatches) throw new Error("SPOTIFY_CONNECTION_CHANGED");

  const data = {
    providerAccountId: evidence.providerAccountId,
    accessTokenEncrypted: encrypt(evidence.accessToken),
    refreshTokenEncrypted: evidence.refreshToken ? encrypt(evidence.refreshToken) : undefined,
    tokenType: evidence.tokenType,
    scope: evidence.scope,
    expiresAt: evidence.expiresAt,
    displayName: evidence.displayName,
    email: evidence.email,
  };

  if (!current) {
    return db.connectedAccount.create({
      data: {
      userId: authorization.userId,
      provider: SPOTIFY_PROVIDER,
        ...data,
        refreshTokenEncrypted: data.refreshTokenEncrypted ?? null,
      },
      select: { id: true, displayName: true, email: true },
    });
  }

  if (current.currentRefreshCommandId) {
    const deleted = await db.connectedAccount.deleteMany({
      where: {
        id: current.id,
        userId: authorization.userId,
        provider: SPOTIFY_PROVIDER,
        providerAccountId: current.providerAccountId,
        accessTokenEncrypted: current.accessTokenEncrypted,
        refreshTokenEncrypted: current.refreshTokenEncrypted,
        expiresAt: current.expiresAt,
        updatedAt: current.updatedAt,
        currentRefreshCommandId: current.currentRefreshCommandId,
      },
    });
    if (deleted.count !== 1) throw new Error("SPOTIFY_CONNECTION_CHANGED");
    return db.connectedAccount.create({
      data: {
        userId: authorization.userId,
        provider: SPOTIFY_PROVIDER,
        ...data,
        refreshTokenEncrypted: data.refreshTokenEncrypted ?? null,
      },
      select: { id: true, displayName: true, email: true },
    });
  }

  const updated = await db.connectedAccount.updateMany({
    where: {
      id: current.id,
      userId: authorization.userId,
      provider: SPOTIFY_PROVIDER,
      providerAccountId: current.providerAccountId,
      accessTokenEncrypted: current.accessTokenEncrypted,
      refreshTokenEncrypted: current.refreshTokenEncrypted,
      expiresAt: current.expiresAt,
      updatedAt: current.updatedAt,
    },
    data,
  });
  if (updated.count !== 1) throw new Error("SPOTIFY_CONNECTION_CHANGED");

  return db.connectedAccount.findUniqueOrThrow({
    where: { id: current.id },
    select: { id: true, displayName: true, email: true },
  });
}
