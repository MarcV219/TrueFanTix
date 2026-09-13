/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth/guards";
import { validateRequest } from "@/lib/validation";
import { POST as createThread } from "@/app/api/forum/threads/route";
import { POST as createPost } from "@/app/api/forum/posts/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    forumThread: { findFirst: jest.fn(), create: jest.fn() },
    forumPost: { findFirst: jest.fn(), create: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({ requireVerifiedUser: jest.fn() }));

jest.mock("@/lib/validation", () => ({
  schemas: {
    forumThreadCreateApi: { kind: "thread" },
    forumPostCreateApi: { kind: "post" },
  },
  validateRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock };
  forumThread: { findFirst: jest.Mock; create: jest.Mock };
  forumPost: { findFirst: jest.Mock; create: jest.Mock };
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

const managedUser = {
  ...ordinaryUser,
  email: "admin@primary-staging.example.invalid",
  phone: "+15550001002",
  termsVersion: "primary-staging-only",
  privacyVersion: "primary-staging-only",
  canComment: false,
};

function request(path: string) {
  return new Request(`https://preview.example${path}`, { method: "POST" });
}

describe("forum content staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRequireVerifiedUser.mockResolvedValue({ ok: true, user: ordinaryUser } as never);
    mockedValidateRequest.mockImplementation((schema: { kind: string }) => jest.fn().mockResolvedValue({
      success: true,
      data: schema.kind === "thread"
        ? { title: "Ordinary thread", body: "First post", topicType: "OTHER", imageUrls: [] }
        : { threadId: "thread-1", body: "Ordinary reply", parentId: null, imageUrls: [] },
    }));
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.forumThread.findFirst.mockResolvedValue({ id: "thread-1", isLocked: false });
    mockedPrisma.forumThread.create.mockResolvedValue({
      id: "thread-1",
      title: "Ordinary thread",
      authorUserId: ordinaryUser.id,
    });
    mockedPrisma.forumPost.create.mockResolvedValue({
      id: "post-1",
      threadId: "thread-1",
      body: "First post",
      authorUserId: ordinaryUser.id,
    });
    mockedPrisma.$queryRaw.mockResolvedValue([{ id: ordinaryUser.id }]);
    mockedPrisma.$transaction.mockImplementation(
      async (work: (tx: typeof mockedPrisma) => unknown) => work(mockedPrisma),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("locks and rechecks the ordinary author for a thread and its first post", async () => {
    const response = await createThread(request("/api/forum/threads"));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      thread: { id: "thread-1" },
      post: { id: "post-1" },
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

  it("locks and rechecks the ordinary author before creating a reply", async () => {
    mockedPrisma.forumPost.create.mockResolvedValue({
      id: "post-2",
      threadId: "thread-1",
      body: "Ordinary reply",
      authorUserId: ordinaryUser.id,
    });

    const response = await createPost(request("/api/forum/posts"));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      post: { id: "post-2" },
    });
    expect(mockedPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
  });

  it.each([
    ["thread", createThread, "/api/forum/threads"],
    ["post", createPost, "/api/forum/posts"],
  ])("refuses a persona restored before the locked %s write", async (_name, handler, path) => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await handler(request(path));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
    });
    expect(mockedPrisma.forumThread.create).not.toHaveBeenCalled();
    expect(mockedPrisma.forumPost.create).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization loss after persona restoration", async () => {
    mockedPrisma.$transaction.mockRejectedValue(new Error("serialization conflict"));
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await createThread(request("/api/forum/threads"));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "STAGING_CONSOLE_ONLY",
    });
  });

  it("honors an ordinary commenting restriction applied before the write", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      ...ordinaryUser,
      canComment: false,
    });

    const response = await createThread(request("/api/forum/threads"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "FORBIDDEN",
    });
    expect(mockedPrisma.forumThread.create).not.toHaveBeenCalled();
    expect(mockedPrisma.forumPost.create).not.toHaveBeenCalled();
  });

  it("does not misclassify an unrelated forum failure as staging", async () => {
    mockedPrisma.$transaction.mockRejectedValue(new Error("forum write failed"));

    const response = await createThread(request("/api/forum/threads"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "SERVER_ERROR",
    });
  });
});
