/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { validateRequest } from "@/lib/validation";
import { DELETE, PATCH, POST } from "@/app/api/notifications/preferences/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    catalogEntity: { findUnique: jest.fn() },
    notificationPreference: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({ requireUser: jest.fn() }));

jest.mock("@/lib/validation", () => ({
  schemas: {
    notificationPreferencesSettingsApi: { kind: "settings" },
    notificationPreferenceCreateApi: { kind: "create" },
    notificationPreferenceDeleteApi: { kind: "delete" },
  },
  validateRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock };
  catalogEntity: { findUnique: jest.Mock };
  notificationPreference: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
    delete: jest.Mock;
  };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireUser = requireUser as jest.MockedFunction<typeof requireUser>;
const mockedValidateRequest = validateRequest as jest.Mock;

const ordinaryUser = {
  id: "user-1",
  email: "ordinary@example.test",
  phone: "+14165550199",
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

const preference = {
  id: "preference-1",
  userId: ordinaryUser.id,
  type: "TEAM",
  value: "Toronto Raptors",
  status: "ACTIVE",
  catalogEntityId: null,
  createdAt: new Date(),
};

function request(method: "PATCH" | "POST" | "DELETE") {
  return new Request("https://preview.example/api/notifications/preferences", { method });
}

describe("notification-preference staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRequireUser.mockResolvedValue({ ok: true, user: ordinaryUser } as never);
    mockedValidateRequest.mockImplementation((schema: { kind: string }) => jest.fn().mockResolvedValue({
      success: true,
      data: schema.kind === "settings"
        ? { notificationRadiusKm: 25, notificationRadiusUnit: "KM" }
        : schema.kind === "create"
          ? { type: "TEAM", value: "Toronto Raptors", catalogEntityId: null }
          : { id: preference.id },
    }));
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.user.update.mockResolvedValue({
      notificationRadiusKm: 25,
      notificationRadiusUnit: "KM",
    });
    mockedPrisma.notificationPreference.findUnique.mockResolvedValue(preference);
    mockedPrisma.notificationPreference.upsert.mockResolvedValue(preference);
    mockedPrisma.notificationPreference.delete.mockResolvedValue(preference);
    mockedPrisma.$queryRaw.mockResolvedValue([{ id: ordinaryUser.id }]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ["settings update", PATCH, "PATCH"],
    ["preference creation", POST, "POST"],
    ["preference deletion", DELETE, "DELETE"],
  ] as const)("locks and rechecks the user before a %s", async (_label, handler, method) => {
    const response = await handler(request(method));

    expect(response.status).toBe(method === "POST" ? 201 : 200);
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ordinaryUser.id },
    }));
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
  });

  it.each([
    ["settings update", PATCH, "PATCH"],
    ["preference creation", POST, "POST"],
    ["preference deletion", DELETE, "DELETE"],
  ] as const)("refuses a restored managed user before %s residue", async (_label, handler, method) => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await handler(request(method));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    expect(mockedPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
    expect(mockedPrisma.notificationPreference.delete).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.$transaction.mockRejectedValue(Object.assign(new Error("serialization failure"), { code: "P2034" }));
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await POST(request("POST"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });
});
