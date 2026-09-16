import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  acquireSpotifyArtistReadCredential,
  isIssuedSpotifyArtistReadCredential,
  type SpotifyArtistCredentialResult,
  type SpotifyArtistReadCredential,
} from "@/lib/integrations/spotify-artist-credential";
import { SpotifyRefreshAccessChangedError } from "@/lib/integrations/spotify-refresh-command";
import { ManagedAccountSpotifyOperationError } from "@/lib/integrations/ordinary-spotify-user";
import { isPrimaryStagingManagedUser } from "@/lib/primary/staging-console";

const SPOTIFY_ORIGIN = "https://api.spotify.com";
const FOLLOWED_PATH = "/v1/me/following";
const TOP_PATH = "/v1/me/top/artists";
const TOP_RANGES = ["short_term", "medium_term", "long_term"] as const;
const MAX_FOLLOWED_PAGES = 4;
const MAX_ITEMS_PER_PAGE = 50;
const MAX_TOTAL_ITEMS = 350;
const MAX_BODY_BYTES = 256_000;
const MAX_TOTAL_BODY_BYTES = 1_024_000;
const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 256;
const MAX_URL_LENGTH = 2_048;
const EXPIRY_LEEWAY_MS = 60_000;

type RootDatabase = typeof prisma;
type Transaction = Prisma.TransactionClient;

type ArtistPrimitive = Readonly<{
  spotifyId: string;
  name: string;
  popularity: number | null;
  source: "followed" | "top";
  spotifyUrl: string | null;
  imageUrl: string | null;
}>;

export type SpotifyArtistCatalogMatch = Readonly<{
  type: "ARTIST";
  value: string;
  label: string;
  catalogEntityId: string;
  canonicalName: string;
  provider: string;
  providerId: string;
}>;

export type SpotifyArtistReadItem = ArtistPrimitive & Readonly<{
  match: SpotifyArtistCatalogMatch | null;
}>;

export type SpotifyArtistReadResult =
  | Readonly<{ status: Exclude<SpotifyArtistCredentialResult["status"], "READY"> }>
  | Readonly<{ status: "DRIFTED" }>
  | Readonly<{ status: "READY"; artists: readonly SpotifyArtistReadItem[] }>;

export type SpotifyArtistImportSelection = Readonly<{
  spotifyIds: readonly string[] | null;
  includeUnmatched: boolean;
}>;

export type SpotifyArtistImportResult =
  | Readonly<{ status: Exclude<SpotifyArtistCredentialResult["status"], "READY"> }>
  | Readonly<{ status: "DRIFTED" }>
  | Readonly<{
      status: "READY";
      imported: readonly Readonly<{
        id: string;
        type: string;
        value: string;
        status: string;
        catalogEntityId: string | null;
      }>[];
      requested: readonly Readonly<{
        id: string;
        requestedValue: string;
        status: string;
      }>[];
    }>;

type RawCatalogMatch = Readonly<Pick<
  SpotifyArtistCatalogMatch,
  "catalogEntityId" | "canonicalName" | "provider" | "providerId"
>>;

type CatalogMatcher = (
  artists: readonly Readonly<{ spotifyId: string; name: string }>[],
) => Promise<readonly (RawCatalogMatch | null)[]>;

type ArtistReadOptions = {
  db?: RootDatabase;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  providerTimeoutMs?: number;
  acquireCredential?: typeof acquireSpotifyArtistReadCredential;
  catalogMatcher?: CatalogMatcher;
};

function boundedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function boundedHttpsUrl(value: unknown) {
  const text = boundedText(value, MAX_URL_LENGTH);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseArtist(value: unknown, source: ArtistPrimitive["source"]): ArtistPrimitive {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SPOTIFY_ARTIST_INVALID");
  const row = value as Record<string, unknown>;
  const spotifyId = boundedText(row.id, MAX_ID_LENGTH);
  const name = boundedText(row.name, MAX_NAME_LENGTH);
  if (!spotifyId || !name) throw new Error("SPOTIFY_ARTIST_INVALID");
  const popularity = row.popularity === undefined
    ? null
    : typeof row.popularity === "number" && Number.isInteger(row.popularity)
      && row.popularity >= 0 && row.popularity <= 100 ? row.popularity : null;
  if (row.popularity !== undefined && popularity === null) throw new Error("SPOTIFY_ARTIST_INVALID");
  const external = row.external_urls;
  const spotifyUrl = external === undefined ? null
    : external && typeof external === "object" && !Array.isArray(external)
      ? boundedHttpsUrl((external as Record<string, unknown>).spotify) : null;
  if (external !== undefined && spotifyUrl === null) throw new Error("SPOTIFY_ARTIST_INVALID");
  let imageUrl: string | null = null;
  if (row.images !== undefined) {
    if (!Array.isArray(row.images)) throw new Error("SPOTIFY_ARTIST_INVALID");
    const first = row.images[0];
    if (first !== undefined) {
      imageUrl = first && typeof first === "object" && !Array.isArray(first)
        ? boundedHttpsUrl((first as Record<string, unknown>).url) : null;
      if (!imageUrl) throw new Error("SPOTIFY_ARTIST_INVALID");
    }
  }
  return Object.freeze({ spotifyId, name, popularity, source, spotifyUrl, imageUrl });
}

async function boundedJson(
  response: Response,
  controller: AbortController,
  budget: { remaining: number },
  registerReader: (reader: ReadableStreamDefaultReader<Uint8Array> | null) => void,
) {
  if (!response.ok) {
    controller.abort();
    await response.body?.cancel().catch(() => undefined);
    throw new Error("SPOTIFY_ARTIST_PROVIDER_FAILED");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SPOTIFY_ARTIST_PROVIDER_INVALID");
  registerReader(reader);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = "";
  let responseBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      responseBytes += chunk.value.byteLength;
      budget.remaining -= chunk.value.byteLength;
      if (responseBytes > MAX_BODY_BYTES || budget.remaining < 0) {
        controller.abort();
        await reader.cancel().catch(() => undefined);
        throw new Error("SPOTIFY_ARTIST_PROVIDER_INVALID");
      }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("SPOTIFY_ARTIST_PROVIDER_INVALID");
  } finally {
    registerReader(null);
  }
}

async function providerGet(
  credential: SpotifyArtistReadCredential,
  path: typeof FOLLOWED_PATH | typeof TOP_PATH,
  params: URLSearchParams,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  budget: { remaining: number },
) {
  const url = new URL(path, SPOTIFY_ORIGIN);
  url.search = params.toString();
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      reject(new Error("SPOTIFY_ARTIST_PROVIDER_TIMEOUT"));
    }, timeoutMs);
  });
  const operation = (async () => {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${credential.accessToken}` },
      cache: "no-store",
      signal: controller.signal,
    });
    return boundedJson(response, controller, budget, (activeReader) => {
      reader = activeReader;
    });
  })();
  try {
    return await Promise.race([operation, timeout]);
  } catch {
    throw new Error("SPOTIFY_ARTIST_PROVIDER_FAILED");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function exactNextUrl(value: unknown, expectedPath: string) {
  if (value === null) return null;
  const text = boundedText(value, MAX_URL_LENGTH);
  if (!text) throw new Error("SPOTIFY_ARTIST_PAGINATION_INVALID");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("SPOTIFY_ARTIST_PAGINATION_INVALID");
  }
  if (
    url.origin !== SPOTIFY_ORIGIN
    || url.pathname !== expectedPath
    || url.username
    || url.password
    || url.hash
  ) {
    throw new Error("SPOTIFY_ARTIST_PAGINATION_INVALID");
  }
  return url;
}

async function readFollowed(
  credential: SpotifyArtistReadCredential,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  budget: { remaining: number },
) {
  const result: ArtistPrimitive[] = [];
  const cursors = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < MAX_FOLLOWED_PAGES; page += 1) {
    const params = new URLSearchParams({ type: "artist", limit: String(MAX_ITEMS_PER_PAGE) });
    if (after) params.set("after", after);
    const body = await providerGet(credential, FOLLOWED_PATH, params, fetchImpl, timeoutMs, budget);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("SPOTIFY_ARTIST_PROVIDER_INVALID");
    const artists = (body as Record<string, unknown>).artists;
    if (!artists || typeof artists !== "object" || Array.isArray(artists)) throw new Error("SPOTIFY_ARTIST_PROVIDER_INVALID");
    const pageBody = artists as Record<string, unknown>;
    if (!Array.isArray(pageBody.items) || pageBody.items.length > MAX_ITEMS_PER_PAGE) {
      throw new Error("SPOTIFY_ARTIST_PROVIDER_INVALID");
    }
    const next = exactNextUrl(pageBody.next, FOLLOWED_PATH);
    const cursorBlock = pageBody.cursors;
    const nextCursor = cursorBlock && typeof cursorBlock === "object" && !Array.isArray(cursorBlock)
      ? (cursorBlock as Record<string, unknown>).after : null;
    if (next === null) {
      if (nextCursor !== null && nextCursor !== undefined && !boundedText(nextCursor, MAX_ID_LENGTH)) {
        throw new Error("SPOTIFY_ARTIST_PAGINATION_INVALID");
      }
      result.push(...pageBody.items.map((item) => parseArtist(item, "followed")));
      break;
    }
    const cursor = boundedText(nextCursor, MAX_ID_LENGTH);
    const queryEntries = [...next.searchParams.entries()];
    if (
      !cursor
      || cursors.has(cursor)
      || next.searchParams.get("after") !== cursor
      || next.searchParams.get("type") !== "artist"
      || next.searchParams.get("limit") !== String(MAX_ITEMS_PER_PAGE)
      || queryEntries.length !== 3
      || queryEntries.some(([key]) => !["after", "type", "limit"].includes(key))
    ) {
      throw new Error("SPOTIFY_ARTIST_PAGINATION_INVALID");
    }
    cursors.add(cursor);
    result.push(...pageBody.items.map((item) => parseArtist(item, "followed")));
    after = cursor;
    if (page === MAX_FOLLOWED_PAGES - 1) throw new Error("SPOTIFY_ARTIST_LIMIT_EXCEEDED");
  }
  return result;
}

async function readTop(
  credential: SpotifyArtistReadCredential,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  budget: { remaining: number },
) {
  const result: ArtistPrimitive[] = [];
  for (const timeRange of TOP_RANGES) {
    const params = new URLSearchParams({ time_range: timeRange, limit: String(MAX_ITEMS_PER_PAGE) });
    const body = await providerGet(credential, TOP_PATH, params, fetchImpl, timeoutMs, budget);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("SPOTIFY_ARTIST_PROVIDER_INVALID");
    const row = body as Record<string, unknown>;
    if (!Array.isArray(row.items) || row.items.length > MAX_ITEMS_PER_PAGE) {
      throw new Error("SPOTIFY_ARTIST_PROVIDER_INVALID");
    }
    if (row.next !== null && row.next !== undefined) {
      exactNextUrl(row.next, TOP_PATH);
      throw new Error("SPOTIFY_ARTIST_LIMIT_EXCEEDED");
    }
    result.push(...row.items.map((item) => parseArtist(item, "top")));
  }
  return result;
}

function deduplicateArtists(followed: readonly ArtistPrimitive[], top: readonly ArtistPrimitive[]) {
  if (followed.length + top.length > MAX_TOTAL_ITEMS) throw new Error("SPOTIFY_ARTIST_LIMIT_EXCEEDED");
  const result = new Map<string, ArtistPrimitive>();
  const followedIds = new Set<string>();
  const topIds = new Set<string>();
  for (const artist of followed) {
    if (followedIds.has(artist.spotifyId)) throw new Error("SPOTIFY_ARTIST_DUPLICATE");
    followedIds.add(artist.spotifyId);
    result.set(artist.spotifyId, artist);
  }
  for (const artist of top) {
    if (topIds.has(artist.spotifyId)) throw new Error("SPOTIFY_ARTIST_DUPLICATE");
    topIds.add(artist.spotifyId);
    if (!result.has(artist.spotifyId)) result.set(artist.spotifyId, artist);
  }
  return [...result.values()];
}

function validateMatch(value: unknown) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SPOTIFY_ARTIST_CATALOG_INVALID");
  }
  const row = value as Record<string, unknown>;
  const catalogEntityId = boundedText(row.catalogEntityId, MAX_ID_LENGTH);
  const canonicalName = boundedText(row.canonicalName, MAX_NAME_LENGTH);
  const provider = boundedText(row.provider, 64);
  const providerId = boundedText(row.providerId, MAX_ID_LENGTH);
  if (!catalogEntityId || !canonicalName || !provider || !providerId) {
    throw new Error("SPOTIFY_ARTIST_CATALOG_INVALID");
  }
  return Object.freeze({
    type: "ARTIST" as const,
    value: canonicalName,
    label: canonicalName,
    catalogEntityId,
    canonicalName,
    provider,
    providerId,
  });
}

async function defaultCatalogMatcher(
  db: RootDatabase,
  artists: readonly Readonly<{ spotifyId: string; name: string }>[],
) {
  const results: (RawCatalogMatch | null)[] = [];
  for (const artist of artists) {
    const matches = await db.catalogEntity.findMany({
      where: { type: "ARTIST", canonicalName: { equals: artist.name, mode: "insensitive" } },
      orderBy: [{ popularity: "desc" }, { id: "asc" }],
      take: 2,
      select: { id: true, canonicalName: true, provider: true, providerId: true },
    });
    if (matches.length > 1) throw new Error("SPOTIFY_ARTIST_CATALOG_AMBIGUOUS");
    results.push(matches[0] ? {
      catalogEntityId: matches[0].id,
      canonicalName: matches[0].canonicalName,
      provider: matches[0].provider,
      providerId: matches[0].providerId,
    } : null);
  }
  return results;
}

async function lockOrdinaryUser(tx: Transaction, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { email: true, phone: true, termsVersion: true, privacyVersion: true, role: true, emailVerifiedAt: true, phoneVerifiedAt: true, isBanned: true },
  });
  if (!user) throw new SpotifyRefreshAccessChangedError("NOT_AUTHENTICATED");
  if (isPrimaryStagingManagedUser(user)) throw new ManagedAccountSpotifyOperationError();
  if (user.role !== "USER") throw new SpotifyRefreshAccessChangedError("NOT_AUTHENTICATED");
  if (user.isBanned) throw new SpotifyRefreshAccessChangedError("BANNED");
  if (!user.emailVerifiedAt || !user.phoneVerifiedAt) throw new SpotifyRefreshAccessChangedError("NOT_VERIFIED");
  return user;
}

function isSerializationFailure(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

async function finalFence<T>(
  db: RootDatabase,
  credential: SpotifyArtistReadCredential,
  now: Date,
  work: (tx: Transaction) => Promise<T>,
) {
  return db.$transaction(async (tx) => {
    await lockOrdinaryUser(tx, credential.userId);
    await tx.$queryRaw`SELECT "id" FROM "ConnectedAccount" WHERE "id" = ${credential.connectionId} FOR UPDATE`;
    const account = await tx.connectedAccount.findUnique({
      where: { id: credential.connectionId },
      select: { id: true, userId: true, provider: true, providerAccountId: true, expiresAt: true, currentRefreshCommandId: true },
    });
    if (!account) return Object.freeze({ valid: false as const });
    const rows = await tx.$queryRaw<Array<{ digest: string }>>`
      SELECT spotify_connected_account_version_digest(account_row) AS digest
      FROM "ConnectedAccount" account_row WHERE account_row.id = ${credential.connectionId}
    `;
    const valid = account.userId === credential.userId
      && account.provider === "spotify"
      && account.providerAccountId === credential.providerAccountId
      && account.currentRefreshCommandId === credential.refreshCommandId
      && rows[0]?.digest === credential.versionDigest
      && account.expiresAt?.toISOString() === credential.expiresAt
      && account.expiresAt.getTime() >= now.getTime() + EXPIRY_LEEWAY_MS;
    if (!valid) return Object.freeze({ valid: false as const });
    return Object.freeze({ valid: true as const, value: await work(tx) });
  }, { isolationLevel: "Serializable", timeout: 120_000 });
}

type LoadedArtistSnapshot =
  | Readonly<{ status: Exclude<SpotifyArtistCredentialResult["status"], "READY"> }>
  | Readonly<{
      status: "READY";
      credential: SpotifyArtistReadCredential;
      artists: readonly SpotifyArtistReadItem[];
    }>;

async function loadSpotifyArtistSnapshot(
  userId: string,
  options: ArtistReadOptions = {},
): Promise<LoadedArtistSnapshot> {
  const db = options.db ?? prisma;
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.providerTimeoutMs ?? 8_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error("SPOTIFY_ARTIST_TIMEOUT_INVALID");
  }
  const acquire = options.acquireCredential ?? acquireSpotifyArtistReadCredential;
  const envelope = await acquire(userId, { db, env: options.env, fetchImpl, now, providerTimeoutMs: timeoutMs });
  if (envelope.status !== "READY") return Object.freeze({ status: envelope.status });
  if (!isIssuedSpotifyArtistReadCredential(envelope) || envelope.credential.userId !== userId) {
    throw new Error("SPOTIFY_ARTIST_CREDENTIAL_INVALID");
  }
  const bodyBudget = { remaining: MAX_TOTAL_BODY_BYTES };
  const reads = await Promise.allSettled([
    readFollowed(envelope.credential, fetchImpl, timeoutMs, bodyBudget),
    readTop(envelope.credential, fetchImpl, timeoutMs, bodyBudget),
  ]);
  const followedRead = reads[0];
  const topRead = reads[1];
  if (followedRead.status === "rejected") throw followedRead.reason;
  if (topRead.status === "rejected") throw topRead.reason;
  const followed = followedRead.value;
  const top = topRead.value;
  const artists = deduplicateArtists(followed, top);
  const matcherInput = Object.freeze(artists.map((artist) => Object.freeze({ spotifyId: artist.spotifyId, name: artist.name })));
  const rawMatches = await (options.catalogMatcher
    ? options.catalogMatcher(matcherInput)
    : defaultCatalogMatcher(db, matcherInput));
  if (!Array.isArray(rawMatches) || rawMatches.length !== artists.length || rawMatches.length > MAX_TOTAL_ITEMS) {
    throw new Error("SPOTIFY_ARTIST_CATALOG_INVALID");
  }
  const matches = rawMatches.map(validateMatch);
  const output = artists.map((artist, index) => Object.freeze({ ...artist, match: matches[index] }));
  return Object.freeze({
    status: "READY",
    credential: envelope.credential,
    artists: Object.freeze(output),
  });
}

export async function readSpotifyArtistSnapshot(
  userId: string,
  options: ArtistReadOptions = {},
): Promise<SpotifyArtistReadResult> {
  const db = options.db ?? prisma;
  const now = options.now ?? (() => new Date());
  const loaded = await loadSpotifyArtistSnapshot(userId, options);
  if (loaded.status !== "READY") return loaded;
  try {
    const fenced = await finalFence(db, loaded.credential, now(), async () => undefined);
    if (!fenced.valid) return Object.freeze({ status: "DRIFTED" });
  } catch (error) {
    if (isSerializationFailure(error)) return Object.freeze({ status: "DRIFTED" });
    throw error;
  }
  return Object.freeze({ status: "READY", artists: loaded.artists });
}

function validateSelection(selection: SpotifyArtistImportSelection) {
  if (typeof selection.includeUnmatched !== "boolean") throw new Error("SPOTIFY_ARTIST_SELECTION_INVALID");
  if (selection.spotifyIds === null) return null;
  if (!Array.isArray(selection.spotifyIds) || selection.spotifyIds.length > MAX_TOTAL_ITEMS) {
    throw new Error("SPOTIFY_ARTIST_SELECTION_INVALID");
  }
  const selected = new Set<string>();
  for (const value of selection.spotifyIds) {
    const id = boundedText(value, MAX_ID_LENGTH);
    if (!id || selected.has(id)) throw new Error("SPOTIFY_ARTIST_SELECTION_INVALID");
    selected.add(id);
  }
  return selected;
}

export async function importSpotifyArtistSnapshot(
  userId: string,
  selection: SpotifyArtistImportSelection,
  options: ArtistReadOptions = {},
): Promise<SpotifyArtistImportResult> {
  const selectedIds = validateSelection(selection);
  const db = options.db ?? prisma;
  const now = options.now ?? (() => new Date());
  const loaded = await loadSpotifyArtistSnapshot(userId, options);
  if (loaded.status !== "READY") return loaded;
  const selected = Object.freeze(loaded.artists.filter((artist) => !selectedIds || selectedIds.has(artist.spotifyId)));
  if (selectedIds && selected.length !== selectedIds.size) {
    throw new Error("SPOTIFY_ARTIST_SELECTION_STALE");
  }

  try {
    const fenced = await finalFence(db, loaded.credential, now(), async (tx) => {
      const imported = [];
      const requested = [];
      const importedIds = new Set<string>();
      const requestedIds = new Set<string>();

      for (const artist of selected) {
        if (artist.match) {
          const entity = await tx.catalogEntity.findUnique({
            where: { id: artist.match.catalogEntityId },
            select: { id: true, type: true, canonicalName: true, provider: true, providerId: true },
          });
          if (
            !entity
            || entity.type !== "ARTIST"
            || entity.canonicalName !== artist.match.canonicalName
            || entity.provider !== artist.match.provider
            || entity.providerId !== artist.match.providerId
          ) {
            throw new Error("SPOTIFY_ARTIST_CATALOG_DRIFT");
          }
          const preference = await tx.notificationPreference.upsert({
            where: { userId_type_value: { userId, type: "ARTIST", value: entity.canonicalName } },
            create: {
              userId,
              type: "ARTIST",
              value: entity.canonicalName,
              catalogEntityId: entity.id,
              status: "ACTIVE",
            },
            update: { catalogEntityId: entity.id, status: "ACTIVE" },
            select: { id: true, type: true, value: true, status: true, catalogEntityId: true },
          });
          if (!importedIds.has(preference.id)) {
            importedIds.add(preference.id);
            imported.push(Object.freeze(preference));
          }
        } else if (selection.includeUnmatched) {
          const request = await tx.catalogRequest.upsert({
            where: {
              userId_requestedType_requestedValue: {
                userId,
                requestedType: "ARTIST",
                requestedValue: artist.name,
              },
            },
            create: {
              userId,
              requestedType: "ARTIST",
              requestedValue: artist.name,
              notes: "Imported from Spotify; needs catalog review.",
              status: "PENDING",
            },
            update: {
              notes: "Imported from Spotify; needs catalog review.",
              status: "PENDING",
              adminNotes: null,
              reviewedAt: null,
            },
            select: { id: true, requestedValue: true, status: true },
          });
          if (!requestedIds.has(request.id)) {
            requestedIds.add(request.id);
            requested.push(Object.freeze(request));
          }
        }
      }
      return Object.freeze({
        imported: Object.freeze(imported),
        requested: Object.freeze(requested),
      });
    });
    if (!fenced.valid) return Object.freeze({ status: "DRIFTED" });
    return Object.freeze({ status: "READY", ...fenced.value });
  } catch (error) {
    if (isSerializationFailure(error)) return Object.freeze({ status: "DRIFTED" });
    throw error;
  }
}
