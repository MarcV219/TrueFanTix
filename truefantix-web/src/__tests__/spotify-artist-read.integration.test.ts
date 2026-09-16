/** @jest-environment node */

import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readSpotifyArtistSnapshot } from "@/lib/integrations/spotify-artist-read";
import { prisma } from "@/lib/prisma";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) describe.skip("bounded Spotify artist read", () => {
  it("requires an isolated database", () => undefined);
}); else describe("bounded Spotify artist read", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const serviceDb = db as unknown as typeof prisma;
  const suffix = `${Date.now()}-${process.pid}`;
  const userId = `artist-read-user-${suffix}`;
  const connectionId = `artist-read-connection-${suffix}`;
  const secret = "artist-read-integration-encryption-key";
  const now = new Date("2026-09-16T12:00:00.000Z");
  const env = { NODE_ENV: "test", SPOTIFY_TOKEN_ENCRYPTION_KEY: secret } as NodeJS.ProcessEnv;

  function encrypt(value: string) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", crypto.createHash("sha256").update(secret).digest(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
  }

  async function reset() {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.connectedAccount.deleteMany({ where: { userId } });
      await tx.user.deleteMany({ where: { id: userId } });
    });
  }

  async function fixture() {
    await db.user.create({ data: {
      id: userId, email: `artist-read-${suffix}@example.test`, passwordHash: "synthetic", firstName: "Artist", lastName: "Reader",
      emailVerifiedAt: now, phone: `+1555${String(Date.now()).slice(-7)}`, phoneVerifiedAt: now,
      streetAddress1: "1 Test Lane", city: "Toronto", region: "ON", postalCode: "M5V 1A1", country: "CA",
    } });
    await db.connectedAccount.create({ data: {
      id: connectionId, userId, provider: "spotify", providerAccountId: `provider-${suffix}`,
      accessTokenEncrypted: encrypt("provider-access-token"), refreshTokenEncrypted: encrypt("provider-refresh-token"),
      tokenType: "Bearer", scope: "user-follow-read user-top-read", expiresAt: new Date("2026-09-16T14:00:00.000Z"),
    } });
  }

  function response(body: unknown) {
    return new Response(JSON.stringify(body), { status: 200 });
  }

  beforeEach(async () => { await reset(); await fixture(); });
  afterAll(async () => { await reset(); await db.$disconnect(); await pool.end(); });

  it("uses only fixed endpoints and returns a frozen token-free snapshot after the final fence", async () => {
    const urls: string[] = [];
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input); urls.push(url);
      if (url.includes("/following")) return response({ artists: { items: [{ id: "artist-1", name: "Artist One", popularity: 80 }], next: null, cursors: { after: null } } });
      return response({ items: [], next: null });
    }) as unknown as typeof fetch;
    const matcher = jest.fn(async () => [null]);
    const result = await readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, catalogMatcher: matcher, now: () => new Date(now) });
    expect(urls).toHaveLength(4);
    expect(urls.every((url) => url.startsWith("https://api.spotify.com/v1/me/"))).toBe(true);
    expect(matcher).toHaveBeenCalledWith(Object.freeze([{ spotifyId: "artist-1", name: "Artist One" }]));
    expect(result).toEqual({ status: "READY", artists: [{ spotifyId: "artist-1", name: "Artist One", popularity: 80, source: "followed", spotifyUrl: null, imageUrl: null, match: null }] });
    expect(JSON.stringify(result)).not.toContain("provider-access-token");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects a hostile pagination URL without following it or invoking catalog matching", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("/following")
      ? response({ artists: { items: [], next: "https://evil.example/steal", cursors: { after: "cursor" } } })
      : response({ items: [], next: null })) as unknown as typeof fetch;
    const matcher = jest.fn();
    await expect(readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, catalogMatcher: matcher, now: () => new Date(now) }))
      .rejects.toThrow("SPOTIFY_ARTIST_PAGINATION_INVALID");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(matcher).not.toHaveBeenCalled();
  });

  it("rejects pagination cycles and duplicate identities deterministically", async () => {
    let followedCalls = 0;
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes("/following")) return response({ items: [], next: null });
      followedCalls += 1;
      return response({ artists: {
        items: [{ id: `artist-${followedCalls}`, name: "Artist" }],
        next: "https://api.spotify.com/v1/me/following?type=artist&limit=50&after=cycle",
        cursors: { after: "cycle" },
      } });
    }) as unknown as typeof fetch;
    await expect(readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, now: () => new Date(now) }))
      .rejects.toThrow("SPOTIFY_ARTIST_PAGINATION_INVALID");
    expect(followedCalls).toBe(2);
  });

  it("accepts a bounded final cursor when Spotify reports no next page", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("/following")
      ? response({ artists: { items: [], next: null, cursors: { after: "final-cursor" } } })
      : response({ items: [], next: null })) as unknown as typeof fetch;
    await expect(readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, now: () => new Date(now) }))
      .resolves.toEqual({ status: "READY", artists: [] });
  });

  it("rejects oversized catalog output without entering the final fence", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("/following")
      ? response({ artists: { items: [{ id: "artist-1", name: "Artist One" }], next: null, cursors: { after: null } } })
      : response({ items: [], next: null })) as unknown as typeof fetch;
    const matcher = jest.fn(async () => [{ catalogEntityId: "id", canonicalName: "x".repeat(257), provider: "local", providerId: "id" }]);
    await expect(readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, catalogMatcher: matcher, now: () => new Date(now) }))
      .rejects.toThrow("SPOTIFY_ARTIST_CATALOG_INVALID");
  });

  it("returns no artists when the exact connection drifts after catalog reads", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("/following")
      ? response({ artists: { items: [{ id: "artist-1", name: "Artist One" }], next: null, cursors: { after: null } } })
      : response({ items: [], next: null })) as unknown as typeof fetch;
    const matcher = jest.fn(async () => {
      await db.connectedAccount.update({ where: { id: connectionId }, data: { expiresAt: new Date("2026-09-16T15:00:00.000Z") } });
      return [null];
    });
    await expect(readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, catalogMatcher: matcher, now: () => new Date(now) }))
      .resolves.toEqual({ status: "DRIFTED" });
  });

  it("performs zero provider I/O for a forged READY envelope", async () => {
    const fetchImpl = jest.fn();
    const acquireCredential = jest.fn(async () => Object.freeze({ status: "READY" as const, credential: Object.freeze({
      userId, connectionId, provider: "spotify" as const, providerAccountId: "forged", accessToken: "forged-token",
      versionDigest: "0".repeat(64), expiresAt: "2026-09-16T14:00:00.000Z", refreshCommandId: null,
    }) }));
    await expect(readSpotifyArtistSnapshot(userId, { db: serviceDb, acquireCredential, fetchImpl, now: () => new Date(now) }))
      .rejects.toThrow("SPOTIFY_ARTIST_CREDENTIAL_INVALID");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails the complete snapshot when either provider branch is invalid", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("time_range=medium_term")
      ? new Response("provider unavailable", { status: 503 })
      : String(input).includes("/following")
        ? response({ artists: { items: [], next: null, cursors: { after: null } } })
        : response({ items: [], next: null })) as unknown as typeof fetch;
    const matcher = jest.fn();
    await expect(readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, catalogMatcher: matcher, now: () => new Date(now) }))
      .rejects.toThrow("SPOTIFY_ARTIST_PROVIDER_FAILED");
    expect(matcher).not.toHaveBeenCalled();
  });

  it("rejects a streamed response as soon as its body exceeds the fixed per-response bound", async () => {
    const oversized = `{"items":[],"padding":"${"x".repeat(256_001)}"}`;
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("time_range=short_term")
      ? new Response(oversized, { status: 200 })
      : String(input).includes("/following")
        ? response({ artists: { items: [], next: null, cursors: { after: null } } })
        : response({ items: [], next: null })) as unknown as typeof fetch;
    const matcher = jest.fn();
    await expect(readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, catalogMatcher: matcher, now: () => new Date(now) }))
      .rejects.toThrow("SPOTIFY_ARTIST_PROVIDER_FAILED");
    expect(matcher).not.toHaveBeenCalled();
  });

  it("times out when provider fetch never resolves", async () => {
    const fetchImpl = jest.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const matcher = jest.fn();
    await expect(readSpotifyArtistSnapshot(userId, {
      db: serviceDb, env, fetchImpl, catalogMatcher: matcher, providerTimeoutMs: 5, now: () => new Date(now),
    })).rejects.toThrow("SPOTIFY_ARTIST_PROVIDER_FAILED");
    expect(matcher).not.toHaveBeenCalled();
  });

  it("times out and cancels when headers resolve but the response body never completes", async () => {
    const cancel = jest.fn();
    const fetchImpl = jest.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel,
    }), { status: 200 })) as unknown as typeof fetch;
    const matcher = jest.fn();
    await expect(readSpotifyArtistSnapshot(userId, {
      db: serviceDb, env, fetchImpl, catalogMatcher: matcher, providerTimeoutMs: 5, now: () => new Date(now),
    })).rejects.toThrow("SPOTIFY_ARTIST_PROVIDER_FAILED");
    expect(cancel).toHaveBeenCalled();
    expect(matcher).not.toHaveBeenCalled();
  });

  it("rejects an unexpected top-artist continuation instead of returning a partial snapshot", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("time_range=short_term")
      ? response({ items: [], next: "https://api.spotify.com/v1/me/top/artists?time_range=short_term&limit=50&offset=50" })
      : String(input).includes("/following")
        ? response({ artists: { items: [], next: null, cursors: { after: null } } })
        : response({ items: [], next: null })) as unknown as typeof fetch;
    const matcher = jest.fn();
    await expect(readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, catalogMatcher: matcher, now: () => new Date(now) }))
      .rejects.toThrow("SPOTIFY_ARTIST_LIMIT_EXCEEDED");
    expect(matcher).not.toHaveBeenCalled();
  });

  it("refuses an administrator persona before any provider or catalog I/O", async () => {
    await db.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
    const fetchImpl = jest.fn();
    const matcher = jest.fn();
    await expect(readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, catalogMatcher: matcher, now: () => new Date(now) }))
      .rejects.toThrow("NOT_AUTHENTICATED");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(matcher).not.toHaveBeenCalled();
  });
});
