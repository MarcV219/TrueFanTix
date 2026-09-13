/** @jest-environment node */

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { sendEmail } from "@/lib/email";
import {
  disconnectSpotify,
  exchangeSpotifyCode,
  getSpotifyImportCandidates,
  hasSpotifyConnection,
  storeSpotifyConnection,
} from "@/lib/integrations/spotify";
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
jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/integrations/spotify", () => ({
  disconnectSpotify: jest.fn(),
  exchangeSpotifyCode: jest.fn(),
  getSpotifyImportCandidates: jest.fn(),
  hasSpotifyConnection: jest.fn(),
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
const mockedDisconnectSpotify = disconnectSpotify as jest.MockedFunction<typeof disconnectSpotify>;
const mockedExchangeSpotifyCode = exchangeSpotifyCode as jest.MockedFunction<typeof exchangeSpotifyCode>;
const mockedGetSpotifyImportCandidates = getSpotifyImportCandidates as jest.MockedFunction<
  typeof getSpotifyImportCandidates
>;
const mockedHasSpotifyConnection = hasSpotifyConnection as jest.MockedFunction<typeof hasSpotifyConnection>;
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
    mockedGetSpotifyImportCandidates.mockResolvedValue({ connected: true, artists: [] });
    mockedExchangeSpotifyCode.mockResolvedValue({ access_token: "token" });
    mockedStoreSpotifyConnection.mockResolvedValue({
      id: "account-1",
      displayName: "Listener",
      email: "listener@example.test",
    });
    mockedSendEmail.mockResolvedValue({ ok: true });
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

  it("keeps provider-backed artist loading and import writes in one transaction", async () => {
    mockedGetSpotifyImportCandidates.mockResolvedValue({
      connected: true,
      artists: [
        {
          spotifyId: "artist-1",
          name: "Matched Artist",
          source: "followed",
          match: {
            type: "ARTIST",
            value: "Matched Artist",
            label: "Matched Artist",
            canonicalName: "Matched Artist",
            catalogEntityId: "entity-1",
            provider: "spotify",
            providerId: "artist-1",
          },
        },
        { spotifyId: "artist-2", name: "Unknown Artist", source: "top", match: null },
      ],
    });
    mockedPrisma.catalogEntity.findUnique.mockResolvedValue({
      id: "entity-1",
      type: "ARTIST",
      canonicalName: "Matched Artist",
    });
    mockedPrisma.notificationPreference.upsert.mockResolvedValue({ id: "preference-1" });
    mockedPrisma.catalogRequest.upsert.mockResolvedValue({
      id: "request-1",
      requestedValue: "Unknown Artist",
      status: "PENDING",
    });

    const response = await importArtists(
      request("/api/integrations/spotify/artists", "POST", { includeUnmatched: true }),
    );

    expect(response.status).toBe(200);
    expect(mockedGetSpotifyImportCandidates).toHaveBeenCalledWith("user-1", mockedPrisma);
    expect(mockedPrisma.notificationPreference.upsert).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.catalogRequest.upsert).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
  });

  it("refuses a restored managed user before Spotify access or local mutation", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await importArtists(
      request("/api/integrations/spotify/artists", "POST", { includeUnmatched: true }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("private");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedGetSpotifyImportCandidates).not.toHaveBeenCalled();
    expect(mockedPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
    expect(mockedPrisma.catalogRequest.upsert).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" }),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await getArtists(request("/api/integrations/spotify/artists"));

    expect(response.status).toBe(403);
    expect(mockedGetSpotifyImportCandidates).not.toHaveBeenCalled();
  });

  it("serializes callback token exchange and connection storage", async () => {
    const response = await spotifyCallback(
      request("/api/integrations/spotify/callback?code=code-1&state=expected-state"),
    );

    expect(response.status).toBe(307);
    expect(mockedExchangeSpotifyCode).toHaveBeenCalledWith("code-1");
    expect(mockedStoreSpotifyConnection).toHaveBeenCalledWith({
      userId: "user-1",
      token: { access_token: "token" },
      db: mockedPrisma,
    });
  });

  it("refuses a restored managed callback before exchanging the provider code", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await spotifyCallback(
      request("/api/integrations/spotify/callback?code=code-1&state=expected-state"),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mockedExchangeSpotifyCode).not.toHaveBeenCalled();
    expect(mockedStoreSpotifyConnection).not.toHaveBeenCalled();
  });
});
