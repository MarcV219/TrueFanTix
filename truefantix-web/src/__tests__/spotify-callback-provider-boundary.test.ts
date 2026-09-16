/** @jest-environment node */

import {
  canonicalSpotifyConfiguration,
  exchangeSpotifyCode,
  getSpotifyConnectionEvidence,
  snapshotSpotifyConnectionAuthorization,
  spotifyAccountRedirectUrl,
  spotifyRedirectUri,
  SPOTIFY_STAGING_ORIGIN,
  SPOTIFY_TEST_ORIGIN,
  storeSpotifyConnection,
  type SpotifyConnectionAuthorization,
} from "@/lib/integrations/spotify";

describe("Spotify callback provider evidence boundary", () => {
  const authorization: SpotifyConnectionAuthorization = {
    userId: "user-1",
    connectedAccountId: "connection-1",
    providerAccountId: "spotify-old",
    connectionVersion: "authorized-version",
  };

  const evidence = {
    providerAccountId: "spotify-new",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenType: "Bearer",
    scope: "user-follow-read user-top-read",
    expiresAt: new Date("2026-09-16T03:00:00.000Z"),
    displayName: "Listener",
    email: "listener@example.test",
  };

  const previousEncryptionKey = process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
  const previousClientId = process.env.SPOTIFY_CLIENT_ID;
  const previousClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const previousRedirectUri = process.env.SPOTIFY_REDIRECT_URI;
  const previousAppOrigin = process.env.APP_ORIGIN;
  const previousPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = "test-only-spotify-encryption-key-32-bytes";
    process.env.SPOTIFY_CLIENT_ID = "spotify-client-id";
    process.env.SPOTIFY_CLIENT_SECRET = "spotify-client-secret";
    process.env.APP_ORIGIN = SPOTIFY_TEST_ORIGIN;
    process.env.NEXT_PUBLIC_APP_URL = SPOTIFY_TEST_ORIGIN;
    process.env.SPOTIFY_REDIRECT_URI = `${SPOTIFY_TEST_ORIGIN}/api/integrations/spotify/callback`;
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (previousEncryptionKey === undefined) {
      delete process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = previousEncryptionKey;
    }
    if (previousClientId === undefined) delete process.env.SPOTIFY_CLIENT_ID;
    else process.env.SPOTIFY_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.SPOTIFY_CLIENT_SECRET;
    else process.env.SPOTIFY_CLIENT_SECRET = previousClientSecret;
    if (previousRedirectUri === undefined) {
      delete process.env.SPOTIFY_REDIRECT_URI;
    } else {
      process.env.SPOTIFY_REDIRECT_URI = previousRedirectUri;
    }
    if (previousAppOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previousAppOrigin;
    if (previousPublicAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previousPublicAppUrl;
  });

  it("reduces the provider account response to bounded primitive evidence", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      id: "spotify-listener-1",
      display_name: "Listener",
      email: "listener@example.test",
      ignored: { arbitrary: "provider object" },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await getSpotifyConnectionEvidence({
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "Bearer",
      scope: "user-follow-read",
      expires_in: 3600,
      ignored: "provider field",
    });

    expect(fetch).toHaveBeenCalledWith("https://api.spotify.com/v1/me", expect.objectContaining({
      method: "GET",
      headers: { Authorization: "Bearer access-token" },
      cache: "no-store",
      signal: expect.any(AbortSignal),
    }));
    expect(result).toEqual({
      providerAccountId: "spotify-listener-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      scope: "user-follow-read",
      expiresAt: expect.any(Date),
      displayName: "Listener",
      email: "listener@example.test",
    });
    expect(result).not.toHaveProperty("ignored");
  });

  it("rejects malformed provider identity before local persistence", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      id: " ",
      display_name: "Listener",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(getSpotifyConnectionEvidence({ access_token: "access-token" }))
      .rejects.toThrow("invalid account identity");
  });

  it("rejects oversized profile bodies without parsing provider content", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      id: "spotify-listener-1",
      ignored: "x".repeat(65_536),
    }), { status: 200 }));

    await expect(getSpotifyConnectionEvidence({ access_token: "access-token" }))
      .rejects.toThrow("SPOTIFY_OAUTH_PROVIDER_FAILED");
  });

  it("cancels a stalled profile body at the provider deadline", async () => {
    const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
      cancel,
    });
    jest.spyOn(global, "fetch").mockResolvedValueOnce(new Response(body, { status: 200 }));

    await expect(getSpotifyConnectionEvidence(
      { access_token: "access-token" },
      { timeoutMs: 10 },
    )).rejects.toThrow("SPOTIFY_OAUTH_PROVIDER_FAILED");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels malformed UTF-8 profile streams and returns only canonical failure", async () => {
    const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => controller.enqueue(Uint8Array.from([0xc3, 0x28])),
      cancel,
    });
    jest.spyOn(global, "fetch").mockResolvedValueOnce(new Response(body, { status: 200 }));

    await expect(getSpotifyConnectionEvidence({ access_token: "access-token" }))
      .rejects.toEqual(new Error("SPOTIFY_OAUTH_PROVIDER_FAILED"));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("bounds token responses and never surfaces provider error text", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      error: "provider-secret-detail",
    }), { status: 429 }));

    await expect(exchangeSpotifyCode("one-time-code"))
      .rejects.toEqual(new Error("SPOTIFY_OAUTH_PROVIDER_FAILED"));
  });

  it("aborts a stalled token exchange and rejects oversized codes before provider contact", async () => {
    const fetchImpl = jest.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));

    await expect(exchangeSpotifyCode("one-time-code", {
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 10,
    })).rejects.toThrow("SPOTIFY_OAUTH_PROVIDER_FAILED");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined)?.signal?.aborted).toBe(true);

    await expect(exchangeSpotifyCode("x".repeat(4_097), { fetchImpl: fetchImpl as typeof fetch }))
      .rejects.toThrow("authorization code is invalid");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("derives the account redirect only from configured Spotify origin", () => {
    expect(spotifyAccountRedirectUrl("connected").toString()).toBe(
      `${SPOTIFY_TEST_ORIGIN}/account/notifications?spotify=connected`,
    );
    expect(spotifyRedirectUri()).toBe(`${SPOTIFY_TEST_ORIGIN}/api/integrations/spotify/callback`);
  });

  it.each([
    ["HTTP origin", { NODE_ENV: "test", APP_ORIGIN: "http://localhost:3000", NEXT_PUBLIC_APP_URL: "http://localhost:3000" }],
    ["origin credentials", { NODE_ENV: "test", APP_ORIGIN: "https://user:pass@spotify.test.invalid", NEXT_PUBLIC_APP_URL: "https://user:pass@spotify.test.invalid" }],
    ["mismatched origins", { NODE_ENV: "test", APP_ORIGIN: SPOTIFY_TEST_ORIGIN, NEXT_PUBLIC_APP_URL: "https://other.test.invalid" }],
    ["cross-origin callback", { NODE_ENV: "test", APP_ORIGIN: SPOTIFY_TEST_ORIGIN, NEXT_PUBLIC_APP_URL: SPOTIFY_TEST_ORIGIN, SPOTIFY_REDIRECT_URI: "https://other.test.invalid/api/integrations/spotify/callback" }],
    ["wrong callback path", { NODE_ENV: "test", APP_ORIGIN: SPOTIFY_TEST_ORIGIN, NEXT_PUBLIC_APP_URL: SPOTIFY_TEST_ORIGIN, SPOTIFY_REDIRECT_URI: `${SPOTIFY_TEST_ORIGIN}/wrong` }],
    ["callback query", { NODE_ENV: "test", APP_ORIGIN: SPOTIFY_TEST_ORIGIN, NEXT_PUBLIC_APP_URL: SPOTIFY_TEST_ORIGIN, SPOTIFY_REDIRECT_URI: `${SPOTIFY_TEST_ORIGIN}/api/integrations/spotify/callback?next=bad` }],
    ["callback hash", { NODE_ENV: "test", APP_ORIGIN: SPOTIFY_TEST_ORIGIN, NEXT_PUBLIC_APP_URL: SPOTIFY_TEST_ORIGIN, SPOTIFY_REDIRECT_URI: `${SPOTIFY_TEST_ORIGIN}/api/integrations/spotify/callback#bad` }],
    ["environment mismatch", { NODE_ENV: "production", VERCEL_ENV: "preview", APP_ORIGIN: SPOTIFY_TEST_ORIGIN, NEXT_PUBLIC_APP_URL: SPOTIFY_TEST_ORIGIN }],
    ["ambiguous environment", { NODE_ENV: "test", VERCEL_ENV: "preview", APP_ORIGIN: SPOTIFY_STAGING_ORIGIN, NEXT_PUBLIC_APP_URL: SPOTIFY_STAGING_ORIGIN }],
  ])("rejects %s", (_label, env) => {
    expect(() => canonicalSpotifyConfiguration(env as NodeJS.ProcessEnv)).toThrow();
  });

  it("accepts the exact isolated-preview origin and callback", () => {
    expect(canonicalSpotifyConfiguration({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-preview",
      PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-preview",
      APP_ORIGIN: SPOTIFY_STAGING_ORIGIN,
      NEXT_PUBLIC_APP_URL: SPOTIFY_STAGING_ORIGIN,
      SPOTIFY_REDIRECT_URI: `${SPOTIFY_STAGING_ORIGIN}/api/integrations/spotify/callback`,
    })).toEqual({
      origin: SPOTIFY_STAGING_ORIGIN,
      redirectUri: `${SPOTIFY_STAGING_ORIGIN}/api/integrations/spotify/callback`,
    });
  });

  it("refuses to overwrite a connection that changed after authorization", async () => {
    const db = {
      connectedAccount: {
        findUnique: jest.fn().mockResolvedValue({
          id: "connection-2",
          providerAccountId: "spotify-other",
          accessTokenEncrypted: "ciphertext-other",
          refreshTokenEncrypted: null,
          expiresAt: null,
          updatedAt: new Date("2026-09-16T02:00:00.000Z"),
          currentRefreshCommandId: null,
        }),
        create: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };

    await expect(storeSpotifyConnection({ authorization, evidence, db: db as never }))
      .rejects.toThrow("SPOTIFY_CONNECTION_CHANGED");
    expect(db.connectedAccount.create).not.toHaveBeenCalled();
    expect(db.connectedAccount.updateMany).not.toHaveBeenCalled();
  });

  it("persists exact evidence only when the authorized binding is unchanged", async () => {
    const current = {
      id: "connection-1",
      providerAccountId: "spotify-old",
      accessTokenEncrypted: "existing-access-ciphertext",
      refreshTokenEncrypted: "existing-refresh-ciphertext",
      expiresAt: new Date("2026-09-16T02:30:00.000Z"),
      updatedAt: new Date("2026-09-16T02:00:00.000Z"),
      currentRefreshCommandId: null,
    };
    const db = {
      connectedAccount: {
        findUnique: jest.fn().mockResolvedValue(current),
        create: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "connection-1" }),
      },
    };
    const exactAuthorization = await snapshotSpotifyConnectionAuthorization("user-1", db as never);

    await expect(storeSpotifyConnection({ authorization: exactAuthorization, evidence, db: db as never }))
      .resolves.toEqual({ id: "connection-1" });
    expect(db.connectedAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "connection-1",
        userId: "user-1",
        providerAccountId: "spotify-old",
        accessTokenEncrypted: "existing-access-ciphertext",
      }),
      data: expect.objectContaining({
        providerAccountId: "spotify-new",
        accessTokenEncrypted: expect.not.stringContaining("access-token"),
        refreshTokenEncrypted: expect.not.stringContaining("refresh-token"),
      }),
    }));
  });

  it("replaces a refresh-owned connection with a new generation", async () => {
    const current = {
      id: "connection-owned",
      providerAccountId: "spotify-old",
      accessTokenEncrypted: "owned-access-ciphertext",
      refreshTokenEncrypted: "owned-refresh-ciphertext",
      expiresAt: new Date("2026-09-16T02:30:00.000Z"),
      updatedAt: new Date("2026-09-16T02:00:00.000Z"),
      currentRefreshCommandId: "refresh-command-1",
    };
    const db = {
      connectedAccount: {
        findUnique: jest.fn().mockResolvedValue(current),
        create: jest.fn().mockResolvedValue({ id: "connection-new-generation" }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };
    const exactAuthorization = await snapshotSpotifyConnectionAuthorization("user-1", db as never);

    await expect(storeSpotifyConnection({ authorization: exactAuthorization, evidence, db: db as never }))
      .resolves.toEqual({ id: "connection-new-generation" });
    expect(db.connectedAccount.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "connection-owned",
        userId: "user-1",
        currentRefreshCommandId: "refresh-command-1",
      }),
    });
    expect(db.connectedAccount.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "user-1", providerAccountId: "spotify-new" }),
    }));
    expect(db.connectedAccount.updateMany).not.toHaveBeenCalled();
  });

  it("uses create-on-absence instead of a blind upsert", async () => {
    const db = {
      connectedAccount: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "connection-new" }),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };
    const absentAuthorization = await snapshotSpotifyConnectionAuthorization("user-1", db as never);

    await expect(storeSpotifyConnection({ authorization: absentAuthorization, evidence, db: db as never }))
      .resolves.toEqual({ id: "connection-new" });
    expect(db.connectedAccount.create).toHaveBeenCalledTimes(1);
    expect(db.connectedAccount.updateMany).not.toHaveBeenCalled();
  });
});
