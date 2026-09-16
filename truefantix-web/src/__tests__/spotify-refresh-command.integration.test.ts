/** @jest-environment node */

import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;

if (!databaseUrl) describe.skip("Spotify refresh-command PostgreSQL boundary", () => {
  it("requires an isolated database", () => undefined);
}); else describe("Spotify refresh-command PostgreSQL boundary", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  const runId = `${Date.now()}-${process.pid}`;
  const userId = `spotify-refresh-user-${runId}`;
  const connectionId = `spotify-refresh-connection-${runId}`;
  const providerAccountId = `spotify-account-${runId}`;

  async function forceReset() {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.connectedAccount.deleteMany({ where: { userId } });
      await tx.spotifyRefreshCommand.deleteMany({ where: { userId } });
      await tx.user.deleteMany({ where: { id: userId } });
    });
  }

  async function installFixture(id = connectionId) {
    if (!await db.user.findUnique({ where: { id: userId } })) {
      await db.user.create({
        data: {
          id: userId,
          email: `spotify-refresh-${runId}@example.test`,
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
    }
    return db.connectedAccount.create({
      data: {
        id,
        userId,
        provider: "spotify",
        providerAccountId,
        accessTokenEncrypted: `encrypted-access-${id}`,
        refreshTokenEncrypted: `encrypted-refresh-${id}`,
        tokenType: "Bearer",
        scope: "user-follow-read user-top-read",
        expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
  }

  async function currentDigest(id = connectionId, client: PrismaClient = db) {
    const [{ digest }] = await client.$queryRaw<Array<{ digest: string }>>`
      SELECT spotify_connected_account_version_digest(c) AS digest
      FROM "ConnectedAccount" c
      WHERE c.id = ${id}
    `;
    return digest;
  }

  async function stage(id = connectionId) {
    const account = await db.connectedAccount.findUniqueOrThrow({ where: { id } });
    return db.spotifyRefreshCommand.create({
      data: {
        userId,
        connectionId: id,
        provider: "spotify",
        providerAccountId: account.providerAccountId,
        sourceVersionDigest: await currentDigest(id),
        sourceExpiresAt: account.expiresAt,
        sourceUpdatedAt: account.updatedAt,
        attemptId: `attempt-${crypto.randomUUID()}`,
      },
    });
  }

  async function claim(commandId: string) {
    return db.spotifyRefreshCommand.updateMany({
      where: { id: commandId, status: "PENDING" },
      data: { status: "ATTEMPTING", claimedAt: new Date() },
    });
  }

  async function succeed(commandId: string, accessCiphertext: string, expiresAt: Date) {
    return db.$transaction(async (tx) => {
      const command = await tx.spotifyRefreshCommand.findUniqueOrThrow({ where: { id: commandId } });
      const projected = await tx.connectedAccount.update({
        where: { id: command.connectionId },
        data: {
          accessTokenEncrypted: accessCiphertext,
          expiresAt,
          currentRefreshCommandId: command.id,
        },
      });
      const [{ digest }] = await tx.$queryRaw<Array<{ digest: string }>>`
        SELECT spotify_connected_account_version_digest(c) AS digest
        FROM "ConnectedAccount" c
        WHERE c.id = ${command.connectionId}
      `;
      await tx.spotifyRefreshCommand.update({
        where: { id: command.id },
        data: {
          status: "SUCCEEDED",
          terminalAttemptId: command.attemptId,
          providerContactStatus: "CONTACTED",
          providerHttpStatus: 200,
          resultVersionDigest: digest,
          resultExpiresAt: expiresAt,
          refreshTokenRotated: false,
          completedAt: projected.updatedAt,
        },
      });
      return { projected, digest };
    });
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

  it("enforces one immutable command identity for each exact source version", async () => {
    const command = await stage();
    await expect(db.spotifyRefreshCommand.create({
      data: {
        userId,
        connectionId,
        provider: "spotify",
        providerAccountId,
        sourceVersionDigest: command.sourceVersionDigest,
        sourceExpiresAt: command.sourceExpiresAt,
        sourceUpdatedAt: command.sourceUpdatedAt,
        attemptId: `duplicate-${crypto.randomUUID()}`,
      },
    })).rejects.toMatchObject({ code: "P2002" });
    await expect(db.spotifyRefreshCommand.update({
      where: { id: command.id },
      data: { attemptId: `changed-${crypto.randomUUID()}` },
    })).rejects.toThrow("ownership evidence is immutable");
  });

  it("gives concurrent claims one owner and never reclaims ATTEMPTING", async () => {
    const command = await stage();
    const claims = await Promise.all([claim(command.id), claim(command.id)]);
    expect(claims.map((result) => result.count).sort()).toEqual([0, 1]);
    await expect(claim(command.id)).resolves.toMatchObject({ count: 0 });
    await expect(db.spotifyRefreshCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({ status: "ATTEMPTING", providerContactStatus: "NOT_CONTACTED" });
  });

  it("rejects wrong-attempt reconnect terminalization and accepts the exact owner", async () => {
    const command = await stage();
    await claim(command.id);
    await expect(db.spotifyRefreshCommand.update({
      where: { id: command.id },
      data: {
        status: "RECONNECT_REQUIRED",
        terminalAttemptId: `wrong-${crypto.randomUUID()}`,
        providerContactStatus: "NOT_CONTACTED",
        failureCode: "REFRESH_INPUT_UNAVAILABLE",
        completedAt: new Date(),
      },
    })).rejects.toThrow("Invalid Spotify refresh reconnect evidence");
    await expect(db.spotifyRefreshCommand.update({
      where: { id: command.id },
      data: {
        status: "RECONNECT_REQUIRED",
        terminalAttemptId: command.attemptId,
        providerContactStatus: "NOT_CONTACTED",
        failureCode: "REFRESH_INPUT_UNAVAILABLE",
        completedAt: new Date(),
      },
    })).resolves.toMatchObject({
      status: "RECONNECT_REQUIRED",
      terminalAttemptId: command.attemptId,
    });
  });

  it("rejects wrong-attempt success terminalization and accepts the exact owner", async () => {
    const command = await stage();
    await claim(command.id);
    await expect(db.$transaction(async (tx) => {
      const expiresAt = new Date("2027-01-01T00:00:00.000Z");
      await tx.connectedAccount.update({
        where: { id: connectionId },
        data: {
          accessTokenEncrypted: "wrong-attempt-result-ciphertext",
          expiresAt,
          currentRefreshCommandId: command.id,
        },
      });
      const [{ digest }] = await tx.$queryRaw<Array<{ digest: string }>>`
        SELECT spotify_connected_account_version_digest(c) AS digest
        FROM "ConnectedAccount" c
        WHERE c.id = ${connectionId}
      `;
      await tx.spotifyRefreshCommand.update({
        where: { id: command.id },
        data: {
          status: "SUCCEEDED",
          terminalAttemptId: `wrong-${crypto.randomUUID()}`,
          providerContactStatus: "CONTACTED",
          providerHttpStatus: 200,
          resultVersionDigest: digest,
          resultExpiresAt: expiresAt,
          refreshTokenRotated: false,
          completedAt: new Date(),
        },
      });
    })).rejects.toThrow("Invalid Spotify refresh success evidence");

    await succeed(command.id, "exact-attempt-result-ciphertext", new Date("2027-01-01T00:00:00.000Z"));
    await expect(db.spotifyRefreshCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({ status: "SUCCEEDED", terminalAttemptId: command.attemptId });
  });

  it("records truthful bounded pre-contact terminal evidence", async () => {
    const command = await stage();
    await claim(command.id);
    await db.spotifyRefreshCommand.update({
      where: { id: command.id },
      data: {
        status: "RECONNECT_REQUIRED",
        terminalAttemptId: command.attemptId,
        providerContactStatus: "NOT_CONTACTED",
        failureCode: "REFRESH_INPUT_UNAVAILABLE",
        completedAt: new Date(),
      },
    });
    await expect(db.spotifyRefreshCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({
        status: "RECONNECT_REQUIRED",
        terminalAttemptId: command.attemptId,
        providerContactStatus: "NOT_CONTACTED",
        providerHttpStatus: null,
        resultVersionDigest: null,
        failureCode: "REFRESH_INPUT_UNAVAILABLE",
      });
    await expect(db.spotifyRefreshCommand.update({
      where: { id: command.id },
      data: { failureCode: "SOURCE_VERSION_CHANGED" },
    })).rejects.toThrow("outcome evidence cannot be overwritten");
  });

  it.each([
    ["pre-contact provider rejection", "NOT_CONTACTED", "PROVIDER_REJECTED", null, null, null],
    ["uncertain pre-contact failure", "CONTACT_UNCERTAIN", "REFRESH_INPUT_UNAVAILABLE", null, null, null],
    ["HTTP-200 provider rejection", "CONTACTED", "PROVIDER_REJECTED", 200, null, null],
    ["HTTP-500 invalid success envelope", "CONTACTED", "PROVIDER_INVALID_RESPONSE", 500, null, null],
    ["incomplete local-finalization evidence", "CONTACTED", "LOCAL_FINALIZATION_FAILED", 200, null, null],
  ] as const)("rejects false terminal classification: %s", async (
    _label,
    providerContactStatus,
    failureCode,
    providerHttpStatus,
    resultExpiresAt,
    refreshTokenRotated,
  ) => {
    const command = await stage();
    await claim(command.id);
    await expect(db.spotifyRefreshCommand.update({
      where: { id: command.id },
      data: {
        status: "RECONNECT_REQUIRED",
        terminalAttemptId: command.attemptId,
        providerContactStatus,
        providerHttpStatus,
        resultExpiresAt,
        refreshTokenRotated,
        failureCode,
        completedAt: new Date(),
      },
    })).rejects.toThrow("Invalid Spotify refresh reconnect evidence");
    await expect(db.spotifyRefreshCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({ status: "ATTEMPTING", providerContactStatus: "NOT_CONTACTED" });
  });

  it.each([
    ["uncertain outcome", "CONTACT_UNCERTAIN", "PROVIDER_OUTCOME_UNCERTAIN", null, null, null],
    ["provider rejection", "CONTACTED", "PROVIDER_REJECTED", 401, null, null],
    ["invalid success envelope", "CONTACTED", "PROVIDER_INVALID_RESPONSE", 200, null, null],
    [
      "local finalization failure",
      "CONTACTED",
      "LOCAL_FINALIZATION_FAILED",
      200,
      new Date("2027-01-01T00:00:00.000Z"),
      false,
    ],
  ] as const)("accepts exact terminal classification: %s", async (
    _label,
    providerContactStatus,
    failureCode,
    providerHttpStatus,
    resultExpiresAt,
    refreshTokenRotated,
  ) => {
    const command = await stage();
    await claim(command.id);
    await expect(db.spotifyRefreshCommand.update({
      where: { id: command.id },
      data: {
        status: "RECONNECT_REQUIRED",
        terminalAttemptId: command.attemptId,
        providerContactStatus,
        providerHttpStatus,
        resultExpiresAt,
        refreshTokenRotated,
        failureCode,
        completedAt: new Date(),
      },
    })).resolves.toMatchObject({ status: "RECONNECT_REQUIRED", failureCode });
  });

  it.each([
    ["missing", null],
    ["mismatched", new Date("2028-01-01T00:00:00.000Z")],
  ] as const)("rejects %s expiry on otherwise matching success evidence", async (_label, evidenceExpiry) => {
    const command = await stage();
    await claim(command.id);
    await expect(db.$transaction(async (tx) => {
      const projectionExpiry = new Date("2027-01-01T00:00:00.000Z");
      await tx.connectedAccount.update({
        where: { id: connectionId },
        data: {
          accessTokenEncrypted: `expiry-result-${_label}`,
          expiresAt: projectionExpiry,
          currentRefreshCommandId: command.id,
        },
      });
      const [{ digest }] = await tx.$queryRaw<Array<{ digest: string }>>`
        SELECT spotify_connected_account_version_digest(c) AS digest
        FROM "ConnectedAccount" c
        WHERE c.id = ${connectionId}
      `;
      await tx.spotifyRefreshCommand.update({
        where: { id: command.id },
        data: {
          status: "SUCCEEDED",
          terminalAttemptId: command.attemptId,
          providerContactStatus: "CONTACTED",
          providerHttpStatus: 200,
          resultVersionDigest: digest,
          resultExpiresAt: evidenceExpiry,
          refreshTokenRotated: false,
          completedAt: new Date(),
        },
      });
    })).rejects.toThrow("Invalid Spotify refresh success evidence");
  });

  it("rejects source drift, illegal transitions, evidence overwrite, delete, and truncate", async () => {
    const command = await stage();
    await db.connectedAccount.update({
      where: { id: connectionId },
      data: { accessTokenEncrypted: "concurrent-source-ciphertext" },
    });
    await expect(claim(command.id)).rejects.toThrow("Invalid Spotify refresh claim");
    await expect(db.spotifyRefreshCommand.update({
      where: { id: command.id },
      data: {
        status: "SUCCEEDED",
        terminalAttemptId: command.attemptId,
        providerContactStatus: "CONTACTED",
        providerHttpStatus: 200,
        resultVersionDigest: "b".repeat(64),
        refreshTokenRotated: false,
        completedAt: new Date(),
      },
    })).rejects.toThrow("Invalid Spotify refresh command state transition");
    await expect(db.spotifyRefreshCommand.delete({ where: { id: command.id } }))
      .rejects.toThrow("evidence cannot be deleted");
    await expect(db.$executeRawUnsafe('TRUNCATE TABLE "SpotifyRefreshCommand" CASCADE'))
      .rejects.toThrow("evidence cannot be truncated");
  });

  it("rejects both partial directions of the deferred success/current-projection pair", async () => {
    const command = await stage();
    await claim(command.id);
    await expect(db.$transaction(async (tx) => {
      await tx.connectedAccount.update({
        where: { id: connectionId },
        data: {
          accessTokenEncrypted: "partial-result-ciphertext",
          expiresAt: new Date("2027-01-01T00:00:00.000Z"),
          currentRefreshCommandId: command.id,
        },
      });
    })).rejects.toThrow("current projection requires exact succeeded ownership");
    await expect(db.spotifyRefreshCommand.update({
      where: { id: command.id },
      data: {
        status: "SUCCEEDED",
        terminalAttemptId: command.attemptId,
        providerContactStatus: "CONTACTED",
        providerHttpStatus: 200,
        resultVersionDigest: "c".repeat(64),
        refreshTokenRotated: false,
        completedAt: new Date(),
      },
    })).rejects.toThrow("Invalid Spotify refresh success evidence");
  });

  it("atomically supersedes the movable current owner while preserving historical success", async () => {
    const first = await stage();
    await claim(first.id);
    await succeed(first.id, "first-result-ciphertext", new Date("2026-01-02T00:00:00.000Z"));
    const second = await stage();
    await claim(second.id);
    await succeed(second.id, "second-result-ciphertext", new Date("2027-01-01T00:00:00.000Z"));

    const [commands, account] = await Promise.all([
      db.spotifyRefreshCommand.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      db.connectedAccount.findUniqueOrThrow({ where: { id: connectionId } }),
    ]);
    expect(commands).toHaveLength(2);
    expect(commands.every((command) => command.status === "SUCCEEDED")).toBe(true);
    expect(account.currentRefreshCommandId).toBe(second.id);
    expect(account.currentRefreshCommandId).not.toBe(first.id);
  });

  it("keeps history across disconnect and prevents an old generation from owning reconnect", async () => {
    const command = await stage();
    await claim(command.id);
    await succeed(command.id, "success-before-disconnect", new Date("2027-01-01T00:00:00.000Z"));
    await db.connectedAccount.delete({ where: { id: connectionId } });
    await expect(installFixture(connectionId))
      .rejects.toThrow("cannot reuse a historical connection identity");
    const reconnected = await installFixture(`spotify-refresh-reconnected-${runId}`);

    expect(reconnected.currentRefreshCommandId).toBeNull();
    await expect(db.spotifyRefreshCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .resolves.toMatchObject({ connectionId, status: "SUCCEEDED" });
    await expect(db.connectedAccount.update({
      where: { id: reconnected.id },
      data: { currentRefreshCommandId: command.id },
    })).rejects.toThrow("not owned by the exact attempting command");
  });
});
