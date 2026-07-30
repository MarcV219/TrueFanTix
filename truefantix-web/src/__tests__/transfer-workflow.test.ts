const findUser: jest.Mock = jest.fn();
const createNotificationOncePerWindow: jest.Mock = jest.fn();
const sendEmail: jest.Mock = jest.fn();
const generateSellerTransferReminderEmail: jest.Mock = jest.fn(() => ({
  subject: "Transfer reminder",
  text: "Transfer now",
  html: "<p>Transfer now</p>",
}));
const generateBuyerTransferConfirmationRequiredEmail: jest.Mock = jest.fn(() => ({
  subject: "Confirm receipt",
  text: "Confirm receipt now",
  html: "<p>Confirm receipt now</p>",
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUser(...args) },
  },
}));

jest.mock("@/lib/notifications/service", () => ({
  createNotification: jest.fn(),
  createNotificationOncePerWindow: (...args: unknown[]) => createNotificationOncePerWindow(...args),
}));

jest.mock("@/lib/email", () => ({
  generateBuyerTransferConfirmationRequiredEmail: (...args: unknown[]) =>
    generateBuyerTransferConfirmationRequiredEmail(...args),
  generateSellerTransferReminderEmail: (...args: unknown[]) => generateSellerTransferReminderEmail(...args),
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

import {
  notifyBuyerTransferConfirmationRequired,
  notifySellerTransferRequired,
} from "@/lib/orders/transferWorkflow";

describe("seller transfer reminder email", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findUser.mockResolvedValue({ email: "seller@example.com", firstName: "Pam" });
    sendEmail.mockResolvedValue({ ok: true });
  });

  it("emails the seller when a new six-hour reminder is created", async () => {
    createNotificationOncePerWindow.mockResolvedValue({ ok: true, notification: { id: "notice-1" } });
    const deadline = new Date("2026-07-30T16:00:00.000Z");

    await notifySellerTransferRequired({
      sellerUserId: "seller-user",
      orderId: "order-1",
      ticketCount: 2,
      deadline,
      sendEmail: true,
      now: new Date("2026-07-30T12:00:00.000Z"),
    });

    expect(generateSellerTransferReminderEmail).toHaveBeenCalledWith("order-1", "Pam", 2, deadline);
    expect(sendEmail).toHaveBeenCalledWith({
      to: "seller@example.com",
      subject: "Transfer reminder",
      text: "Transfer now",
      html: "<p>Transfer now</p>",
    });
  });

  it("does not email again when the reminder window was already handled", async () => {
    createNotificationOncePerWindow.mockResolvedValue({ ok: true, skipped: true });

    await notifySellerTransferRequired({
      sellerUserId: "seller-user",
      orderId: "order-1",
      ticketCount: 2,
      deadline: new Date("2026-07-30T16:00:00.000Z"),
      sendEmail: true,
      now: new Date("2026-07-30T12:00:00.000Z"),
    });

    expect(findUser).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("buyer transfer confirmation reminder email", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findUser.mockResolvedValue({ email: "buyer@example.com", firstName: "Alex" });
    sendEmail.mockResolvedValue({ ok: true });
  });

  it("emails the buyer when a new six-hour reminder is created", async () => {
    createNotificationOncePerWindow.mockResolvedValue({ ok: true, notification: { id: "notice-2" } });
    const deadline = new Date("2026-07-31T12:00:00.000Z");

    await notifyBuyerTransferConfirmationRequired({
      buyerUserId: "buyer-user",
      orderId: "order-2",
      ticketCount: 2,
      deadline,
      sendEmail: true,
      now: new Date("2026-07-30T18:00:00.000Z"),
    });

    expect(generateBuyerTransferConfirmationRequiredEmail).toHaveBeenCalledWith(
      "order-2",
      "Alex",
      2,
      deadline
    );
    expect(sendEmail).toHaveBeenCalledWith({
      to: "buyer@example.com",
      subject: "Confirm receipt",
      text: "Confirm receipt now",
      html: "<p>Confirm receipt now</p>",
    });
  });

  it("does not email again when the buyer reminder window was already handled", async () => {
    createNotificationOncePerWindow.mockResolvedValue({ ok: true, skipped: true });

    await notifyBuyerTransferConfirmationRequired({
      buyerUserId: "buyer-user",
      orderId: "order-2",
      ticketCount: 2,
      deadline: new Date("2026-07-31T12:00:00.000Z"),
      sendEmail: true,
      now: new Date("2026-07-30T18:00:00.000Z"),
    });

    expect(findUser).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
