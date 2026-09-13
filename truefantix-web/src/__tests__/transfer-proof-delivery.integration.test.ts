/** @jest-environment node */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { sendEmail } from "@/lib/email";
import { sendAdminActivityEmail } from "@/lib/adminActivityEmail";
import {
  dispatchTransferProofDeliveryIntent,
  stageTransferProofDeliveryIntent,
} from "@/lib/orders/transferProofDelivery";

jest.mock("@/lib/email", () => ({
  generateBuyerTransferConfirmationRequiredEmail: jest.fn(() => ({ subject: "subject", text: "text" })),
  sendEmail: jest.fn(),
}));
jest.mock("@/lib/adminActivityEmail", () => ({
  ADMIN_ACTIVITY_EMAIL: "admin@truefantix.com",
  sendAdminActivityEmail: jest.fn(),
}));

const databaseUrl = process.env.PRIMARY_INTEGRATION_DATABASE_URL;
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;
const mockedSendAdmin = sendAdminActivityEmail as jest.MockedFunction<typeof sendAdminActivityEmail>;

if (!databaseUrl) describe.skip("transfer-proof delivery PostgreSQL boundary", () => {
  it("requires an isolated database", () => undefined);
}); else describe("transfer-proof delivery PostgreSQL boundary", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const runId = `${Date.now()}-${process.pid}`;
  const orderId = `transfer-proof-${runId}`;
  const buyerEmail = `transfer-proof-${runId}@example.test`;
  let buyerUserId = "";

  beforeAll(async () => {
    const buyer = await prisma.user.create({ data: {
      email: buyerEmail,
      passwordHash: "synthetic",
      firstName: "Buyer",
      lastName: "Boundary",
      phone: `+1${String(Date.now()).slice(-10)}`,
      streetAddress1: "1 Test Street",
      city: "Toronto",
      region: "ON",
      postalCode: "A1A1A1",
      country: "CA",
    } });
    buyerUserId = buyer.id;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendEmail.mockResolvedValue({ ok: true, provider: "CONSOLE", providerResult: "ACCEPTED" });
    mockedSendAdmin.mockResolvedValue({ ok: true, provider: "CONSOLE" });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: buyerUserId } });
    await prisma.reminderDelivery.deleteMany({ where: { orderId } });
    await prisma.emailDelivery.deleteMany({ where: { orderId } });
    await prisma.user.deleteMany({ where: { id: buyerUserId } });
    await prisma.$disconnect();
    await pool.end();
  });

  function params(suffix: string) {
    const now = new Date(`2026-12-01T${suffix}:00:00.000Z`);
    return {
      orderId,
      buyerUserId,
      buyerEmail,
      buyerFirstName: "Buyer",
      sellerEmail: "seller@example.test",
      ticketCount: 1,
      transferProofType: "EMAIL",
      deadline: new Date(now.getTime() + 86_400_000),
      now,
    };
  }

  it("rolls back all durable intents and performs zero external sends", async () => {
    await expect(prisma.$transaction(async (tx) => {
      await stageTransferProofDeliveryIntent(tx, params("01"));
      throw new Error("force rollback");
    }, { isolationLevel: "Serializable" })).rejects.toThrow("force rollback");

    await expect(prisma.notification.count({ where: { userId: buyerUserId } })).resolves.toBe(0);
    await expect(prisma.reminderDelivery.count({ where: { orderId } })).resolves.toBe(0);
    await expect(prisma.emailDelivery.count({ where: { orderId } })).resolves.toBe(0);
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
  });

  it("loses a real Serializable race without intent residue or pre-commit sends", async () => {
    let staged!: () => void;
    const stagedPromise = new Promise<void>((resolve) => { staged = resolve; });
    let competingCommitted!: () => void;
    const competingPromise = new Promise<void>((resolve) => { competingCommitted = resolve; });

    const loser = prisma.$transaction(async (tx) => {
      await tx.user.findUniqueOrThrow({ where: { id: buyerUserId } });
      await stageTransferProofDeliveryIntent(tx, params("07"));
      staged();
      await competingPromise;
      await tx.user.update({ where: { id: buyerUserId }, data: { lastName: "Losing transaction" } });
    }, { isolationLevel: "Serializable" });

    await stagedPromise;
    await prisma.$transaction(async (tx) => {
      await tx.user.findUniqueOrThrow({ where: { id: buyerUserId } });
      await tx.user.update({ where: { id: buyerUserId }, data: { lastName: "Winning transaction" } });
    }, { isolationLevel: "Serializable" });
    competingCommitted();

    await expect(loser).rejects.toMatchObject({ code: "P2034" });
    await expect(prisma.reminderDelivery.count({ where: { orderId } })).resolves.toBe(0);
    await expect(prisma.emailDelivery.count({ where: { orderId } })).resolves.toBe(0);
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
  });

  it("dispatches each claimed outbox intent only after commit", async () => {
    const intent = await prisma.$transaction(async (tx) => {
      const stagedIntent = await stageTransferProofDeliveryIntent(tx, params("13"));
      expect(mockedSendEmail).not.toHaveBeenCalled();
      expect(mockedSendAdmin).not.toHaveBeenCalled();
      return stagedIntent;
    }, { isolationLevel: "Serializable" });

    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedSendAdmin).not.toHaveBeenCalled();
    await dispatchTransferProofDeliveryIntent(intent, prisma);
    await dispatchTransferProofDeliveryIntent(intent, prisma);
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(mockedSendAdmin).toHaveBeenCalledTimes(1);
  });
});
