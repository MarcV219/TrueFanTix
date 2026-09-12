/** @jest-environment node */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureCsrfCookie, enforceOriginAndCsrf } from "@/lib/security/csrf";
import {
  PrimaryStagingConsoleUnavailableError,
  requirePrimaryStagingActor,
  requirePrimaryStagingConsole,
  STAGING_ORGANIZER_EMAIL,
} from "@/lib/primary/staging-console";
import { GET as getSession, POST as postSession } from "@/app/api/staging/primary/session/route";
import { GET as getState } from "@/app/api/staging/primary/state/route";
import { POST as postAction } from "@/app/api/staging/primary/actions/route";
import {
  getPrimaryStagingRefundState,
  reseedPrimaryStagingRefundScenario,
  runPrimaryStagingRefundAction,
} from "@/lib/primary/staging-refund-console";

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

jest.mock("@/lib/primary/staging-refund-console", () => ({
  getPrimaryStagingRefundState: jest.fn(),
  recordPrimaryStagingRefundRejection: jest.fn(),
  reseedPrimaryStagingRefundScenario: jest.fn(),
  runPrimaryStagingRefundAction: jest.fn(),
  PrimaryStagingRefundError: jest.requireActual("@/lib/primary/staging-refund-console").PrimaryStagingRefundError,
}));

const mockedPrisma = prisma as unknown as {
  primaryOrganizer: { findMany: jest.Mock };
  primaryAuditEvent: { findMany: jest.Mock };
};
const mockedActor = requirePrimaryStagingActor as jest.MockedFunction<typeof requirePrimaryStagingActor>;
const mockedConsole = requirePrimaryStagingConsole as jest.MockedFunction<typeof requirePrimaryStagingConsole>;
const mockedEnsureCsrfCookie = ensureCsrfCookie as jest.MockedFunction<typeof ensureCsrfCookie>;
const mockedCsrf = enforceOriginAndCsrf as jest.MockedFunction<typeof enforceOriginAndCsrf>;
const mockedRefundState = getPrimaryStagingRefundState as jest.MockedFunction<typeof getPrimaryStagingRefundState>;
const mockedReseed = reseedPrimaryStagingRefundScenario as jest.MockedFunction<typeof reseedPrimaryStagingRefundScenario>;
const mockedRefundAction = runPrimaryStagingRefundAction as jest.MockedFunction<typeof runPrimaryStagingRefundAction>;

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
    mockedRefundState.mockResolvedValue(null);
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

  it("routes only authenticated synthetic refund commands to the staging engine", async () => {
    mockedActor.mockResolvedValue(adminActor);
    mockedReseed.mockResolvedValue({ generation: 4 });
    mockedRefundAction.mockResolvedValue({ status: "REQUESTED" } as never);
    const request = (action: string) => new Request("https://preview.example/api/staging/primary/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, reason: "Synthetic evidence" }) });

    const reseed = await postAction(request("reseedRefundScenarios"));
    const refund = await postAction(request("approveCheckedRefund"));

    expect(reseed.status).toBe(200);
    expect(refund.status).toBe(200);
    expect(mockedReseed).toHaveBeenCalledWith(prisma, expect.objectContaining({ email: adminActor.email, role: "ADMIN" }));
    expect(mockedRefundAction).toHaveBeenCalledWith(prisma, expect.objectContaining({ id: adminActor.id }), "approveCheckedRefund", expect.objectContaining({ reason: "Synthetic evidence" }));
  });

  it("marks CSRF rejections from both state-changing routes as non-cacheable", async () => {
    const csrfResponse = () => NextResponse.json(
      { ok: false, error: "CSRF_INVALID" },
      { status: 403 },
    );
    mockedCsrf
      .mockResolvedValueOnce({ ok: false, res: csrfResponse() })
      .mockResolvedValueOnce({ ok: false, res: csrfResponse() });

    const request = () => new Request("https://preview.example/api/staging/primary/session", {
      method: "POST",
    });
    const sessionResponse = await postSession(request());
    const actionResponse = await postAction(request());

    expect(sessionResponse.status).toBe(403);
    expect(sessionResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(actionResponse.status).toBe(403);
    expect(actionResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(mockedActor).not.toHaveBeenCalled();
  });
});
