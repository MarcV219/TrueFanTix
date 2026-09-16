/** @jest-environment node */

import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  executeSpotifyRefreshCommand,
  SpotifyRefreshAccessChangedError,
} from "@/lib/integrations/spotify-refresh-command";
import { ManagedAccountSpotifyOperationError } from "@/lib/integrations/ordinary-spotify-user";
import { prisma } from "@/lib/prisma";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) describe.skip("Spotify refresh-command service", () => {
  it("requires an isolated database", () => undefined);
}); else describe("Spotify refresh-command service", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const serviceDb = db as unknown as typeof prisma;
  const runId = `${Date.now()}-${process.pid}`;
  const userId = `spotify-refresh-service-user-${runId}`;
  const connectionId = `spotify-refresh-service-connection-${runId}`;
  const encryptionSecret = "spotify-refresh-service-test-key-32-bytes";
  const sourceRefreshToken = `source-refresh-${runId}`;
  const env = {
    NODE_ENV: "test",
    SPOTIFY_TOKEN_ENCRYPTION_KEY: encryptionSecret,
    SPOTIFY_CLIENT_ID: "synthetic-client-id",
    SPOTIFY_CLIENT_SECRET: "synthetic-client-secret",
  } as NodeJS.ProcessEnv;

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

  async function installFixture(refreshCiphertext = encrypt(sourceRefreshToken)) {
    await db.user.create({
      data: {
        id: userId,
        email: `spotify-refresh-service-${runId}@example.test`,
        passwordHash: "synthetic-no-login",
        emailVerifiedAt: new Date("2026-09-16T00:00:00.000Z"),
        firstName: "Synthetic",
        lastName: "Listener",
        phone: `+1554${String(Date.now()).slice(-7)}`,
        phoneVerifiedAt: new Date("2026-09-16T00:00:00.000Z"),
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
        providerAccountId: `spotify-provider-${runId}`,
        accessTokenEncrypted: encrypt(`source-access-${runId}`),
        refreshTokenEncrypted: refreshCiphertext,
        tokenType: "Bearer",
        scope: "user-follow-read user-top-read",
        expiresAt: new Date("2026-09-16T04:00:00.000Z"),
      },
    });
  }

  function successResponse(overrides: Record<string, unknown> = {}) {
    return new Response(JSON.stringify({
      access_token: `result-access-${runId}`,
      refresh_token: `result-refresh-${runId}`,
      token_type: "Bearer",
      scope: "user-follow-read user-top-read",
      expires_in: 3_600,
      untrusted_provider_detail: `raw-body-marker-${runId}`,
      ...overrides,
    }), { status: 200 });
  }

  function databaseWithTransactionConflict(targetTransaction: number, timing: "before" | "after") {
    let transactionCalls = 0;
    let injected = false;
    const wrapped = new Proxy(serviceDb, {
      get(target, property, receiver) {
        if (property !== "$transaction") return Reflect.get(target, property, receiver);
        return async (...args: unknown[]) => {
          transactionCalls += 1;
          if (!injected && transactionCalls === targetTransaction && timing === "before") {
            injected = true;
            throw Object.assign(new Error("synthetic pre-provider serialization conflict"), { code: "P2034" });
          }
          const result = await Reflect.apply(
            serviceDb.$transaction as unknown as (...values: unknown[]) => Promise<unknown>,
            serviceDb,
            args,
          );
          if (!injected && transactionCalls === targetTransaction && timing === "after") {
            injected = true;
            throw Object.assign(new Error("synthetic pre-provider serialization conflict"), { code: "P2034" });
          }
          return result;
        };
      },
    }) as typeof prisma;
    return {
      db: wrapped,
      transactionCalls: () => transactionCalls,
      injected: () => injected,
    };
  }

  beforeEach(async () => {
    await forceReset();
    await installFixture();
  });

  afterAll(async () => {
    await forceReset();
    await db.$disconnect();
    await pool.end();
  });

  it("commits exact claim ownership before provider contact and atomically installs bounded success", async () => {
    const now = new Date("2026-09-16T05:00:00.000Z");
    const fetchImpl = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const command = await db.spotifyRefreshCommand.findFirstOrThrow({ where: { userId } });
      expect(command).toMatchObject({
        status: "ATTEMPTING",
        providerContactStatus: "NOT_CONTACTED",
        terminalAttemptId: null,
      });
      expect(command.claimedAt).toEqual(now);
      expect(String(init?.body)).toContain(`refresh_token=${encodeURIComponent(sourceRefreshToken)}`);
      return successResponse();
    }) as unknown as typeof fetch;

    await expect(executeSpotifyRefreshCommand(userId, {
      db: serviceDb,
      env,
      fetchImpl,
      now: () => new Date(now),
      attemptIdFactory: () => `service-attempt-success-${runId}`,
    })).resolves.toMatchObject({ status: "SUCCEEDED" });

    const [account, command] = await Promise.all([
      db.connectedAccount.findUniqueOrThrow({ where: { id: connectionId } }),
      db.spotifyRefreshCommand.findFirstOrThrow({ where: { userId } }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(command).toMatchObject({
      status: "SUCCEEDED",
      providerContactStatus: "CONTACTED",
      providerHttpStatus: 200,
      refreshTokenRotated: true,
      failureCode: null,
    });
    expect(command.terminalAttemptId).toBe(command.attemptId);
    expect(command.resultExpiresAt).toEqual(new Date("2026-09-16T06:00:00.000Z"));
    expect(account.currentRefreshCommandId).toBe(command.id);
    expect(account.accessTokenEncrypted).not.toContain(`result-access-${runId}`);
    expect(account.refreshTokenEncrypted).not.toContain(`result-refresh-${runId}`);
    const durableEvidence = JSON.stringify({ account, command });
    expect(durableEvidence).not.toContain(`result-access-${runId}`);
    expect(durableEvidence).not.toContain(`result-refresh-${runId}`);
    expect(durableEvidence).not.toContain(`raw-body-marker-${runId}`);
    expect(durableEvidence).not.toContain("synthetic-client-secret");
  });

  it("gives simultaneous first-call staging one command and one provider dispatch winner", async () => {
    let stagedCallers = 0;
    let releaseStagedCallers!: () => void;
    const bothStaged = new Promise<void>((resolve) => { releaseStagedCallers = resolve; });
    const fetchImpl = jest.fn(async () => successResponse()) as unknown as typeof fetch;
    const options = {
      db: serviceDb,
      env,
      fetchImpl,
      now: () => new Date("2026-09-16T05:10:00.000Z"),
      attemptIdFactory: () => `service-attempt-concurrent-${runId}`,
      testHooks: {
        afterStageCommitted: async () => {
          stagedCallers += 1;
          if (stagedCallers === 2) releaseStagedCallers();
          await bothStaged;
        },
      },
    };

    const results = await Promise.all([
      executeSpotifyRefreshCommand(userId, options),
      executeSpotifyRefreshCommand(userId, options),
    ]);
    expect(results.every((result) => ["IN_PROGRESS", "SUCCEEDED"].includes(result.status))).toBe(true);
    expect(results.some((result) => result.status === "SUCCEEDED")).toBe(true);
    expect(await db.spotifyRefreshCommand.count({ where: { userId } })).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["stage", 1, "after"],
    ["claim", 2, "before"],
  ] as const)("safely retries a pre-provider %s serialization conflict", async (
    _label,
    targetTransaction,
    timing,
  ) => {
    const fault = databaseWithTransactionConflict(targetTransaction, timing);
    const fetchImpl = jest.fn(async () => {
      expect(fault.injected()).toBe(true);
      expect(fault.transactionCalls()).toBeGreaterThan(targetTransaction);
      const command = await db.spotifyRefreshCommand.findFirstOrThrow({ where: { userId } });
      expect(command.status).toBe("ATTEMPTING");
      return successResponse();
    }) as unknown as typeof fetch;

    await expect(executeSpotifyRefreshCommand(userId, {
      db: fault.db,
      env,
      fetchImpl,
      attemptIdFactory: () => `service-attempt-retry-${_label}-${runId}`,
    })).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await db.spotifyRefreshCommand.count({ where: { userId } })).toBe(1);
  });

  it("observes an ambiguously committed claim without crossing the provider boundary", async () => {
    const fault = databaseWithTransactionConflict(2, "after");
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    await expect(executeSpotifyRefreshCommand(userId, {
      db: fault.db,
      env,
      fetchImpl,
      attemptIdFactory: () => `service-attempt-ambiguous-claim-${runId}`,
    })).resolves.toMatchObject({ status: "IN_PROGRESS" });
    expect(fault.injected()).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(db.spotifyRefreshCommand.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({ status: "ATTEMPTING", providerContactStatus: "NOT_CONTACTED" });
  });

  it("records pre-contact input failure once and replays terminal evidence without provider I/O", async () => {
    await forceReset();
    await installFixture("not-valid-ciphertext");
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    const options = {
      db: serviceDb,
      env,
      fetchImpl,
      now: () => new Date("2026-09-16T05:20:00.000Z"),
      attemptIdFactory: () => `service-attempt-input-${runId}`,
    };

    await expect(executeSpotifyRefreshCommand(userId, options))
      .resolves.toMatchObject({ status: "RECONNECT_REQUIRED" });
    await expect(executeSpotifyRefreshCommand(userId, options))
      .resolves.toMatchObject({ status: "RECONNECT_REQUIRED" });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(db.spotifyRefreshCommand.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({
        status: "RECONNECT_REQUIRED",
        providerContactStatus: "NOT_CONTACTED",
        providerHttpStatus: null,
        failureCode: "REFRESH_INPUT_UNAVAILABLE",
      });
  });

  it.each([
    {
      label: "provider rejection",
      fetchImpl: jest.fn(async () => new Response(`provider-secret-${runId}`, { status: 401 })),
      contact: "CONTACTED",
      http: 401,
      failure: "PROVIDER_REJECTED",
    },
    {
      label: "invalid bounded success",
      fetchImpl: jest.fn(async () => successResponse({ access_token: "x".repeat(16_385) })),
      contact: "CONTACTED",
      http: 200,
      failure: "PROVIDER_INVALID_RESPONSE",
    },
    {
      label: "transport ambiguity",
      fetchImpl: jest.fn(async () => { throw new Error(`transport-secret-${runId}`); }),
      contact: "CONTACT_UNCERTAIN",
      http: null,
      failure: "PROVIDER_OUTCOME_UNCERTAIN",
    },
  ])("records truthful bounded $label evidence without raw provider detail", async (scenario) => {
    await executeSpotifyRefreshCommand(userId, {
      db: serviceDb,
      env,
      fetchImpl: scenario.fetchImpl as unknown as typeof fetch,
      now: () => new Date("2026-09-16T05:30:00.000Z"),
      attemptIdFactory: () => `service-attempt-${scenario.failure.toLowerCase()}-${runId}`,
    });
    const command = await db.spotifyRefreshCommand.findFirstOrThrow({ where: { userId } });
    expect(command).toMatchObject({
      status: "RECONNECT_REQUIRED",
      providerContactStatus: scenario.contact,
      providerHttpStatus: scenario.http,
      failureCode: scenario.failure,
    });
    expect(JSON.stringify(command)).not.toContain(`provider-secret-${runId}`);
    expect(JSON.stringify(command)).not.toContain(`transport-secret-${runId}`);
  });

  it("classifies a provider timeout as contact-uncertain and aborts the request", async () => {
    let observedSignal: AbortSignal | null = null;
    const fetchImpl = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      observedSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;
    await expect(executeSpotifyRefreshCommand(userId, {
      db: serviceDb,
      env,
      fetchImpl,
      providerTimeoutMs: 5,
      attemptIdFactory: () => `service-attempt-timeout-${runId}`,
    })).resolves.toMatchObject({ status: "RECONNECT_REQUIRED" });
    expect((observedSignal as unknown as AbortSignal).aborted).toBe(true);
    await expect(db.spotifyRefreshCommand.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({
        status: "RECONNECT_REQUIRED",
        providerContactStatus: "CONTACT_UNCERTAIN",
        failureCode: "PROVIDER_OUTCOME_UNCERTAIN",
      });
  });

  it.each([
    ["banned", { isBanned: true }],
    ["email-unverified", { emailVerifiedAt: null }],
    ["phone-unverified", { phoneVerifiedAt: null }],
  ] as const)("refuses %s access before staging with zero provider work", async (_label, data) => {
    await db.user.update({ where: { id: userId }, data });
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    await expect(executeSpotifyRefreshCommand(userId, {
      db: serviceDb,
      env,
      fetchImpl,
    })).rejects.toBeInstanceOf(SpotifyRefreshAccessChangedError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await db.spotifyRefreshCommand.count({ where: { userId } })).toBe(0);
  });

  it.each([
    ["banned", { isBanned: true }],
    ["unverified", { emailVerifiedAt: null }],
  ] as const)("refuses %s access restored between stage and claim with zero provider work", async (
    _label,
    data,
  ) => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    await expect(executeSpotifyRefreshCommand(userId, {
      db: serviceDb,
      env,
      fetchImpl,
      attemptIdFactory: () => `service-attempt-access-before-claim-${_label}-${runId}`,
      testHooks: {
        afterStageCommitted: async () => {
          await db.user.update({ where: { id: userId }, data });
        },
      },
    })).rejects.toBeInstanceOf(SpotifyRefreshAccessChangedError);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(db.spotifyRefreshCommand.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({ status: "PENDING", claimedAt: null });
  });

  it("refuses source drift and managed-persona restoration before claim with zero provider work", async () => {
    const sourceDriftFetch = jest.fn() as unknown as typeof fetch;
    await expect(executeSpotifyRefreshCommand(userId, {
      db: serviceDb,
      env,
      fetchImpl: sourceDriftFetch,
      attemptIdFactory: () => `service-attempt-source-drift-${runId}`,
      testHooks: {
        afterStageCommitted: async () => {
          await db.connectedAccount.update({
            where: { id: connectionId },
            data: { accessTokenEncrypted: encrypt("concurrent-access-version") },
          });
        },
      },
    })).resolves.toMatchObject({ status: "RECONNECT_REQUIRED" });
    expect(sourceDriftFetch).not.toHaveBeenCalled();
    await expect(db.spotifyRefreshCommand.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({ status: "PENDING", claimedAt: null });

    await forceReset();
    await installFixture();
    const restoredFetch = jest.fn() as unknown as typeof fetch;
    await expect(executeSpotifyRefreshCommand(userId, {
      db: serviceDb,
      env,
      fetchImpl: restoredFetch,
      attemptIdFactory: () => `service-attempt-restored-before-claim-${runId}`,
      testHooks: {
        afterStageCommitted: async () => {
          await db.user.update({
            where: { id: userId },
            data: { termsVersion: "primary-staging-only" },
          });
        },
      },
    })).rejects.toBeInstanceOf(ManagedAccountSpotifyOperationError);
    expect(restoredFetch).not.toHaveBeenCalled();
    await expect(db.spotifyRefreshCommand.findFirstOrThrow({ where: { userId } }))
      .resolves.toMatchObject({ status: "PENDING", claimedAt: null });
  });

  it("refuses final projection after persona restoration and records exact provider success as local failure", async () => {
    const originalAccount = await db.connectedAccount.findUniqueOrThrow({ where: { id: connectionId } });
    const fetchImpl = jest.fn(async () => {
      await db.user.update({
        where: { id: userId },
        data: { privacyVersion: "primary-staging-only" },
      });
      return successResponse();
    }) as unknown as typeof fetch;
    await expect(executeSpotifyRefreshCommand(userId, {
      db: serviceDb,
      env,
      fetchImpl,
      now: () => new Date("2026-09-16T05:40:00.000Z"),
      attemptIdFactory: () => `service-attempt-restored-before-finalize-${runId}`,
    })).resolves.toMatchObject({ status: "RECONNECT_REQUIRED" });

    const [account, command] = await Promise.all([
      db.connectedAccount.findUniqueOrThrow({ where: { id: connectionId } }),
      db.spotifyRefreshCommand.findFirstOrThrow({ where: { userId } }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(account.accessTokenEncrypted).toBe(originalAccount.accessTokenEncrypted);
    expect(account.refreshTokenEncrypted).toBe(originalAccount.refreshTokenEncrypted);
    expect(account.currentRefreshCommandId).toBeNull();
    expect(command).toMatchObject({
      status: "RECONNECT_REQUIRED",
      providerContactStatus: "CONTACTED",
      providerHttpStatus: 200,
      resultExpiresAt: new Date("2026-09-16T06:40:00.000Z"),
      refreshTokenRotated: true,
      failureCode: "LOCAL_FINALIZATION_FAILED",
    });
  });

  it.each([
    ["banned", { isBanned: true }],
    ["unverified", { phoneVerifiedAt: null }],
  ] as const)("records local failure when provider success is followed by %s access restoration", async (
    _label,
    data,
  ) => {
    const originalAccount = await db.connectedAccount.findUniqueOrThrow({ where: { id: connectionId } });
    const fetchImpl = jest.fn(async () => {
      await db.user.update({ where: { id: userId }, data });
      return successResponse();
    }) as unknown as typeof fetch;
    await expect(executeSpotifyRefreshCommand(userId, {
      db: serviceDb,
      env,
      fetchImpl,
      now: () => new Date("2026-09-16T05:45:00.000Z"),
      attemptIdFactory: () => `service-attempt-access-before-finalize-${_label}-${runId}`,
    })).resolves.toMatchObject({ status: "RECONNECT_REQUIRED" });

    const [account, command] = await Promise.all([
      db.connectedAccount.findUniqueOrThrow({ where: { id: connectionId } }),
      db.spotifyRefreshCommand.findFirstOrThrow({ where: { userId } }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(account.accessTokenEncrypted).toBe(originalAccount.accessTokenEncrypted);
    expect(account.refreshTokenEncrypted).toBe(originalAccount.refreshTokenEncrypted);
    expect(account.currentRefreshCommandId).toBeNull();
    expect(command).toMatchObject({
      status: "RECONNECT_REQUIRED",
      providerContactStatus: "CONTACTED",
      providerHttpStatus: 200,
      resultExpiresAt: new Date("2026-09-16T06:45:00.000Z"),
      refreshTokenRotated: true,
      failureCode: "LOCAL_FINALIZATION_FAILED",
    });
  });

  it("rejects a corrupted wrong attempt owner after provider contact without installing credentials", async () => {
    const originalAccount = await db.connectedAccount.findUniqueOrThrow({ where: { id: connectionId } });
    const fetchImpl = jest.fn(async () => successResponse()) as unknown as typeof fetch;
    await executeSpotifyRefreshCommand(userId, {
      db: serviceDb,
      env,
      fetchImpl,
      attemptIdFactory: () => `service-attempt-exact-owner-${runId}`,
      testHooks: {
        afterClaimCommitted: async (claimed) => {
          await db.$transaction(async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
            await tx.spotifyRefreshCommand.update({
              where: { id: claimed.commandId },
              data: { attemptId: `corrupted-attempt-${runId}` },
            });
          });
        },
      },
    });

    const [account, command] = await Promise.all([
      db.connectedAccount.findUniqueOrThrow({ where: { id: connectionId } }),
      db.spotifyRefreshCommand.findFirstOrThrow({ where: { userId } }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(account.accessTokenEncrypted).toBe(originalAccount.accessTokenEncrypted);
    expect(account.currentRefreshCommandId).toBeNull();
    expect(command).toMatchObject({ status: "ATTEMPTING", terminalAttemptId: null });
  });

  it("supersedes the current projection with a distinct second successful refresh", async () => {
    let sequence = 0;
    const fetchImpl = jest.fn(async () => {
      sequence += 1;
      return successResponse({
        access_token: `result-access-${sequence}-${runId}`,
        refresh_token: `result-refresh-${sequence}-${runId}`,
      });
    }) as unknown as typeof fetch;
    const now = () => new Date(`2026-09-16T0${5 + sequence}:50:00.000Z`);

    await expect(executeSpotifyRefreshCommand(userId, {
      db: serviceDb,
      env,
      fetchImpl,
      now,
      attemptIdFactory: () => `service-attempt-first-${runId}`,
    })).resolves.toMatchObject({ status: "SUCCEEDED" });
    const firstOwner = (await db.connectedAccount.findUniqueOrThrow({ where: { id: connectionId } }))
      .currentRefreshCommandId;
    await expect(executeSpotifyRefreshCommand(userId, {
      db: serviceDb,
      env,
      fetchImpl,
      now,
      attemptIdFactory: () => `service-attempt-second-${runId}`,
    })).resolves.toMatchObject({ status: "SUCCEEDED" });

    const [account, commands] = await Promise.all([
      db.connectedAccount.findUniqueOrThrow({ where: { id: connectionId } }),
      db.spotifyRefreshCommand.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(commands).toHaveLength(2);
    expect(commands.every((command) => command.status === "SUCCEEDED")).toBe(true);
    expect(account.currentRefreshCommandId).toBe(commands[1].id);
    expect(account.currentRefreshCommandId).not.toBe(firstOwner);
  });
});
