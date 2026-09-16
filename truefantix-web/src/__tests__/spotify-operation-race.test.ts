/** @jest-environment node */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { sendEmail } from "@/lib/email";
import { drainSpotifyCatalogRequestDeliveries } from "@/lib/integrations/spotify-catalog-request-delivery";
import {
  disconnectSpotify,
  exchangeSpotifyCode,
  getSpotifyConnectionEvidence,
  hasSpotifyConnection,
  snapshotSpotifyConnectionAuthorization,
  spotifyAccountRedirectUrl,
  spotifyAuthorizeUrl,
  spotifyConfigured,
  storeSpotifyConnection,
} from "@/lib/integrations/spotify";
import {
  importSpotifyArtistSnapshot,
  readSpotifyArtistSnapshot,
} from "@/lib/integrations/spotify-artist-read";
import { ManagedAccountSpotifyOperationError } from "@/lib/integrations/ordinary-spotify-user";
import { GET as startSpotify } from "@/app/api/integrations/spotify/start/route";
import { GET as getConnection, DELETE as deleteConnection } from "@/app/api/integrations/spotify/connection/route";
import { GET as getArtists, POST as importArtists } from "@/app/api/integrations/spotify/artists/route";
import { GET as spotifyCallback } from "@/app/api/integrations/spotify/callback/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    connectedAccount: { findUnique: jest.fn(), deleteMany: jest.fn() },
    catalogEntity: { findUnique: jest.fn() },
    notificationPreference: { upsert: jest.fn() },
    catalogRequest: { upsert: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({ requireUser: jest.fn() }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }));
