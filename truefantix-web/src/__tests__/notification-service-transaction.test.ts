/** @jest-environment node */

import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications/service";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    notification: { create: jest.fn() },
  },
}));

const globalCreate = prisma.notification.create as jest.Mock;

describe("notification persistence client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses the supplied transaction notification client without mutating through global Prisma", async () => {
    const notification = { id: "notification-1" };
    const transactionCreate = jest.fn().mockResolvedValue(notification);

    await expect(createNotification({
      userId: "user-1",
      type: "DISPUTE_OPENED",
      message: "Support requested more information.",
      link: "/account/tickets/holding",
    }, { notification: { create: transactionCreate } } as never)).resolves.toEqual({
      ok: true,
      notification,
    });

    expect(transactionCreate).toHaveBeenCalledTimes(1);
    expect(transactionCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: "DISPUTE_OPENED",
        message: "Support requested more information.",
        link: "/account/tickets/holding",
        isRead: false,
      },
    });
    expect(globalCreate).not.toHaveBeenCalled();
  });
});
