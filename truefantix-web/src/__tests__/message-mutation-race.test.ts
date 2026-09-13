/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { validateRequest } from "@/lib/validation";
import { sendNotificationToUser } from "@/lib/websocket";
import { createNotification } from "@/lib/notifications/service";
import { DELETE, GET, POST } from "@/app/api/messages/route";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), findFirst: jest.fn() },
    order: { findUnique: jest.fn() },
    conversation: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    message: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/auth/guards", () => ({ requireUser: jest.fn() }));

jest.mock("@/lib/validation", () => ({
  schemas: {
    messageCreateApi: { kind: "create" },
    messageDeleteQuery: { safeParse: jest.fn() },
  },
  validateRequest: jest.fn(),
}));

jest.mock("@/lib/websocket", () => ({ sendNotificationToUser: jest.fn() }));
jest.mock("@/lib/notifications/service", () => ({ createNotification: jest.fn() }));

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; findFirst: jest.Mock };
  order: { findUnique: jest.Mock };
  conversation: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  message: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};
const mockedRequireUser = requireUser as jest.MockedFunction<typeof requireUser>;
const mockedValidateRequest = validateRequest as jest.Mock;
const mockedSendNotification = sendNotificationToUser as jest.MockedFunction<typeof sendNotificationToUser>;
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

const conversation = {
  id: "conversation-1",
  participants: [{ userId: ordinaryUser.id }, { userId: "user-2" }],
};

const message = {
  id: "message-1",
  conversationId: conversation.id,
  senderId: ordinaryUser.id,
  content: "hello",
  sender: { id: ordinaryUser.id, firstName: "Ordinary", lastName: "User" },
  attachments: [],
};

function getRequest() {
  return new Request(`https://preview.example/api/messages?conversationId=${conversation.id}`);
}

function postRequest() {
  return new Request("https://preview.example/api/messages", { method: "POST" });
}

function deleteRequest() {
  return new Request(`https://preview.example/api/messages?id=${message.id}`, { method: "DELETE" });
}

describe("message staging-persona race boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedRequireUser.mockResolvedValue({ ok: true, user: ordinaryUser } as never);
    mockedValidateRequest.mockReturnValue(jest.fn().mockResolvedValue({
      success: true,
      data: { conversationId: conversation.id, content: message.content },
    }));
    const { schemas } = jest.requireMock("@/lib/validation") as {
      schemas: { messageDeleteQuery: { safeParse: jest.Mock } };
    };
    schemas.messageDeleteQuery.safeParse.mockReturnValue({
      success: true,
      data: { id: message.id },
    });
    mockedPrisma.user.findUnique.mockResolvedValue(ordinaryUser);
    mockedPrisma.conversation.findFirst.mockResolvedValue(conversation);
    mockedPrisma.conversation.findMany.mockResolvedValue([]);
    mockedPrisma.conversation.create.mockResolvedValue(conversation);
    mockedPrisma.conversation.update.mockResolvedValue(conversation);
    mockedPrisma.message.findMany.mockResolvedValue([message]);
    mockedPrisma.message.findFirst.mockResolvedValue(message);
    mockedPrisma.message.create.mockResolvedValue(message);
    mockedPrisma.message.update.mockResolvedValue({ ...message, content: "[deleted]" });
    mockedPrisma.message.updateMany.mockResolvedValue({ count: 1 });
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
    ["read-state update", GET, getRequest],
    ["send", POST, postRequest],
    ["deletion", DELETE, deleteRequest],
  ] as const)("locks and rechecks the user before message %s", async (_label, handler, makeRequest) => {
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
    ["read-state update", GET, getRequest],
    ["send", POST, postRequest],
    ["deletion", DELETE, deleteRequest],
  ] as const)("refuses a restored managed user before message %s residue", async (_label, handler, makeRequest) => {
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await handler(makeRequest());

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.message.create).not.toHaveBeenCalled();
    expect(mockedPrisma.message.update).not.toHaveBeenCalled();
    expect(mockedPrisma.message.updateMany).not.toHaveBeenCalled();
    expect(mockedSendNotification).not.toHaveBeenCalled();
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("reclassifies a serialization abort after persona restoration", async () => {
    mockedPrisma.$transaction.mockRejectedValue(Object.assign(new Error("serialization failure"), { code: "P2034" }));
    mockedPrisma.user.findUnique.mockResolvedValue(managedUser);

    const response = await POST(postRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "STAGING_CONSOLE_ONLY" });
    expect(mockedPrisma.message.create).not.toHaveBeenCalled();
    expect(mockedSendNotification).not.toHaveBeenCalled();
    expect(mockedCreateNotification).not.toHaveBeenCalled();
  });

  it("scopes read-state updates to conversations owned by the caller", async () => {
    await GET(getRequest());

    expect(mockedPrisma.message.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        conversationId: conversation.id,
        conversation: {
          participants: { some: { userId: ordinaryUser.id } },
        },
      }),
    }));
  });

  it("does not create an empty order conversation for a foreign user", async () => {
    mockedValidateRequest.mockReturnValue(jest.fn().mockResolvedValue({
      success: true,
      data: { orderId: "order-1", content: message.content },
    }));
    mockedPrisma.order.findUnique.mockResolvedValue({ sellerId: "seller-1", buyerSellerId: "seller-2" });
    mockedPrisma.user.findFirst
      .mockResolvedValueOnce({ id: "seller-user" })
      .mockResolvedValueOnce({ id: "buyer-user" });

    const response = await POST(postRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "NOT_FOUND" });
    expect(mockedPrisma.conversation.create).not.toHaveBeenCalled();
    expect(mockedPrisma.message.create).not.toHaveBeenCalled();
  });
});
