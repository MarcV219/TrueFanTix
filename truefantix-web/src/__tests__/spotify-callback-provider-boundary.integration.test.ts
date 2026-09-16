/** @jest-environment node */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  snapshotSpotifyConnectionAuthorization,
  storeSpotifyConnection,
  type SpotifyConnectionEvidence,
} from "@/lib/integrations/spotify";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) describe.skip("Spotify callback PostgreSQL boundary", () => {
  it("requires an isolated database", () => undefined);
}); else describe("Spotify callback PostgreSQL boundary", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const runId = `${Date.now()}-${process.pid}`;
  const userId = `spotify-callback-user-${runId}`;
  const connectionId = `spotify-callback-connection-${runId}`;
  const previousEncryptionKey = process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;

  const evidence: SpotifyConnectionEvidence = {
    providerAccountId: `spotify-new-${runId}`,
    accessToken: `synthetic-access-${runId}`,
    refreshToken: `synthetic-refresh-${runId}`,
    tokenType: "Bearer",
    scope: "user-follow-read user-top-read",
    expiresAt: new Date("2026-09-16T04:00:00.000Z"),
    displayName: "Synthetic Spotify Listener",
    email: `spotify-${runId}@example.test`,
  };

  beforeAll(async () => {
    process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = "test-only-spotify-encryption-key-32-bytes";
    await db.user.create({
      data: {
        id: userId,
        email: `spotify-user-${runId}@example.test`,
        passwordHash: "synthetic-no-login",
        firstName: "Synthetic",
        lastName: "Listener",
        phone: `+1555${String(Date.now()).slice(-7)}`,
        streetAddress1: "1 Test Lane",
        city: "Toronto",
        region: "ON",
        postalCode: "M5V 1A1",
        country: "CA",
      },
    });
    await db.connectedAccount.create({
      data: {
        id: connectionId,
        userId,
        provider: "spotify",
        providerAccountId: `spotify-old-${runId}`,
        accessTokenEncrypted: "old-access-ciphertext",
        refreshTokenEncrypted: "old-refresh-ciphertext",
        expiresAt: new Date("2026-09-16T03:00:00.000Z"),
      },
    });
  });

  beforeEach(async () => {
    await db.connectedAccount.update({
      where: { id: connectionId },
      data: {
        providerAccountId: `spotify-old-${runId}`,
        accessTokenEncrypted: "old-access-ciphertext",
        refreshTokenEncrypted: "old-refresh-ciphertext",
        expiresAt: new Date("2026-09-16T03:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await db.connectedAccount.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
    await pool.end();
    if (previousEncryptionKey === undefined) delete process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
    else process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = previousEncryptionKey;
  });

  it("refuses a same-row credential version change without overwriting it", async () => {
    const authorization = await db.$transaction(
      (tx) => snapshotSpotifyConnectionAuthorization(userId, tx),
      { isolationLevel: "Serializable" },
    );
    await db.connectedAccount.update({
      where: { id: connectionId },
      data: {
        accessTokenEncrypted: "newer-access-ciphertext",
        refreshTokenEncrypted: "newer-refresh-ciphertext",
      },
    });

    await expect(db.$transaction(
      (tx) => storeSpotifyConnection({ authorization, evidence, db: tx }),
      { isolationLevel: "Serializable" },
    )).rejects.toThrow("SPOTIFY_CONNECTION_CHANGED");

    await expect(db.connectedAccount.findUniqueOrThrow({ where: { id: connectionId } }))
      .resolves.toMatchObject({
        providerAccountId: `spotify-old-${runId}`,
        accessTokenEncrypted: "newer-access-ciphertext",
        refreshTokenEncrypted: "newer-refresh-ciphertext",
      });
  });

  it("updates the exact unchanged row once and persists no plaintext token", async () => {
    const authorization = await db.$transaction(
      (tx) => snapshotSpotifyConnectionAuthorization(userId, tx),
      { isolationLevel: "Serializable" },
    );

    await expect(db.$transaction(
      (tx) => storeSpotifyConnection({ authorization, evidence, db: tx }),
      { isolationLevel: "Serializable" },
    )).resolves.toMatchObject({ id: connectionId });

    const [count, stored] = await Promise.all([
      db.connectedAccount.count({ where: { userId, provider: "spotify" } }),
      db.connectedAccount.findUniqueOrThrow({ where: { id: connectionId } }),
    ]);
    expect(count).toBe(1);
    expect(stored.providerAccountId).toBe(evidence.providerAccountId);
    expect(stored.accessTokenEncrypted).not.toContain(evidence.accessToken);
    expect(stored.refreshTokenEncrypted).not.toContain(evidence.refreshToken!);
    expect(JSON.stringify(stored)).not.toContain(evidence.accessToken);
    expect(JSON.stringify(stored)).not.toContain(evidence.refreshToken);
  });
});
