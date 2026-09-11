/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { ensureCsrfCookie, enforceOriginAndCsrf } from "@/lib/security/csrf";
import {
  PrimaryStagingConsoleUnavailableError,
  requirePrimaryStagingActor,
  requirePrimaryStagingConsole,
  STAGING_ORGANIZER_EMAIL,
} from "@/lib/primary/staging-console";
import { GET as getSession } from "@/app/api/staging/primary/session/route";
import { GET as getState } from "@/app/api/staging/primary/state/route";
import { POST as postAction } from "@/app/api/staging/primary/actions/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    primaryOrganizer: { findMany: jest.fn() },
    primaryAuditEvent: { findMany: jest.fn() },
  },
}));

jest.mock("@/lib/auth/session", () => ({
  createSessionForUser: jest.fn(),
  deleteCurrentSession: jest.fn(),
  getUserIdFromSessionCookie: jest.fn(),
}));

jest.mock("@/lib/security/csrf", () => ({
  ensureCsrfCookie: jest.fn(),
  enforceOriginAndCsrf: jest.fn(),
}));

jest.mock("@/lib/primary/staging-console", () => ({
  ...jest.requireActual("@/lib/primary/staging-console"),
  ensurePrimaryStagingPersona: jest.fn(),
  requirePrimaryStagingActor: jest.fn(),
  requirePrimaryStagingConsole: jest.fn(),
  verifyPrimaryStagingAccessToken: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  primaryOrganizer: { findMany: jest.Mock };
  primaryAuditEvent: { findMany: jest.Mock };
};
const mockedActor = requirePrimaryStagingActor as jest.MockedFunction<typeof requirePrimaryStagingActor>;
const mockedConsole = requirePrimaryStagingConsole as jest.MockedFunction<typeof requirePrimaryStagingConsole>;
const mockedEnsureCsrfCookie = ensureCsrfCookie as jest.MockedFunction<typeof ensureCsrfCookie>;
const mockedCsrf = enforceOriginAndCsrf as jest.MockedFunction<typeof enforceOriginAndCsrf>;

const adminActor = {
  id: "staging-admin",
  email: "admin@primary-staging.example.invalid",
  firstName: "Staging",
  lastName: "Reviewer",
  role: "ADMIN" as const,
  emailVerifiedAt: new Date(),
  phoneVerifiedAt: new Date(),
  isBanned: false,
};

describe("primary staging console API boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedConsole.mockReturnValue({ environmentId: "isolated-preview" } as never);
    mockedEnsureCsrfCookie.mockResolvedValue("test-csrf-token");
    mockedCsrf.mockResolvedValue({ ok: true } as never);
    mockedPrisma.primaryOrganizer.findMany.mockResolvedValue([]);
    mockedPrisma.primaryAuditEvent.findMany.mockResolvedValue([]);
    process.env.SESSION_SECRET = "staging-test-session-secret-longer-than-thirty-two-characters";
  });

  it("marks session state private and unavailable responses as non-cacheable", async () => {
    mockedActor.mockResolvedValueOnce(null);
    const response = await getSession();

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ ok: true, actor: null });
    expect(mockedEnsureCsrfCookie).toHaveBeenCalledTimes(1);

    mockedConsole.mockImplementationOnce(() => {
      throw new PrimaryStagingConsoleUnavailableError("CONSOLE_DISABLED");
    });
    const unavailable = await getSession();
    expect(unavailable.status).toBe(404);
    expect(unavailable.headers.get("cache-control")).toBe("private, no-store");
  });

  it("limits the admin view to organizers owned by the reserved staging persona", async () => {
    mockedActor.mockResolvedValue(adminActor);
    const response = await getState();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mockedPrisma.primaryOrganizer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        memberships: {
          some: {
            status: "ACTIVE",
            role: "OWNER",
            user: { email: STAGING_ORGANIZER_EMAIL },
          },
        },
      },
    }));
  });

  it("does not query organizer state for an unauthenticated session", async () => {
    mockedActor.mockResolvedValue(null);
    const response = await getState();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mockedPrisma.primaryOrganizer.findMany).not.toHaveBeenCalled();
  });

  it("marks rejected action requests as non-cacheable", async () => {
    mockedActor.mockResolvedValue(adminActor);
    const response = await postAction(new Request("https://preview.example/api/staging/primary/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "not-an-approved-action" }),
    }));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ ok: false, error: "UNKNOWN_ACTION" });
  });
});
