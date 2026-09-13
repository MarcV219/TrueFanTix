/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { validateRequest } from "@/lib/validation";
import { POST } from "@/app/api/community/comments/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    event: { findUnique: jest.fn() },
    ticket: { findUnique: jest.fn() },
    communityComment: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({ requireVerifiedUser: jest.fn() }));

jest.mock("@/lib/validation", () => ({
  schemas: { communityCommentCreateApi: {} },
  validateRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  event: { findUnique: jest.Mock };
  ticket: { findUnique: jest.Mock };
  communityComment: { findUnique: jest.Mock; create: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireVerifiedUser = requireVerifiedUser as jest.MockedFunction<
  typeof requireVerifiedUser
>;
const mockedValidateRequest = validateRequest as jest.Mock;

const ordinaryUser = {
  id: "user-1",
  email: "ordinary@example.test",
  phone: "+14165550199",
  termsVersion: "v1",
  privacyVersion: "v1",
  canComment: true,
};

const eventId = "clz1234567890123456789012";

function request() {
  return new Request("https://preview.example/api/community/comments", { method: "POST" });
}

describe("community comment staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireVerifiedUser.mockResolvedValue({ ok: true, user: ordinaryUser } as never);
    mockedValidateRequest.mockReturnValue(jest.fn().mockResolvedValue({
      success: true,
      data: { body: "An ordinary comment", eventId },
    }));
    mockedPrisma.event.findUnique.mockResolvedValue({ id: eventId });
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.$queryRaw.mockResolvedValue([{ id: ordinaryUser.id }]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
    mockedPrisma.communityComment.create.mockResolvedValue({
      id: "comment-1",
      body: "An ordinary comment",
      eventId,
    });
  });

  it("locks and rechecks the ordinary author before creating content", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      comment: { id: "comment-1" },
    });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: ordinaryUser.id },
      select: {
        email: true,
        phone: true,
        termsVersion: true,
        privacyVersion: true,
        canComment: true,
      },
    });
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
  });

  it("refuses a persona restored before the locked identity recheck", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      ...ordinaryUser,
      email: "admin@primary-staging.example.invalid",
      phone: "+15550001002",
      termsVersion: "primary-staging-only",
      privacyVersion: "primary-staging-only",
      canComment: false,
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
    });
    expect(mockedPrisma.communityComment.create).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization loss after persona restoration", async () => {
    mockedPrisma.$transaction.mockRejectedValue(new Error("serialization conflict"));
    mockedPrisma.user.findUnique.mockResolvedValue({
      email: "drifted-reviewer@example.test",
      phone: "+15550001002",
      termsVersion: "primary-staging-only",
      privacyVersion: "primary-staging-only",
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
    });
    expect(mockedPrisma.communityComment.create).not.toHaveBeenCalled();
  });

  it("honors an ordinary commenting restriction applied before the write", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      ...ordinaryUser,
      canComment: false,
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "COMMENTING_DISABLED",
    });
    expect(mockedPrisma.communityComment.create).not.toHaveBeenCalled();
  });

  it("does not misclassify an unrelated comment failure as staging", async () => {
    const failure = new Error("comment write failed");
    mockedPrisma.communityComment.create.mockRejectedValue(failure);

    await expect(POST(request())).rejects.toBe(failure);
  });
});
