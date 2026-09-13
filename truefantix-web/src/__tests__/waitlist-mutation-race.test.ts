/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { createNotification } from "@/lib/notifications/service";
import { validateRequest } from "@/lib/validation";
import { DELETE, POST } from "@/app/api/waitlist/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    event: { findUnique: jest.fn() },
    waitlistEntry: {
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
    waitlistCreateApi: { kind: "create" },
    waitlistDeleteQuery: { safeParse: jest.fn() },
  },
  validateRequest: jest.fn(),
}));

jest.mock("@/lib/notifications/service", () => ({ createNotification: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  event: { findUnique: jest.Mock };
  waitlistEntry: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireUser = requireUser as jest.MockedFunction<typeof requireUser>;
const mockedValidateRequest = validateRequest as jest.Mock;
const mockedCreateNotification = createNotification as jest.MockedFunction<typeof createNotification>;

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

const event = {
  id: "event-1",
  title: "Synthetic Event",
  venue: "Synthetic Venue",
  date: new Date("2027-01-01T01:00:00.000Z"),
  selloutStatus: "SOLD_OUT",
};

const entry = {
  id: "waitlist-1",
  userId: ordinaryUser.id,
  eventId: event.id,
  maxPriceCents: 5000,
  notes: null,
  status: "ACTIVE",
  notifiedAt: null,
  event,
};

function postRequest() {
  return new Request("https://preview.example/api/waitlist", { method: "POST" });
}

function deleteRequest() {
  return new Request(`https://preview.example/api/waitlist?id=${entry.id}`, { method: "DELETE" });
}

describe("waitlist staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRequireUser.mockResolvedValue({ ok: true, user: ordinaryUser } as never);
    mockedValidateRequest.mockReturnValue(jest.fn().mockResolvedValue({
      success: true,
      data: { eventId: event.id, maxPrice: 50 },
    }));
    const { schemas } = jest.requireMock("@/lib/validation") as {
      schemas: { waitlistDeleteQuery: { safeParse: jest.Mock } };
    };
    schemas.waitlistDeleteQuery.safeParse.mockReturnValue({
      success: true,
      data: { id: entry.id },
    });
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.event.findUnique.mockResolvedValue(event);
    mockedPrisma.waitlistEntry.findFirst.mockResolvedValue(null);
    mockedPrisma.waitlistEntry.create.mockResolvedValue(entry);
    mockedPrisma.waitlistEntry.update.mockResolvedValue({ ...entry, status: "CANCELLED" });
    mockedPrisma.$queryRaw.mockResolvedValue([{ id: ordinaryUser.id }]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedCreateNotification.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ["join", POST, postRequest],
    ["leave", DELETE, deleteRequest],
  ] as const)("locks and rechecks the user before waitlist %s", async (_label, handler, makeRequest) => {
    if (handler === DELETE) mockedPrisma.waitlistEntry.findFirst.mockResolvedValue(entry);

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
    ["join", POST, postRequest],
    ["leave", DELETE, deleteRequest],
  ] as const)("refuses a restored managed user before waitlist %s residue", async (_label, handler, makeRequest) => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await handler(makeRequest());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.waitlistEntry.create).not.toHaveBeenCalled();
    expect(mockedPrisma.waitlistEntry.update).not.toHaveBeenCalled();
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.$transaction.mockRejectedValue(Object.assign(new Error("serialization failure"), { code: "P2034" }));
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await POST(postRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.waitlistEntry.create).not.toHaveBeenCalled();
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });
});