jest.mock("@/lib/integrations/spotify-catalog-request-delivery", () => ({
  drainSpotifyCatalogRequestDeliveries: jest.fn(),
}));
jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/integrations/spotify-artist-read", () => ({
  importSpotifyArtistSnapshot: jest.fn(),
  readSpotifyArtistSnapshot: jest.fn(),
}));
jest.mock("@/lib/integrations/spotify", () => ({
  disconnectSpotify: jest.fn(),
  exchangeSpotifyCode: jest.fn(),
  getSpotifyConnectionEvidence: jest.fn(),
  hasSpotifyConnection: jest.fn(),
  snapshotSpotifyConnectionAuthorization: jest.fn(),
  spotifyAccountRedirectUrl: jest.fn(),
  spotifyAuthorizeUrl: jest.fn(),
  spotifyConfigured: jest.fn(),
  storeSpotifyConnection: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  connectedAccount: { findUnique: jest.Mock; deleteMany: jest.Mock };
  catalogEntity: { findUnique: jest.Mock };
  notificationPreference: { upsert: jest.Mock };
  catalogRequest: { upsert: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireUser = requireUser as jest.MockedFunction<typeof requireUser>;
const mockedCookies = cookies as jest.MockedFunction<typeof cookies>;
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;
const mockedDrainSpotifyCatalogRequestDeliveries = drainSpotifyCatalogRequestDeliveries as jest.MockedFunction<
  typeof drainSpotifyCatalogRequestDeliveries
>;
const mockedDisconnectSpotify = disconnectSpotify as jest.MockedFunction<typeof disconnectSpotify>;
const mockedExchangeSpotifyCode = exchangeSpotifyCode as jest.MockedFunction<typeof exchangeSpotifyCode>;
const mockedGetSpotifyConnectionEvidence = getSpotifyConnectionEvidence as jest.MockedFunction<
  typeof getSpotifyConnectionEvidence
>;
const mockedImportSpotifyArtistSnapshot = importSpotifyArtistSnapshot as jest.MockedFunction<
  typeof importSpotifyArtistSnapshot
>;
const mockedReadSpotifyArtistSnapshot = readSpotifyArtistSnapshot as jest.MockedFunction<
  typeof readSpotifyArtistSnapshot
>;
const mockedHasSpotifyConnection = hasSpotifyConnection as jest.MockedFunction<typeof hasSpotifyConnection>;
const mockedSnapshotSpotifyConnectionAuthorization = snapshotSpotifyConnectionAuthorization as jest.MockedFunction<
  typeof snapshotSpotifyConnectionAuthorization
>;
const mockedSpotifyAccountRedirectUrl = spotifyAccountRedirectUrl as jest.MockedFunction<
  typeof spotifyAccountRedirectUrl
>;
const mockedSpotifyAuthorizeUrl = spotifyAuthorizeUrl as jest.MockedFunction<typeof spotifyAuthorizeUrl>;
const mockedSpotifyConfigured = spotifyConfigured as jest.MockedFunction<typeof spotifyConfigured>;
const mockedStoreSpotifyConnection = storeSpotifyConnection as jest.MockedFunction<typeof storeSpotifyConnection>;

const ordinaryUser = {
  id: "user-1",
  email: "ordinary@example.test",
  phone: "+14165550199",
  firstName: "Ordinary",
  lastName: "User",
  termsVersion: "v1",
  privacyVersion: "v1",
};

const managedUser = {
  ...ordinaryUser,
  email: "reviewer@primary-staging.example.invalid",
  phone: "+15550001003",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
};

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`https://preview.example${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function expectPrivateStateCleared(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("set-cookie")).toContain("tft_spotify_oauth_state=");
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
}

describe("Spotify staging-persona operation boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRequireUser.mockResolvedValue({ ok: true, user: ordinaryUser } as never);
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedHasSpotifyConnection.mockResolvedValue(true);
    mockedDisconnectSpotify.mockResolvedValue(undefined);
    mockedImportSpotifyArtistSnapshot.mockResolvedValue({ status: "READY", imported: [], requested: [], deliveryIntentIds: [] });
    mockedReadSpotifyArtistSnapshot.mockResolvedValue({ status: "READY", artists: [], snapshotToken: "snapshot-token" });
    mockedDrainSpotifyCatalogRequestDeliveries.mockResolvedValue({ claimed: 0, delivered: 0, failed: 0, reconciliationRequired: 0 });
    mockedExchangeSpotifyCode.mockResolvedValue({ access_token: "token" });
    mockedSnapshotSpotifyConnectionAuthorization.mockResolvedValue({
      userId: "user-1",
      connectedAccountId: null,
      providerAccountId: null,
      connectionVersion: null,
    });
    mockedSpotifyAccountRedirectUrl.mockImplementation(
      (status) => new URL(`/account/notifications?spotify=${status}`, "https://trusted.example"),
    );
    mockedSpotifyAuthorizeUrl.mockImplementation(
      (state) => `https://accounts.spotify.test/authorize?state=${state}`,
    );
    mockedSpotifyConfigured.mockReturnValue(true);
    mockedGetSpotifyConnectionEvidence.mockResolvedValue({
      providerAccountId: "spotify-listener-1",
      accessToken: "token",
      refreshToken: "refresh",
      tokenType: "Bearer",
      scope: "user-follow-read user-top-read",
      expiresAt: null,
      displayName: "Listener",
      email: "listener@example.test",
    });
    mockedStoreSpotifyConnection.mockResolvedValue({
      id: "account-1",
      displayName: "Listener",
      email: "listener@example.test",
    });
    mockedSendEmail.mockResolvedValue({ ok: true, provider: "CONSOLE", providerResult: "LOGGED" });
    mockedCookies.mockResolvedValue({
      get: jest.fn().mockReturnValue({ value: "expected-state" }),
    } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it("keeps connection inspection and disconnection inside the serialized boundary", async () => {
    const getResponse = await getConnection(request("/api/integrations/spotify/connection"));
    const deleteResponse = await deleteConnection(
      request("/api/integrations/spotify/connection", "DELETE"),
    );

    expect(getResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(mockedHasSpotifyConnection).toHaveBeenCalledWith("user-1", mockedPrisma);
    expect(mockedDisconnectSpotify).toHaveBeenCalledWith("user-1", mockedPrisma);
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
  });

  it("revalidates an ordinary user before issuing a private Spotify authorization redirect", async () => {
    const response = await startSpotify(request("/api/integrations/spotify/start"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toMatch(/^https:\/\/accounts\.spotify\.test\/authorize\?state=/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toContain("tft_spotify_oauth_state=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      timeout: 120_000,
    });
    expect(mockedSpotifyAuthorizeUrl).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{48}$/));
  });

  it("refuses a managed user before creating Spotify state or an external redirect", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await startSpotify(request("/api/integrations/spotify/start"));

    expect(response.status).toBe(403);
    expectPrivateStateCleared(response);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedSpotifyConfigured).not.toHaveBeenCalled();
    expect(mockedSpotifyAuthorizeUrl).not.toHaveBeenCalled();
  });

  it("uses the configured local redirect and clears stale state when Spotify is unavailable", async () => {
    mockedSpotifyConfigured.mockReturnValue(false);

    const response = await startSpotify(new Request("https://hostile.example/api/integrations/spotify/start", {
      headers: { host: "hostile.example", "x-forwarded-host": "forwarded-hostile.example" },
    }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://trusted.example/account/notifications?spotify=not_configured",
    );
    expectPrivateStateCleared(response);
    expect(mockedSpotifyAccountRedirectUrl).toHaveBeenCalledWith("not_configured");
    expect(mockedSpotifyAuthorizeUrl).not.toHaveBeenCalled();
  });

  it("keeps artist-route authentication refusals private", async () => {
    mockedRequireUser.mockResolvedValueOnce({
      ok: false,
      res: NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED" }, { status: 401 }),
    } as never);

    const response = await getArtists(request("/api/integrations/spotify/artists"));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mockedReadSpotifyArtistSnapshot).not.toHaveBeenCalled();
  });

  it("passes an exact bounded snapshot selection and drains only durable post-commit delivery work", async () => {
    const sequence: string[] = [];
    mockedImportSpotifyArtistSnapshot.mockImplementationOnce(async () => {
      sequence.push("import-committed");
      return {
        status: "READY",
        imported: [{ id: "preference-1", type: "ARTIST", value: "Matched Artist", status: "ACTIVE", catalogEntityId: "entity-1" }],
        requested: [{ id: "request-1", requestedValue: "Unknown Artist", status: "PENDING" }],
        deliveryIntentIds: ["intent-1"],
      };
    });
    mockedDrainSpotifyCatalogRequestDeliveries.mockImplementationOnce(async () => {
      sequence.push("delivery-drained");
      return { claimed: 1, delivered: 1, failed: 0, reconciliationRequired: 0 };
    });

    const response = await importArtists(
      request("/api/integrations/spotify/artists", "POST", {
        snapshotToken: "snapshot-token",
        spotifyIds: ["artist-1", "artist-2"],
        includeUnmatched: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mockedImportSpotifyArtistSnapshot).toHaveBeenCalledWith("user-1", {
      snapshotToken: "snapshot-token",
      spotifyIds: ["artist-1", "artist-2"],
      includeUnmatched: true,
    });
    expect(mockedDrainSpotifyCatalogRequestDeliveries).toHaveBeenCalledWith(["intent-1"]);
    expect(sequence).toEqual(["import-committed", "delivery-drained"]);
  });

  it("rejects unknown or hostile selection fields before the import boundary", async () => {
    const response = await importArtists(
      request("/api/integrations/spotify/artists", "POST", {
        snapshotToken: "snapshot-token",
        spotifyIds: ["artist-1"],
        includeUnmatched: true,
        nested: { arbitrary: ["work"] },
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_REQUEST" });
    expect(mockedImportSpotifyArtistSnapshot).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("rejects a missing snapshot token and duplicate Spotify ids instead of normalizing them", async () => {
    const missing = await importArtists(
      request("/api/integrations/spotify/artists", "POST", { spotifyIds: ["artist-1"] }),
    );
    const duplicate = await importArtists(
      request("/api/integrations/spotify/artists", "POST", {
        snapshotToken: "snapshot-token",
        spotifyIds: ["artist-1", " artist-1 "],
      }),
    );

    expect(missing.status).toBe(400);
    expect(duplicate.status).toBe(400);
    expect(mockedImportSpotifyArtistSnapshot).not.toHaveBeenCalled();
    expect(mockedDrainSpotifyCatalogRequestDeliveries).not.toHaveBeenCalled();
  });

  it("keeps refresh and drift outcomes private and does not disguise them as empty success", async () => {
    mockedReadSpotifyArtistSnapshot.mockResolvedValueOnce({ status: "DRIFTED" });
    const drifted = await getArtists(request("/api/integrations/spotify/artists"));
    expect(drifted.status).toBe(409);
    expect(drifted.headers.get("cache-control")).toBe("private, no-store");
    await expect(drifted.json()).resolves.toMatchObject({ error: "SPOTIFY_RETRY_REQUIRED" });

    mockedReadSpotifyArtistSnapshot.mockResolvedValueOnce({ status: "NO_CONNECTION" });
    const disconnected = await getArtists(request("/api/integrations/spotify/artists"));
    expect(disconnected.status).toBe(200);
    await expect(disconnected.json()).resolves.toEqual({ ok: true, connected: false, artists: [] });
  });

  it("preserves the matched-artist label contract used by the notification UI", async () => {
    mockedReadSpotifyArtistSnapshot.mockResolvedValueOnce({
      status: "READY",
      artists: [{
        spotifyId: "artist-1",
        name: "Matched Artist",
        popularity: 80,
        source: "followed",
        spotifyUrl: null,
        imageUrl: null,
        match: {
          type: "ARTIST",
          value: "Matched Artist",
          label: "Matched Artist",
          catalogEntityId: "entity-1",
          canonicalName: "Matched Artist",
          provider: "spotify",
          providerId: "artist-1",
        },
      }],
      snapshotToken: "snapshot-token",
    });

    const response = await getArtists(request("/api/integrations/spotify/artists"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connected: true,
      artists: [{ match: { type: "ARTIST", value: "Matched Artist", label: "Matched Artist" } }],
    });
  });

  it("returns a bounded stale-selection conflict without email", async () => {
    mockedImportSpotifyArtistSnapshot.mockRejectedValueOnce(new Error("SPOTIFY_ARTIST_SELECTION_STALE"));
    const response = await importArtists(
      request("/api/integrations/spotify/artists", "POST", { snapshotToken: "snapshot-token", spotifyIds: ["missing"] }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "SPOTIFY_SELECTION_STALE" });
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("contains an unexpected providerless admin-email rejection after import writes", async () => {
    const previousResendApiKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "configured-but-not-evidence";
    mockedImportSpotifyArtistSnapshot.mockResolvedValue({
      status: "READY",
      imported: [],
      requested: [{ id: "request-1", requestedValue: "Unknown Artist", status: "PENDING" }],
      deliveryIntentIds: ["intent-1"],
    });
    mockedDrainSpotifyCatalogRequestDeliveries.mockRejectedValueOnce(new Error("synthetic drain failure"));

    try {
      const response = await importArtists(
        request("/api/integrations/spotify/artists", "POST", { snapshotToken: "snapshot-token", includeUnmatched: true }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        requested: [{ id: "request-1", requestedValue: "Unknown Artist" }],
      });
      expect(mockedImportSpotifyArtistSnapshot).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledWith(
        "Spotify catalog request delivery drain failed",
      );
    } finally {
      if (previousResendApiKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = previousResendApiKey;
      }
    }
  });

  it("does not notify when the import boundary does not commit", async () => {
    mockedImportSpotifyArtistSnapshot.mockRejectedValueOnce(
      Object.assign(new Error("synthetic commit failure"), { code: "P2034" }),
    );

    const response = await importArtists(
      request("/api/integrations/spotify/artists", "POST", { snapshotToken: "snapshot-token", includeUnmatched: true }),
    );

    expect(response.status).toBe(500);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("refuses a restored managed user before Spotify access or local mutation", async () => {
    mockedImportSpotifyArtistSnapshot.mockRejectedValueOnce(new ManagedAccountSpotifyOperationError());

    const response = await importArtists(
      request("/api/integrations/spotify/artists", "POST", { snapshotToken: "snapshot-token", includeUnmatched: true }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("private");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedImportSpotifyArtistSnapshot).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedReadSpotifyArtistSnapshot.mockRejectedValueOnce(new ManagedAccountSpotifyOperationError());

    const response = await getArtists(request("/api/integrations/spotify/artists"));

    expect(response.status).toBe(403);
    expect(mockedReadSpotifyArtistSnapshot).toHaveBeenCalledWith("user-1");
  });

  it("commits callback authorization before provider I/O and revalidates before storage", async () => {
    const sequence: string[] = [];
    mockedPrisma.$transaction
      .mockImplementationOnce(async (work: (tx: typeof mockedPrisma) => unknown) => {
        sequence.push("authorization-start");
        const result = await work(mockedPrisma);
        sequence.push("authorization-committed");
        return result;
      })
      .mockImplementationOnce(async (work: (tx: typeof mockedPrisma) => unknown) => {
        sequence.push("storage-start");
        const result = await work(mockedPrisma);
        sequence.push("storage-committed");
        return result;
      });
    mockedExchangeSpotifyCode.mockImplementationOnce(async () => {
      sequence.push("code-exchanged");
      return { access_token: "token" };
    });
    mockedGetSpotifyConnectionEvidence.mockImplementationOnce(async () => {
      sequence.push("account-read");
      return {
        providerAccountId: "spotify-listener-1",
        accessToken: "token",
        refreshToken: "refresh",
        tokenType: "Bearer",
        scope: "user-follow-read user-top-read",
        expiresAt: null,
        displayName: "Listener",
        email: "listener@example.test",
      };
    });

    const response = await spotifyCallback(
      request("/api/integrations/spotify/callback?code=code-1&state=expected-state"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://trusted.example/account/notifications?spotify=connected",
    );
    expectPrivateStateCleared(response);
    expect(mockedExchangeSpotifyCode).toHaveBeenCalledWith("code-1");
    expect(mockedGetSpotifyConnectionEvidence).toHaveBeenCalledWith({ access_token: "token" });
    expect(mockedStoreSpotifyConnection).toHaveBeenCalledWith({
      authorization: {
        userId: "user-1",
        connectedAccountId: null,
        providerAccountId: null,
        connectionVersion: null,
      },
      evidence: expect.objectContaining({ providerAccountId: "spotify-listener-1" }),
      db: mockedPrisma,
    });
    expect(sequence).toEqual([
      "authorization-start",
      "authorization-committed",
      "code-exchanged",
      "account-read",
      "storage-start",
      "storage-committed",
    ]);
  });

  it("refuses a restored managed callback before exchanging the provider code", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await spotifyCallback(
      request("/api/integrations/spotify/callback?code=code-1&state=expected-state"),
    );

    expect(response.status).toBe(403);
    expectPrivateStateCleared(response);
    expect(mockedExchangeSpotifyCode).not.toHaveBeenCalled();
    expect(mockedGetSpotifyConnectionEvidence).not.toHaveBeenCalled();
    expect(mockedStoreSpotifyConnection).not.toHaveBeenCalled();
  });

  it("does not exchange the callback code when authorization commit aborts", async () => {
    mockedPrisma.$transaction.mockImplementationOnce(
      async (work: (tx: typeof mockedPrisma) => unknown) => {
        await work(mockedPrisma);
        throw Object.assign(new Error("synthetic commit failure"), { code: "P2034" });
      },
    );

    const response = await spotifyCallback(
      request("/api/integrations/spotify/callback?code=code-1&state=expected-state"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("spotify=failed");
    expectPrivateStateCleared(response);
    expect(mockedExchangeSpotifyCode).not.toHaveBeenCalled();
    expect(mockedGetSpotifyConnectionEvidence).not.toHaveBeenCalled();
    expect(mockedStoreSpotifyConnection).not.toHaveBeenCalled();
  });

  it("does not store provider evidence when identity revalidation fails", async () => {
    mockedPrisma.user.findUnique
      .mockResolvedValueOnce(ordinaryUser)
      .mockResolvedValueOnce(managedUser);

    const response = await spotifyCallback(
      request("/api/integrations/spotify/callback?code=code-1&state=expected-state"),
    );

    expect(response.status).toBe(403);
    expectPrivateStateCleared(response);
    expect(mockedExchangeSpotifyCode).toHaveBeenCalledTimes(1);
    expect(mockedGetSpotifyConnectionEvidence).toHaveBeenCalledTimes(1);
    expect(mockedStoreSpotifyConnection).not.toHaveBeenCalled();
  });

  it("uses the configured redirect origin and clears state on provider denial", async () => {
    const response = await spotifyCallback(
      new Request("https://hostile.example/api/integrations/spotify/callback?error=access_denied&state=expected-state", {
        headers: {
          host: "hostile.example",
          origin: "https://hostile.example",
          "x-forwarded-host": "forwarded-hostile.example",
          "x-forwarded-proto": "http",
        },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://trusted.example/account/notifications?spotify=denied",
    );
    expectPrivateStateCleared(response);
    expect(mockedExchangeSpotifyCode).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", ""],
    ["mismatched", "&state=wrong-state"],
  ])("rejects provider denial with %s callback state", async (_label, stateQuery) => {
    const response = await spotifyCallback(
      request(`/api/integrations/spotify/callback?error=access_denied${stateQuery}`),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://trusted.example/account/notifications?spotify=invalid_state",
    );
    expectPrivateStateCleared(response);
    expect(mockedExchangeSpotifyCode).not.toHaveBeenCalled();
  });

  it("keeps malformed callback state private while clearing the state cookie", async () => {
    const response = await spotifyCallback(
      request("/api/integrations/spotify/callback?code=code-1&state=wrong-state"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://trusted.example/account/notifications?spotify=invalid_state",
    );
    expectPrivateStateCleared(response);
    expect(mockedExchangeSpotifyCode).not.toHaveBeenCalled();
  });

  it("keeps a callback configuration failure private while preserving the failed redirect", async () => {
    mockedExchangeSpotifyCode.mockRejectedValueOnce(new Error("Invalid Spotify callback URI."));

    const response = await spotifyCallback(
      request("/api/integrations/spotify/callback?code=code-1&state=expected-state"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://trusted.example/account/notifications?spotify=failed",
    );
    expectPrivateStateCleared(response);
    expect(mockedGetSpotifyConnectionEvidence).not.toHaveBeenCalled();
    expect(mockedStoreSpotifyConnection).not.toHaveBeenCalled();
  });

  it("clears callback state when the current request is unauthenticated", async () => {
    mockedRequireUser.mockResolvedValueOnce({
      ok: false,
      res: NextResponse.json({ ok: false, error: "NOT_AUTHENTICATED" }, { status: 401 }),
    } as never);

    const response = await spotifyCallback(
      request("/api/integrations/spotify/callback?code=code-1&state=expected-state"),
    );

    expect(response.status).toBe(401);
    expectPrivateStateCleared(response);
    expect(mockedExchangeSpotifyCode).not.toHaveBeenCalled();
  });

  it("does not overwrite a newer connection after provider evidence returns", async () => {
    mockedStoreSpotifyConnection.mockRejectedValueOnce(new Error("SPOTIFY_CONNECTION_CHANGED"));

    const response = await spotifyCallback(
      request("/api/integrations/spotify/callback?code=code-1&state=expected-state"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("spotify=failed");
    expect(mockedExchangeSpotifyCode).toHaveBeenCalledTimes(1);
    expect(mockedGetSpotifyConnectionEvidence).toHaveBeenCalledTimes(1);
    expect(mockedStoreSpotifyConnection).toHaveBeenCalledTimes(1);
  });
});
