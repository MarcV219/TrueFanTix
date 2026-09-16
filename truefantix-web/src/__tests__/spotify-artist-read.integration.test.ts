/** @jest-environment node */

import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  importSpotifyArtistSnapshot,
  readSpotifyArtistSnapshot,
} from "@/lib/integrations/spotify-artist-read";
import { drainSpotifyCatalogRequestDeliveries } from "@/lib/integrations/spotify-catalog-request-delivery";
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
  const alternateUserId = `artist-read-alternate-user-${suffix}`;
  const connectionId = `artist-read-connection-${suffix}`;
  const catalogEntityId = `artist-read-catalog-${suffix}`;
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
      await tx.spotifyCatalogRequestDeliveryItem.deleteMany({ where: { intent: { userId } } });
      await tx.spotifyCatalogRequestDeliveryIntent.deleteMany({ where: { userId } });
      await tx.notificationPreference.deleteMany({ where: { userId } });
      await tx.catalogRequest.deleteMany({ where: { userId } });
      await tx.connectedAccount.deleteMany({ where: { userId } });
      await tx.user.deleteMany({ where: { id: { in: [userId, alternateUserId] } } });
      await tx.catalogEntity.deleteMany({ where: { id: catalogEntityId } });
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

  it("uses only fixed endpoints and returns a frozen snapshot with an opaque token after the final fence", async () => {
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
    expect(result).toMatchObject({ status: "READY", artists: [{ spotifyId: "artist-1", name: "Artist One", popularity: 80, source: "followed", spotifyUrl: null, imageUrl: null, match: null }] });
    expect(result.status === "READY" && result.snapshotToken).toMatch(/^v1\./);
    expect(JSON.stringify(result)).not.toContain("provider-access-token");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("atomically imports the selected matched and unmatched artists after the exact final fence", async () => {
    await db.catalogEntity.create({ data: {
      id: catalogEntityId,
      type: "ARTIST",
      canonicalName: "Matched Artist",
      provider: "spotify",
      providerId: "artist-matched",
    } });
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("/following")
      ? response({ artists: { items: [
          { id: "artist-matched", name: "Matched Artist" },
          { id: "artist-unmatched", name: "Unmatched Artist" },
        ], next: null, cursors: { after: null } } })
      : response({ items: [], next: null })) as unknown as typeof fetch;

    const snapshot = await readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, now: () => new Date(now) });
    if (snapshot.status !== "READY") throw new Error("expected ready snapshot");
    const result = await importSpotifyArtistSnapshot(userId, {
      snapshotToken: snapshot.snapshotToken,
      spotifyIds: Object.freeze(["artist-matched", "artist-unmatched"]),
      includeUnmatched: true,
    }, { db: serviceDb, env, fetchImpl: jest.fn() as unknown as typeof fetch, now: () => new Date(now) });

    expect(result).toMatchObject({
      status: "READY",
      imported: [{ value: "Matched Artist", catalogEntityId }],
      requested: [{ requestedValue: "Unmatched Artist", status: "PENDING" }],
    });
    expect(Object.isFrozen(result)).toBe(true);
    await expect(db.notificationPreference.count({ where: { userId } })).resolves.toBe(1);
    await expect(db.catalogRequest.count({ where: { userId } })).resolves.toBe(1);
    await expect(db.spotifyCatalogRequestDeliveryIntent.count({ where: { userId } })).resolves.toBe(1);
  });

  it("rejects mixed and wholly unknown selections without writing a partial import", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("/following")
      ? response({ artists: { items: [{ id: "artist-known", name: "Known Artist" }], next: null, cursors: { after: null } } })
      : response({ items: [], next: null })) as unknown as typeof fetch;

    const snapshot = await readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, now: () => new Date(now) });
    if (snapshot.status !== "READY") throw new Error("expected ready snapshot");
    await expect(importSpotifyArtistSnapshot(userId, {
      snapshotToken: snapshot.snapshotToken,
      spotifyIds: Object.freeze(["artist-known", "artist-unknown"]),
      includeUnmatched: true,
    }, { db: serviceDb, env, fetchImpl, now: () => new Date(now) }))
      .rejects.toThrow("SPOTIFY_ARTIST_SELECTION_STALE");
    await expect(importSpotifyArtistSnapshot(userId, {
      snapshotToken: snapshot.snapshotToken,
      spotifyIds: Object.freeze(["artist-unknown"]),
      includeUnmatched: true,
    }, { db: serviceDb, env, fetchImpl, now: () => new Date(now) }))
      .rejects.toThrow("SPOTIFY_ARTIST_SELECTION_STALE");
    await expect(db.notificationPreference.count({ where: { userId } })).resolves.toBe(0);
    await expect(db.catalogRequest.count({ where: { userId } })).resolves.toBe(0);
  });

  it("returns drift without writes when the credential changes after provider and catalog reads", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("/following")
      ? response({ artists: { items: [{ id: "artist-unmatched", name: "Unmatched Artist" }], next: null, cursors: { after: null } } })
      : response({ items: [], next: null })) as unknown as typeof fetch;
    const snapshot = await readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, now: () => new Date(now) });
    if (snapshot.status !== "READY") throw new Error("expected ready snapshot");
    await db.connectedAccount.update({
      where: { id: connectionId },
      data: { expiresAt: new Date("2026-09-16T15:00:00.000Z") },
    });
    const postFetch = jest.fn();
    await expect(importSpotifyArtistSnapshot(userId, {
      snapshotToken: snapshot.snapshotToken,
      spotifyIds: null,
      includeUnmatched: true,
    }, { db: serviceDb, env, fetchImpl: postFetch as unknown as typeof fetch, now: () => new Date(now) }))
      .resolves.toEqual({ status: "DRIFTED" });
    expect(postFetch).not.toHaveBeenCalled();
    await expect(db.notificationPreference.count({ where: { userId } })).resolves.toBe(0);
    await expect(db.catalogRequest.count({ where: { userId } })).resolves.toBe(0);
  });

  it("rolls back every import write when matched catalog evidence drifts", async () => {
    await db.catalogEntity.create({ data: {
      id: catalogEntityId,
      type: "ARTIST",
      canonicalName: "Matched Artist",
      provider: "spotify",
      providerId: "artist-matched",
    } });
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("/following")
      ? response({ artists: { items: [
          { id: "artist-unmatched", name: "Unmatched Artist" },
          { id: "artist-matched", name: "Matched Artist" },
        ], next: null, cursors: { after: null } } })
      : response({ items: [], next: null })) as unknown as typeof fetch;
    const snapshot = await readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, now: () => new Date(now) });
    if (snapshot.status !== "READY") throw new Error("expected ready snapshot");
    await db.catalogEntity.update({
      where: { id: catalogEntityId },
      data: { providerId: "artist-replaced" },
    });
    await expect(importSpotifyArtistSnapshot(userId, {
      snapshotToken: snapshot.snapshotToken,
      spotifyIds: null,
      includeUnmatched: true,
    }, { db: serviceDb, env, now: () => new Date(now) }))
      .rejects.toThrow("SPOTIFY_ARTIST_CATALOG_DRIFT");
    await expect(db.notificationPreference.count({ where: { userId } })).resolves.toBe(0);
    await expect(db.catalogRequest.count({ where: { userId } })).resolves.toBe(0);
  });

  it("rejects tampered and expired snapshot tokens before provider I/O or writes", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("/following")
      ? response({ artists: { items: [{ id: "artist-unmatched", name: "Unmatched Artist" }], next: null, cursors: { after: null } } })
      : response({ items: [], next: null })) as unknown as typeof fetch;
    const snapshot = await readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, now: () => new Date(now) });
    if (snapshot.status !== "READY") throw new Error("expected ready snapshot");
    const postFetch = jest.fn();
    const tampered = `${snapshot.snapshotToken.slice(0, -1)}${snapshot.snapshotToken.endsWith("A") ? "B" : "A"}`;

    await expect(importSpotifyArtistSnapshot(userId, {
      snapshotToken: tampered,
      spotifyIds: null,
      includeUnmatched: true,
    }, { db: serviceDb, env, fetchImpl: postFetch as unknown as typeof fetch, now: () => new Date(now) }))
      .rejects.toThrow("SPOTIFY_ARTIST_SNAPSHOT_INVALID");
    await expect(importSpotifyArtistSnapshot(userId, {
      snapshotToken: snapshot.snapshotToken,
      spotifyIds: null,
      includeUnmatched: true,
    }, {
      db: serviceDb,
      env,
      fetchImpl: postFetch as unknown as typeof fetch,
      now: () => new Date(now.getTime() + 6 * 60_000),
    })).rejects.toThrow("SPOTIFY_ARTIST_SNAPSHOT_INVALID");

    expect(postFetch).not.toHaveBeenCalled();
    await expect(db.catalogRequest.count({ where: { userId } })).resolves.toBe(0);
    await expect(db.spotifyCatalogRequestDeliveryIntent.count({ where: { userId } })).resolves.toBe(0);
  });

  it("replays pending unmatched requests without duplicate reservations and never reopens reviewed rows", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("/following")
      ? response({ artists: { items: [{ id: "artist-unmatched", name: "Unmatched Artist" }], next: null, cursors: { after: null } } })
      : response({ items: [], next: null })) as unknown as typeof fetch;
    const snapshot = await readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, now: () => new Date(now) });
    if (snapshot.status !== "READY") throw new Error("expected ready snapshot");
    const selection = { snapshotToken: snapshot.snapshotToken, spotifyIds: null, includeUnmatched: true } as const;

    const first = await importSpotifyArtistSnapshot(userId, selection, { db: serviceDb, env, now: () => new Date(now) });
    const replay = await importSpotifyArtistSnapshot(userId, selection, { db: serviceDb, env, now: () => new Date(now) });
    expect(first.status === "READY" && first.deliveryIntentIds).toEqual(
      replay.status === "READY" ? replay.deliveryIntentIds : [],
    );
    await expect(db.spotifyCatalogRequestDeliveryIntent.count({ where: { userId } })).resolves.toBe(1);
    await expect(db.spotifyCatalogRequestDeliveryItem.count({ where: { intent: { userId } } })).resolves.toBe(1);

    const request = await db.catalogRequest.findFirstOrThrow({ where: { userId } });
    await db.catalogRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", adminNotes: "reviewed", reviewedAt: now },
    });
    const terminalReplay = await importSpotifyArtistSnapshot(userId, selection, { db: serviceDb, env, now: () => new Date(now) });
    expect(terminalReplay).toMatchObject({ status: "READY", requested: [{ status: "REJECTED" }], deliveryIntentIds: [] });
    await expect(db.catalogRequest.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({
      status: "REJECTED",
      adminNotes: "reviewed",
      reviewedAt: now,
    });
  });

  it("claims one durable delivery under concurrent drains and never replays a delivered email", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("/following")
      ? response({ artists: { items: [{ id: "artist-unmatched", name: "Unmatched Artist" }], next: null, cursors: { after: null } } })
      : response({ items: [], next: null })) as unknown as typeof fetch;
    const snapshot = await readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, now: () => new Date(now) });
    if (snapshot.status !== "READY") throw new Error("expected ready snapshot");
    const imported = await importSpotifyArtistSnapshot(userId, {
      snapshotToken: snapshot.snapshotToken,
      spotifyIds: null,
      includeUnmatched: true,
    }, { db: serviceDb, env, now: () => new Date(now) });
    if (imported.status !== "READY") throw new Error("expected ready import");
    const send = jest.fn(async () => ({ ok: true, provider: "RESEND" as const, providerResult: "accepted" }));
    const deliveryEnv = { NODE_ENV: "test", RESEND_API_KEY: "synthetic-resend-key" } as NodeJS.ProcessEnv;

    await Promise.all([
      drainSpotifyCatalogRequestDeliveries(imported.deliveryIntentIds, serviceDb, { env: deliveryEnv, send }),
      drainSpotifyCatalogRequestDeliveries(imported.deliveryIntentIds, serviceDb, { env: deliveryEnv, send }),
    ]);
    await drainSpotifyCatalogRequestDeliveries(imported.deliveryIntentIds, serviceDb, { env: deliveryEnv, send });

    expect(send).toHaveBeenCalledTimes(1);
    await expect(db.spotifyCatalogRequestDeliveryIntent.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({ status: "DELIVERED", attemptCount: 1, provider: "RESEND" });
  });

  it("quarantines an ambiguous sender exception and does not call the provider again", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("/following")
      ? response({ artists: { items: [{ id: "artist-unmatched", name: "Unmatched Artist" }], next: null, cursors: { after: null } } })
      : response({ items: [], next: null })) as unknown as typeof fetch;
    const snapshot = await readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, now: () => new Date(now) });
    if (snapshot.status !== "READY") throw new Error("expected ready snapshot");
    const imported = await importSpotifyArtistSnapshot(userId, {
      snapshotToken: snapshot.snapshotToken,
      spotifyIds: null,
      includeUnmatched: true,
    }, { db: serviceDb, env, now: () => new Date(now) });
    if (imported.status !== "READY") throw new Error("expected ready import");
    const send = jest.fn(async () => { throw new Error("ambiguous transport failure"); });
    const deliveryEnv = { NODE_ENV: "test", RESEND_API_KEY: "synthetic-resend-key" } as NodeJS.ProcessEnv;

    await drainSpotifyCatalogRequestDeliveries(imported.deliveryIntentIds, serviceDb, { env: deliveryEnv, send });
    await drainSpotifyCatalogRequestDeliveries(imported.deliveryIntentIds, serviceDb, { env: deliveryEnv, send });

    expect(send).toHaveBeenCalledTimes(1);
    await expect(db.spotifyCatalogRequestDeliveryIntent.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({
        status: "RECONCILIATION_REQUIRED",
        attemptCount: 1,
        provider: "RESEND",
        dispatchStartedAt: expect.any(Date),
      });
  });

  it("enforces immutable delivery envelopes, membership, lifecycle, and terminal history in PostgreSQL", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("/following")
      ? response({ artists: { items: [{ id: "artist-unmatched", name: "Unmatched Artist" }], next: null, cursors: { after: null } } })
      : response({ items: [], next: null })) as unknown as typeof fetch;
    const snapshot = await readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, now: () => new Date(now) });
    if (snapshot.status !== "READY") throw new Error("expected ready snapshot");
    const imported = await importSpotifyArtistSnapshot(userId, {
      snapshotToken: snapshot.snapshotToken,
      spotifyIds: null,
      includeUnmatched: true,
    }, { db: serviceDb, env, now: () => new Date(now) });
    if (imported.status !== "READY") throw new Error("expected ready import");
    const intent = await db.spotifyCatalogRequestDeliveryIntent.findFirstOrThrow({ where: { userId } });
    const item = await db.spotifyCatalogRequestDeliveryItem.findFirstOrThrow({ where: { intentId: intent.id } });
    const request = await db.catalogRequest.findUniqueOrThrow({ where: { id: item.catalogRequestId } });
    await db.user.create({ data: {
      id: alternateUserId,
      email: `artist-read-alternate-${suffix}@example.test`,
      passwordHash: "synthetic",
      firstName: "Alternate",
      lastName: "Owner",
      emailVerifiedAt: now,
      phone: `+1554${String(Date.now()).slice(-7)}`,
      phoneVerifiedAt: now,
      streetAddress1: "2 Test Lane",
      city: "Toronto",
      region: "ON",
      postalCode: "M5V 1A2",
      country: "CA",
    } });

    await expect(db.spotifyCatalogRequestDeliveryIntent.update({
      where: { id: intent.id }, data: { subject: "forged envelope" },
    })).rejects.toThrow();
    await expect(db.spotifyCatalogRequestDeliveryIntent.update({
      where: { id: intent.id }, data: { status: "DELIVERED" },
    })).rejects.toThrow();
    await expect(db.spotifyCatalogRequestDeliveryIntent.update({
      where: { id: intent.id }, data: { status: "PROCESSING", provider: "RESEND" },
    })).rejects.toThrow();
    await expect(db.spotifyCatalogRequestDeliveryItem.update({
      where: { id: item.id }, data: { requestedValue: "forged membership" },
    })).rejects.toThrow();
    await expect(db.spotifyCatalogRequestDeliveryItem.delete({ where: { id: item.id } })).rejects.toThrow();
    await expect(db.catalogRequest.update({
      where: { id: request.id }, data: { requestedValue: "Forged Artist" },
    })).rejects.toThrow();
    await expect(db.catalogRequest.update({
      where: { id: request.id }, data: { requestedType: "TEAM" },
    })).rejects.toThrow();
    await expect(db.catalogRequest.update({
      where: { id: request.id }, data: { userId: alternateUserId },
    })).rejects.toThrow();
    await expect(db.spotifyCatalogRequestDeliveryIntent.delete({ where: { id: intent.id } })).rejects.toThrow();
    await expect(db.$executeRawUnsafe('TRUNCATE TABLE "SpotifyCatalogRequestDeliveryItem"')).rejects.toThrow();
    await expect(db.$executeRawUnsafe('TRUNCATE TABLE "SpotifyCatalogRequestDeliveryIntent"')).rejects.toThrow();

    const send = jest.fn(async () => ({ ok: true, provider: "RESEND" as const, providerResult: "accepted" }));
    const deliveryEnv = { NODE_ENV: "test", RESEND_API_KEY: "synthetic-resend-key" } as NodeJS.ProcessEnv;
    await drainSpotifyCatalogRequestDeliveries(imported.deliveryIntentIds, serviceDb, { env: deliveryEnv, send });
    const delivered = await db.spotifyCatalogRequestDeliveryIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(delivered).toMatchObject({
      status: "DELIVERED",
      provider: "RESEND",
      attemptCount: 1,
      firstAttemptAt: expect.any(Date),
      dispatchStartedAt: expect.any(Date),
      deliveredAt: expect.any(Date),
    });
    await expect(db.spotifyCatalogRequestDeliveryIntent.update({
      where: { id: intent.id }, data: { status: "PENDING" },
    })).rejects.toThrow();
    await expect(db.spotifyCatalogRequestDeliveryIntent.update({
      where: { id: intent.id }, data: { provider: "SENDGRID" },
    })).rejects.toThrow();
    await expect(db.spotifyCatalogRequestDeliveryIntent.update({
      where: { id: intent.id }, data: { dispatchStartedAt: null },
    })).rejects.toThrow();

    await expect(db.catalogRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", adminNotes: "reviewed", reviewedAt: now },
    })).resolves.toMatchObject({
      userId,
      requestedType: "ARTIST",
      requestedValue: "Unmatched Artist",
      status: "REJECTED",
      adminNotes: "reviewed",
    });

    const teamRequest = await db.catalogRequest.create({ data: {
      userId,
      requestedType: "TEAM",
      requestedValue: "Team Request",
      status: "PENDING",
    } });
    await expect(db.$transaction(async (tx) => {
      const forgedIntent = await tx.spotifyCatalogRequestDeliveryIntent.create({ data: {
        userId,
        recipient: "admin@truefantix.com",
        subject: "forged",
        textBody: "forged",
        htmlBody: "forged",
        payloadJson: { requestIds: [teamRequest.id], names: [teamRequest.requestedValue] },
        envelopeDigest: "0".repeat(64),
        idempotencyKey: `spotify-catalog:${"1".repeat(64)}`,
      } });
      await tx.spotifyCatalogRequestDeliveryItem.create({ data: {
        intentId: forgedIntent.id,
        catalogRequestId: teamRequest.id,
        requestedValue: teamRequest.requestedValue,
      } });
    })).rejects.toThrow();
  });

  it("quarantines an expired pre-dispatch claim without inventing dispatch evidence", async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => String(input).includes("/following")
      ? response({ artists: { items: [{ id: "artist-unmatched", name: "Unmatched Artist" }], next: null, cursors: { after: null } } })
      : response({ items: [], next: null })) as unknown as typeof fetch;
    const snapshot = await readSpotifyArtistSnapshot(userId, { db: serviceDb, env, fetchImpl, now: () => new Date(now) });
    if (snapshot.status !== "READY") throw new Error("expected ready snapshot");
    const imported = await importSpotifyArtistSnapshot(userId, {
      snapshotToken: snapshot.snapshotToken,
      spotifyIds: null,
      includeUnmatched: true,
    }, { db: serviceDb, env, now: () => new Date(now) });
    if (imported.status !== "READY") throw new Error("expected ready import");
    const intentId = imported.deliveryIntentIds[0];
    const processingAt = new Date(Date.now() - 30 * 60_000);
    const leaseExpiresAt = new Date(Date.now() - 15 * 60_000);
    await db.spotifyCatalogRequestDeliveryIntent.update({
      where: { id: intentId },
      data: {
        status: "PROCESSING",
        provider: "RESEND",
        processingAt,
        leaseExpiresAt,
        claimToken: "expired-pre-dispatch-claim",
      },
    });
    await expect(db.spotifyCatalogRequestDeliveryIntent.update({
      where: { id: intentId }, data: { claimToken: "forged-claim" },
    })).rejects.toThrow();
    await expect(db.spotifyCatalogRequestDeliveryIntent.update({
      where: { id: intentId }, data: { provider: "SENDGRID" },
    })).rejects.toThrow();
    await expect(db.spotifyCatalogRequestDeliveryIntent.update({
      where: { id: intentId }, data: { leaseExpiresAt: new Date(Date.now() + 15 * 60_000) },
    })).rejects.toThrow();

    await drainSpotifyCatalogRequestDeliveries(imported.deliveryIntentIds, serviceDb, {
      env: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
      send: jest.fn(),
    });

    await expect(db.spotifyCatalogRequestDeliveryIntent.findUniqueOrThrow({ where: { id: intentId } }))
      .resolves.toMatchObject({
        status: "RECONCILIATION_REQUIRED",
        provider: "RESEND",
        attemptCount: 0,
        firstAttemptAt: null,
        dispatchStartedAt: null,
        providerResult: null,
        lastError: "Expired Spotify catalog delivery claim requires provider reconciliation",
      });
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
      .resolves.toMatchObject({ status: "READY", artists: [], snapshotToken: expect.stringMatching(/^v1\./) });
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
