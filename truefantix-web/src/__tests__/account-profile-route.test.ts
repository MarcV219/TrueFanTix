/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { validateRequest } from "@/lib/validation";
import { PATCH } from "@/app/api/account/profile/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

jest.mock("@/lib/auth/guards", () => ({
  requireUser: jest.fn(),
}));

jest.mock("@/lib/validation", () => ({
  schemas: { accountProfileUpdate: {} },
  validateRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock };
};
const mockedRequireUser = requireUser as jest.MockedFunction<typeof requireUser>;
const mockedValidateRequest = validateRequest as jest.Mock;

function request() {
  return new Request("https://preview.example/api/account/profile", { method: "PATCH" });
}

describe("account profile reserved staging identities", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireUser.mockResolvedValue({ ok: true, user: { id: "user-1" } } as never);
    mockedValidateRequest.mockReturnValue(jest.fn().mockResolvedValue({
      success: true,
      data: { firstName: "Changed" },
    }));
  });

  it("does not let a console persona mutate its ordinary account profile", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "staging-organizer",
      email: "organizer@primary-staging.example.invalid",
      phone: "+15550001001",
      isBanned: false,
    });

    const response = await PATCH(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "PROFILE_LOCKED" });
    expect(mockedValidateRequest).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("keeps a managed profile locked after its email drifts", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "staging-organizer",
      email: "drifted-organizer@example.test",
      phone: "+15550001001",
      termsVersion: "primary-staging-only",
      privacyVersion: "primary-staging-only",
      isBanned: false,
    });

    const response = await PATCH(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "PROFILE_LOCKED" });
    expect(mockedValidateRequest).not.toHaveBeenCalled();
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });

  it("does not let an ordinary account claim a reserved console phone", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: "ordinary-user",
      email: "ordinary@example.test",
      phone: "+14165550123",
      isBanned: false,
    });
    mockedValidateRequest.mockReturnValue(jest.fn().mockResolvedValue({
      success: true,
      data: { phone: "+1 (555) 000-1002" },
    }));

    const response = await PATCH(request());

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "PHONE_IN_USE" });
    expect(mockedPrisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.user.update).not.toHaveBeenCalled();
  });
});
