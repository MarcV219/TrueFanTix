/** @jest-environment node */

import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { acquireSpotifyArtistReadCredential } from "@/lib/integrations/spotify-artist-credential";
import {
  executeSpotifyRefreshCommand,
  SpotifyRefreshAccessChangedError,
} from "@/lib/integrations/spotify-refresh-command";
import { ManagedAccountSpotifyOperationError } from "@/lib/integrations/ordinary-spotify-user";
import { prisma } from "@/lib/prisma";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) describe.skip("Spotify artist credential acquisition", () => {
  it("requires an isolated database", () => undefined);
}); else describe("Spotify artist credential acquisition", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const serviceDb = db as unknown as typeof prisma;
  const runId = `${Date.now()}-${process.pid}`;
  const userId = `spotify-artist-credential-user-${runId}`;
  const connectionId = `spotify-artist-credential-connection-${runId}`;
  const providerAccountId = `spotify-artist-provider-${runId}`;
  const encryptionSecret = "spotify-artist-credential-test-key-32-bytes";
  const env = {
    NODE_ENV: "test",
    SPOTIFY_TOKEN_ENCRYPTION_KEY: encryptionSecret,
    SPOTIFY_CLIENT_ID: "synthetic-client-id",
    SPOTIFY_CLIENT_SECRET: "synthetic-client-secret",
  } as NodeJS.ProcessEnv;
  const operationNow = new Date("2026-09-16T05:00:00.000Z");

  function encrypt(value: string) {
    const key = crypto.createHash("sha256").update(encryptionSecret).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  async function forceReset() {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.connectedAccount.deleteMany({ where: { userId } });
      await tx.spotifyRefreshCommand.deleteMany({ where: { userId } });
      await tx.user.deleteMany({ where: { id: userId } });
    });
  }

  async function installFixture({
    accessToken = `source-access-${runId}`,
    expiresAt = new Date("2026-09-16T06:00:00.000Z"),
    email = `spotify-artist-credential-${runId}@example.test`,
    phone = `+1554${String(Date.now()).slice(-7)}`,
    emailVerifiedAt = new Date("2026-09-16T00:00:00.000Z") as Date | null,
    phoneVerifiedAt = new Date("2026-09-16T00:00:00.000Z") as Date | null,
    isBanned = false,
    termsVersion = null as string | null,
  } = {}) {
    await db.user.create({
      data: {
        id: userId,
        email,
        passwordHash: "synthetic-no-login",
        emailVerifiedAt,
        firstName: "Synthetic",
        lastName: "Listener",
        phone,
        phoneVerifiedAt,
        streetAddress1: "1 Test Lane",
        city: "Toronto",
        region: "ON",
        postalCode: "M5V 1A1",
        country: "CA",
        isBanned,
        termsVersion,
      },
    });
    await db.connectedAccount.create({
      data: {
        id: connectionId,
        userId,
        provider: "spotify",
        providerAccountId,
        accessTokenEncrypted: encrypt(accessToken),
        refreshTokenEncrypted: encrypt(`source-refresh-${runId}`),
        tokenType: "Bearer",
        scope: "user-follow-read user-top-read",
        expiresAt,
      },
    });
  }

  function successResponse(accessToken = `result-access-${runId}`) {
    return new Response(JSON.stringify({
      access_token: accessToken,
      refresh_token: `result-refresh-${runId}`,
      token_type: "Bearer",
      scope: "user-follow-read user-top-read",
      expires_in: 3_600,
    }), { status: 200 });
  }

  function observeSnapshotTransactionQueries() {
    let completedQueries: number | null = null;
    const observedDb = new Proxy(serviceDb, {
      get(target, property, receiver) {
        if (property !== "$transaction") return Reflect.get(target, property, receiver);
        return async (callback: (tx: unknown) => Promise<unknown>, options: unknown) => (
          serviceDb.$transaction(async (tx) => {
            completedQueries = 0;
            const observedTx = new Proxy(tx, {
              get(transaction, transactionProperty, transactionReceiver) {
                if (transactionProperty !== "$queryRaw") {
                  return Reflect.get(transaction, transactionProperty, transactionReceiver);
                }
                return async (...args: unknown[]) => {
                  const result = await Reflect.apply(
                    transaction.$queryRaw as unknown as (...values: unknown[]) => Promise<unknown>,
                    transaction,
                    args,
                  );
                  completedQueries = (completedQueries ?? 0) + 1;
                  return result;
                };
              },
            });
            try {
              return await callback(observedTx);
            } finally {
              completedQueries = null;
            }
          }, options as never)
        );
      },
    }) as typeof prisma;
    return { observedDb, completedQueries: () => completedQueries };
  }

  beforeEach(async () => {
    await forceReset();
  });

  afterAll(async () => {
    await forceReset();
    await db.$disconnect();
    await pool.end();
  });

  it("returns only a committed unexpired credential without invoking refresh", async () => {
    await installFixture();
    const refreshCommand = jest.fn();
    let callbackResolved = false;

    const result = await acquireSpotifyArtistReadCredential(userId, {
      db: serviceDb,
      env,
      now: () => new Date(operationNow),
      refreshCommand,
      hooks: {
        afterInitialSnapshotCommitted: async (snapshot) => {
          callbackResolved = true;
          expect(snapshot).toMatchObject({
            connectionId,
            providerAccountId,
            refreshRequired: false,
          });
          expect(Object.isFrozen(snapshot)).toBe(true);
        },
      },
    });

    expect(callbackResolved).toBe(true);
    expect(refreshCommand).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "READY",
      credential: {
        userId,
        connectionId,
        provider: "spotify",
        providerAccountId,
        accessToken: `source-access-${runId}`,
        versionDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        expiresAt: "2026-09-16T06:00:00.000Z",
        refreshCommandId: null,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.status === "READY" && Object.isFrozen(result.credential)).toBe(true);
  });

  it("samples validity after the locked snapshot reads and refreshes at exact leeway equality", async () => {
    await installFixture({ expiresAt: new Date("2026-09-16T05:01:00.000Z") });
    const observed = observeSnapshotTransactionQueries();
    const observedClockQueryCounts: Array<number | null> = [];
    const refreshCommand = jest.fn(async () => ({
      status: "RECONNECT_REQUIRED" as const,
      commandId: "credential-expired-after-locks",
    }));

    await expect(acquireSpotifyArtistReadCredential(userId, {
      db: observed.observedDb,
      env,
      now: () => {
        observedClockQueryCounts.push(observed.completedQueries());
        return new Date(operationNow);
      },
      refreshCommand,
    })).resolves.toEqual({
      status: "RECONNECT_REQUIRED",
      commandId: "credential-expired-after-locks",
    });

    expect(observedClockQueryCounts).toEqual([3]);
    expect(refreshCommand).toHaveBeenCalledTimes(1);
  });

  it("refreshes only after Tx1 commits and reacquires the committed result instead of using the transient token", async () => {
    await installFixture({ expiresAt: new Date("2026-09-16T04:00:00.000Z") });
    const fetchImpl = jest.fn(async () => successResponse()) as unknown as typeof fetch;
    const order: string[] = [];

    const result = await acquireSpotifyArtistReadCredential(userId, {
      db: serviceDb,
      env,
      fetchImpl,
      now: () => new Date(operationNow),
      attemptIdFactory: () => `spotify-artist-acquire-${runId}`,
      hooks: {
        afterInitialSnapshotCommitted: () => { order.push("tx1-committed"); },
        afterRefreshCompleted: (refresh) => {
          order.push("refresh-completed");
          if (refresh.status === "SUCCEEDED") refresh.accessToken = "transient-token-must-not-be-used";
        },
        afterRefreshedSnapshotCommitted: () => { order.push("reacquire-committed"); },
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["tx1-committed", "refresh-completed", "reacquire-committed"]);
    expect(result).toMatchObject({
      status: "READY",
      credential: {
        accessToken: `result-access-${runId}`,
        refreshCommandId: expect.any(String),
      },
    });
    const account = await db.connectedAccount.findUniqueOrThrow({ where: { id: connectionId } });
    const command = await db.spotifyRefreshCommand.findFirstOrThrow({ where: { userId } });
    expect(account.currentRefreshCommandId).toBe(command.id);
    expect(command.status).toBe("SUCCEEDED");
    expect(result.status === "READY" && result.credential.versionDigest).toBe(command.resultVersionDigest);
  });

  it("rechecks the refreshed projection expiry from inside the locked reacquisition transaction", async () => {
    await installFixture({ expiresAt: new Date("2026-09-16T04:00:00.000Z") });
    const fetchImpl = jest.fn(async () => successResponse()) as unknown as typeof fetch;
    const observed = observeSnapshotTransactionQueries();
    const observedClockQueryCounts: Array<number | null> = [];
    const acquisitionTimes = [
      new Date(operationNow),
      new Date("2026-09-16T05:59:00.000Z"),
    ];
    const refreshCommand = jest.fn(async (_requestedUserId, refreshOptions) => (
      executeSpotifyRefreshCommand(userId, {
        db: serviceDb,
        env,
        fetchImpl,
        now: () => new Date(operationNow),
        attemptIdFactory: () => `spotify-artist-expiry-${runId}`,
        expectedSource: refreshOptions.expectedSource,
      })
    ));

    await expect(acquireSpotifyArtistReadCredential(userId, {
      db: observed.observedDb,
      env,
      now: () => {
        observedClockQueryCounts.push(observed.completedQueries());
        return acquisitionTimes.shift() ?? new Date("2026-09-16T05:59:00.000Z");
      },
      refreshCommand,
    })).resolves.toEqual({
      status: "RECONNECT_REQUIRED",
      commandId: expect.any(String),
    });

    expect(observedClockQueryCounts).toEqual([3, 4]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("replays a concurrent durable success and performs exactly one provider request", async () => {
    await installFixture({ expiresAt: new Date("2026-09-16T04:00:00.000Z") });
    const fetchImpl = jest.fn(async () => successResponse()) as unknown as typeof fetch;
    let winnerRan = false;

    const result = await acquireSpotifyArtistReadCredential(userId, {
      db: serviceDb,
      env,
      fetchImpl,
      now: () => new Date(operationNow),
      attemptIdFactory: () => `spotify-artist-replay-${runId}`,
      hooks: {
        afterInitialSnapshotCommitted: async (snapshot) => {
          if (!snapshot) throw new Error("missing source snapshot");
          winnerRan = true;
          await expect(executeSpotifyRefreshCommand(userId, {
            db: serviceDb,
            env,
            fetchImpl,
            now: () => new Date(operationNow),
            attemptIdFactory: () => `spotify-artist-replay-${runId}`,
            expectedSource: {
              connectionId: snapshot.connectionId,
              providerAccountId: snapshot.providerAccountId,
              sourceVersionDigest: snapshot.versionDigest,
            },
          })).resolves.toMatchObject({ status: "SUCCEEDED" });
        },
      },
    });

    expect(winnerRan).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await db.spotifyRefreshCommand.count({ where: { userId } })).toBe(1);
    expect(result).toMatchObject({
      status: "READY",
      credential: { accessToken: `result-access-${runId}` },
    });
  });

  it("fails closed without provider contact when the source changes after Tx1", async () => {
    await installFixture({ expiresAt: new Date("2026-09-16T04:00:00.000Z") });
    const fetchImpl = jest.fn(async () => successResponse()) as unknown as typeof fetch;

    const result = await acquireSpotifyArtistReadCredential(userId, {
      db: serviceDb,
      env,
      fetchImpl,
      now: () => new Date(operationNow),
      hooks: {
        afterInitialSnapshotCommitted: async () => {
          await db.connectedAccount.update({
            where: { id: connectionId },
            data: {
              accessTokenEncrypted: encrypt(`rotated-access-${runId}`),
              expiresAt: new Date("2026-09-16T07:00:00.000Z"),
            },
          });
        },
      },
    });

    expect(result).toEqual({ status: "RECONNECT_REQUIRED" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await db.spotifyRefreshCommand.count({ where: { userId } })).toBe(0);
  });

  it("does not treat a transient success result as committed credential authority", async () => {
    await installFixture({ expiresAt: new Date("2026-09-16T04:00:00.000Z") });
    const refreshCommand = jest.fn(async () => ({
      status: "SUCCEEDED" as const,
      commandId: `missing-command-${runId}`,
      accessToken: "transient-only-token",
    }));

    const result = await acquireSpotifyArtistReadCredential(userId, {
      db: serviceDb,
      env,
      now: () => new Date(operationNow),
      refreshCommand,
    });

    expect(refreshCommand).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "RECONNECT_REQUIRED",
      commandId: `missing-command-${runId}`,
    });
  });

  it.each([
    ["NO_CONNECTION", { status: "NO_CONNECTION" as const }, { status: "NO_CONNECTION" }],
    ["IN_PROGRESS", { status: "IN_PROGRESS" as const, commandId: "command-in-progress" }, {
      status: "IN_PROGRESS",
      commandId: "command-in-progress",
    }],
    ["RECONNECT_REQUIRED", { status: "RECONNECT_REQUIRED" as const, commandId: "command-reconnect" }, {
      status: "RECONNECT_REQUIRED",
      commandId: "command-reconnect",
    }],
  ])("maps %s without attempting local credential fallback", async (_label, refreshResult, expected) => {
    await installFixture({ expiresAt: new Date("2026-09-16T04:00:00.000Z") });
    const refreshCommand = jest.fn(async () => refreshResult);

    await expect(acquireSpotifyArtistReadCredential(userId, {
      db: serviceDb,
      env,
      now: () => new Date(operationNow),
      refreshCommand,
    })).resolves.toEqual(expected);
    expect(refreshCommand).toHaveBeenCalledTimes(1);
  });

  it("rejects managed, banned, and unverified identities before refresh", async () => {
    const cases = [
      {
        fixture: {
          termsVersion: "primary-staging-only",
        },
        error: ManagedAccountSpotifyOperationError,
      },
      { fixture: { isBanned: true }, error: SpotifyRefreshAccessChangedError },
      { fixture: { phoneVerifiedAt: null }, error: SpotifyRefreshAccessChangedError },
    ];

    for (const testCase of cases) {
      await forceReset();
      await installFixture({
        expiresAt: new Date("2026-09-16T04:00:00.000Z"),
        ...testCase.fixture,
      });
      const refreshCommand = jest.fn();
      await expect(acquireSpotifyArtistReadCredential(userId, {
        db: serviceDb,
        env,
        now: () => new Date(operationNow),
        refreshCommand,
      })).rejects.toBeInstanceOf(testCase.error);
      expect(refreshCommand).not.toHaveBeenCalled();
    }
  });

  it("performs no refresh when Tx1 reports a serialization failure after callback work", async () => {
    await installFixture({ expiresAt: new Date("2026-09-16T04:00:00.000Z") });
    const wrapped = new Proxy(serviceDb, {
      get(target, property, receiver) {
        if (property !== "$transaction") return Reflect.get(target, property, receiver);
        return async (...args: unknown[]) => {
          await Reflect.apply(
            serviceDb.$transaction as unknown as (...values: unknown[]) => Promise<unknown>,
            serviceDb,
            args,
          );
          throw Object.assign(new Error("synthetic serialization failure"), { code: "P2034" });
        };
      },
    }) as typeof prisma;
    const refreshCommand = jest.fn();

    await expect(acquireSpotifyArtistReadCredential(userId, {
      db: wrapped,
      env,
      now: () => new Date(operationNow),
      refreshCommand,
    })).rejects.toMatchObject({ code: "P2034" });
    expect(refreshCommand).not.toHaveBeenCalled();
  });
});
