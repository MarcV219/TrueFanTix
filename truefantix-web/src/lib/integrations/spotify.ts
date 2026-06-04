import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { searchProviderCatalog, type ProviderCatalogSuggestion } from "@/lib/catalog/provider-catalog";

const SPOTIFY_PROVIDER = "spotify";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const API_BASE = "https://api.spotify.com/v1";
const SCOPES = ["user-follow-read", "user-top-read"];

export type SpotifyArtistImportCandidate = {
  spotifyId: string;
  name: string;
  popularity?: number;
  source: "followed" | "top";
  spotifyUrl?: string;
  imageUrl?: string;
  match: ProviderCatalogSuggestion | null;
};

function cleanSecret(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, "");
}

function requiredEnv(name: string) {
  const value = cleanSecret(process.env[name]);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function appOrigin() {
  const configured = process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return new URL(configured).origin;
  return "http://localhost:3000";
}

export function spotifyRedirectUri() {
  return cleanSecret(process.env.SPOTIFY_REDIRECT_URI) || `${appOrigin()}/api/integrations/spotify/callback`;
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

function decrypt(value: string) {
  const [ivRaw, tagRaw, ciphertextRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !ciphertextRaw) throw new Error("Invalid encrypted token.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
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

async function refreshSpotifyToken(account: {
  id: string;
  refreshTokenEncrypted: string | null;
}) {
  if (!account.refreshTokenEncrypted) throw new Error("Spotify refresh token is missing.");
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", decrypt(account.refreshTokenEncrypted));
  const data = await tokenRequest(body);
  const expiresAt = typeof data.expires_in === "number" ? new Date(Date.now() + data.expires_in * 1000) : null;
  await prisma.connectedAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEncrypted: encrypt(data.access_token),
      refreshTokenEncrypted: data.refresh_token ? encrypt(data.refresh_token) : undefined,
      tokenType: data.token_type ?? "Bearer",
      scope: data.scope ?? undefined,
      expiresAt,
    },
  });
  return data.access_token as string;
}

export async function getSpotifyAccessToken(userId: string) {
  const account = await prisma.connectedAccount.findUnique({
    where: { userId_provider: { userId, provider: SPOTIFY_PROVIDER } },
    select: {
      id: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      expiresAt: true,
    },
  });
  if (!account) return null;
  if (account.expiresAt && account.expiresAt.getTime() < Date.now() + 60_000) {
    return refreshSpotifyToken(account);
  }
  return decrypt(account.accessTokenEncrypted);
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

export async function storeSpotifyConnection({
  userId,
  token,
}: {
  userId: string;
  token: any;
}) {
  const accessToken = token.access_token as string;
  const me: any = await spotifyApi(accessToken, "/me");
  const expiresAt = typeof token.expires_in === "number" ? new Date(Date.now() + token.expires_in * 1000) : null;

  return prisma.connectedAccount.upsert({
    where: { userId_provider: { userId, provider: SPOTIFY_PROVIDER } },
    create: {
      userId,
      provider: SPOTIFY_PROVIDER,
      providerAccountId: String(me.id),
      accessTokenEncrypted: encrypt(accessToken),
      refreshTokenEncrypted: token.refresh_token ? encrypt(token.refresh_token) : null,
      tokenType: token.token_type ?? "Bearer",
      scope: token.scope ?? SCOPES.join(" "),
      expiresAt,
      displayName: me.display_name ?? null,
      email: me.email ?? null,
    },
    update: {
      providerAccountId: String(me.id),
      accessTokenEncrypted: encrypt(accessToken),
      refreshTokenEncrypted: token.refresh_token ? encrypt(token.refresh_token) : undefined,
      tokenType: token.token_type ?? "Bearer",
      scope: token.scope ?? SCOPES.join(" "),
      expiresAt,
      displayName: me.display_name ?? null,
      email: me.email ?? null,
    },
    select: { id: true, displayName: true, email: true },
  });
}

function artistFromSpotify(item: any, source: "followed" | "top") {
  const image = Array.isArray(item.images) ? item.images[0]?.url : undefined;
  return {
    spotifyId: String(item.id),
    name: String(item.name || "").trim(),
    popularity: typeof item.popularity === "number" ? item.popularity : undefined,
    source,
    spotifyUrl: item.external_urls?.spotify,
    imageUrl: image,
  };
}

async function fetchFollowedArtists(accessToken: string) {
  const artists: ReturnType<typeof artistFromSpotify>[] = [];
  let after: string | null = null;
  for (let page = 0; page < 4; page++) {
    const params = new URLSearchParams({ type: "artist", limit: "50" });
    if (after) params.set("after", after);
    const data: any = await spotifyApi(accessToken, `/me/following?${params.toString()}`);
    const items = Array.isArray(data?.artists?.items) ? data.artists.items : [];
    artists.push(...items.map((item: any) => artistFromSpotify(item, "followed")));
    after = data?.artists?.cursors?.after ?? null;
    if (!after || items.length === 0) break;
  }
  return artists;
}

async function fetchTopArtists(accessToken: string) {
  const artists: ReturnType<typeof artistFromSpotify>[] = [];
  for (const timeRange of ["short_term", "medium_term", "long_term"]) {
    const params = new URLSearchParams({ time_range: timeRange, limit: "50" });
    const data: any = await spotifyApi(accessToken, `/me/top/artists?${params.toString()}`);
    const items = Array.isArray(data?.items) ? data.items : [];
    artists.push(...items.map((item: any) => artistFromSpotify(item, "top")));
  }
  return artists;
}

function normalizedName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function matchArtist(name: string) {
  const suggestions = await searchProviderCatalog({ query: name, type: "ARTIST", limit: 8 });
  const normalized = normalizedName(name);
  return (
    suggestions.find((suggestion) => normalizedName(suggestion.canonicalName || suggestion.label) === normalized) ??
    suggestions[0] ??
    null
  );
}

export async function getSpotifyImportCandidates(userId: string) {
  const accessToken = await getSpotifyAccessToken(userId);
  if (!accessToken) return { connected: false as const, artists: [] };

  const [followed, top] = await Promise.all([
    fetchFollowedArtists(accessToken).catch(() => []),
    fetchTopArtists(accessToken).catch(() => []),
  ]);

  const byId = new Map<string, ReturnType<typeof artistFromSpotify>>();
  for (const artist of [...followed, ...top]) {
    if (!artist.spotifyId || !artist.name) continue;
    const existing = byId.get(artist.spotifyId);
    if (!existing || existing.source !== "followed") byId.set(artist.spotifyId, artist);
  }

  const artists = Array.from(byId.values())
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0) || a.name.localeCompare(b.name))
    .slice(0, 120);

  const candidates: SpotifyArtistImportCandidate[] = [];
  for (const artist of artists) {
    candidates.push({ ...artist, match: await matchArtist(artist.name) });
  }

  return { connected: true as const, artists: candidates };
}
