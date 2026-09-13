/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { sendEmail } from "@/lib/email";
import { validateRequest } from "@/lib/validation";
import { resolveCatalogRequest } from "@/lib/catalog/request-resolver";
import { POST } from "@/app/api/catalog/requests/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    notificationPreference: { findUnique: jest.fn(), upsert: jest.fn() },
    catalogRequest: { upsert: jest.fn(), update: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({ requireUser: jest.fn() }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }));
jest.mock("@/lib/validation", () => ({
  schemas: { catalogRequestCreateApi: { kind: "catalog-request" } },
  validateRequest: jest.fn(),
}));
jest.mock("@/lib/catalog/request-resolver", () => ({
  resolveCatalogRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  notificationPreference: { findUnique: jest.Mock; upsert: jest.Mock };
  catalogRequest: { upsert: jest.Mock; update: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireUser = requireUser as jest.MockedFunction<
  typeof requireUser
>;
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;
const mockedValidateRequest = validateRequest as jest.Mock;
const mockedResolveCatalogRequest =
  resolveCatalogRequest as jest.MockedFunction<typeof resolveCatalogRequest>;

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
  email: "admin@primary-staging.example.invalid",
  phone: "+15550001002",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
};

const pendingRequest = {
  id: "request-1",
  requestedType: "ARTIST",
  requestedValue: "Unknown Artist",
  status: "PENDING",
  emailSentAt: null,
  createdAt: new Date("2026-09-13T00:00:00Z"),
};

function request() {
  return new Request("https://preview.example/api/catalog/requests", {
    method: "POST",
  });
}

describe("catalog-request staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRequireUser.mockResolvedValue({
      ok: true,
      user: ordinaryUser,
    } as never);
    mockedValidateRequest.mockReturnValue(async () => ({
      success: true,
      data: { type: "ARTIST", value: "Unknown Artist", notes: "Please add" },
    }));
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.notificationPreference.findUnique.mockResolvedValue(null);
    mockedPrisma.notificationPreference.upsert.mockResolvedValue({
      id: "preference-1",
      type: "ARTIST",
      value: "Matched Artist",
      status: "ACTIVE",
      catalogEntityId: "entity-1",
    });
    mockedPrisma.catalogRequest.upsert.mockResolvedValue(pendingRequest);
    mockedPrisma.catalogRequest.update.mockResolvedValue({
      ...pendingRequest,
      emailSentAt: new Date("2026-09-13T00:00:01Z"),
    });
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedResolveCatalogRequest.mockResolvedValue({ status: "NOT_FOUND" });
    mockedSendEmail.mockResolvedValue({ ok: true });
  });

  afterEach(() => jest.restoreAllMocks());

  it("locks and rechecks before catalog resolution or user-scoped writes", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable", timeout: 30_000 },
    );
    expect(mockedResolveCatalogRequest).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.catalogRequest.upsert).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.catalogRequest.update).toHaveBeenCalledTimes(1);
  });

  it("keeps automatic fulfillment in the same serialized boundary", async () => {
    mockedResolveCatalogRequest.mockResolvedValue({
      status: "FOUND",
      suggestion: {
        type: "ARTIST",
        value: "Matched Artist",
        label: "Matched Artist",
        canonicalName: "Matched Artist",
        catalogEntityId: "entity-1",
        provider: "static",
        providerId: "artist-1",
      },
    });
    mockedPrisma.catalogRequest.upsert.mockResolvedValue({
      ...pendingRequest,
      status: "FULFILLED",
      resolvedCatalogEntityId: "entity-1",
      fulfilledPreferenceId: "preference-1",
      reviewedAt: new Date("2026-09-13T00:00:00Z"),
    });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mockedPrisma.notificationPreference.upsert).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.catalogRequest.upsert).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("refuses a restored managed requester before lookup, writes, or email", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: "STAGING_CONSOLE_ONLY",
    });
    expect(mockedResolveCatalogRequest).not.toHaveBeenCalled();
    expect(mockedPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
    expect(mockedPrisma.catalogRequest.upsert).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization failure"), { code: "P2034" }),
    );
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "STAGING_CONSOLE_ONLY",
    });
    expect(mockedResolveCatalogRequest).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });
});
