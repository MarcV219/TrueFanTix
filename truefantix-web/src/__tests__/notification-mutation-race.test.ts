/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { validateRequest } from "@/lib/validation";
import { DELETE, PATCH } from "@/app/api/notifications/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    notification: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({ requireUser: jest.fn() }));

jest.mock("@/lib/validation", () => ({
  schemas: { notificationsPatchApi: { kind: "patch" } },
  validateRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  notification: { updateMany: jest.Mock; deleteMany: jest.Mock };
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

function patchRequest() {
  return new Request("https://preview.example/api/notifications", { method: "PATCH" });
}

function deleteRequest() {
  return new Request("https://preview.example/api/notifications?olderThanDays=30&readOnly=true", {
    method: "DELETE",
  });
}

describe("notification staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRequireUser.mockResolvedValue({ ok: true, user: ordinaryUser } as never);
    mockedValidateRequest.mockReturnValue(jest.fn().mockResolvedValue({
      success: true,
      data: { markAll: true },
    }));
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.notification.updateMany.mockResolvedValue({ count: 2 });
    mockedPrisma.notification.deleteMany.mockResolvedValue({ count: 1 });
    mockedPrisma.$queryRaw.mockResolvedValue([{ id: ordinaryUser.id }]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ["read-state update", PATCH, patchRequest],
    ["notification deletion", DELETE, deleteRequest],
  ] as const)("locks and rechecks the user before %s", async (_label, handler, makeRequest) => {
    const response = await handler(makeRequest());

    expect(response.status).toBe(200);
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
    ["read-state update", PATCH, patchRequest],
    ["notification deletion", DELETE, deleteRequest],
  ] as const)("refuses a restored managed user before %s residue", async (_label, handler, makeRequest) => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await handler(makeRequest());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.notification.updateMany).not.toHaveBeenCalled();
    expect(mockedPrisma.notification.deleteMany).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.$transaction.mockRejectedValue(Object.assign(new Error("serialization failure"), { code: "P2034" }));
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.notification.updateMany).not.toHaveBeenCalled();
  });
});
