/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { validateRequest } from "@/lib/validation";
import { DELETE, POST } from "@/app/api/price-alerts/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    ticket: { findUnique: jest.fn() },
    priceAlert: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({ requireUser: jest.fn() }));

jest.mock("@/lib/validation", () => ({
  schemas: {
    priceAlertCreateApi: { kind: "create" },
    priceAlertDeleteQuery: { safeParse: jest.fn() },
  },
  validateRequest: jest.fn(),
}));

jest.mock("@/lib/notifications/service", () => ({ createNotification: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  ticket: { findUnique: jest.Mock };
  priceAlert: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
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

const alert = {
  id: "alert-1",
  userId: ordinaryUser.id,
  ticketId: "ticket-1",
  eventQuery: null,
  targetPriceCents: 5000,
  originalPriceCents: 6000,
  status: "ACTIVE",
  triggeredAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function postRequest() {
  return new Request("https://preview.example/api/price-alerts", { method: "POST" });
}

function deleteRequest() {
  return new Request(`https://preview.example/api/price-alerts?id=${alert.id}`, { method: "DELETE" });
}

describe("price-alert staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRequireUser.mockResolvedValue({ ok: true, user: ordinaryUser } as never);
    mockedValidateRequest.mockReturnValue(jest.fn().mockResolvedValue({
      success: true,
      data: { ticketId: alert.ticketId, targetPrice: 50 },
    }));
    const { schemas } = jest.requireMock("@/lib/validation") as {
      schemas: { priceAlertDeleteQuery: { safeParse: jest.Mock } };
    };
    schemas.priceAlertDeleteQuery.safeParse.mockReturnValue({
      success: true,
      data: { id: alert.id },
    });
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.ticket.findUnique.mockResolvedValue({
      id: alert.ticketId,
      title: "Test Ticket",
      priceCents: alert.originalPriceCents,
      status: "AVAILABLE",
    });
    mockedPrisma.priceAlert.findFirst.mockResolvedValue(null);
    mockedPrisma.priceAlert.create.mockResolvedValue(alert);
    mockedPrisma.priceAlert.update.mockResolvedValue({ ...alert, status: "DELETED" });
    mockedPrisma.$queryRaw.mockResolvedValue([{ id: ordinaryUser.id }]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ["creation", POST, postRequest],
    ["deletion", DELETE, deleteRequest],
  ] as const)("locks and rechecks the user before price-alert %s", async (_label, handler, makeRequest) => {
    if (handler === DELETE) mockedPrisma.priceAlert.findFirst.mockResolvedValue(alert);

    const response = await handler(makeRequest());

    expect(response.status).toBe(handler === POST ? 201 : 200);
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
    ["creation", POST, postRequest],
    ["deletion", DELETE, deleteRequest],
  ] as const)("refuses a restored managed user before price-alert %s residue", async (_label, handler, makeRequest) => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await handler(makeRequest());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.priceAlert.create).not.toHaveBeenCalled();
    expect(mockedPrisma.priceAlert.update).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.$transaction.mockRejectedValue(Object.assign(new Error("serialization failure"), { code: "P2034" }));
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await POST(postRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.priceAlert.create).not.toHaveBeenCalled();
  });
});
