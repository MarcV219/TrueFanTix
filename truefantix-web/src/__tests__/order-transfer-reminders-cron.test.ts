/** @jest-environment node */

import { hasInternalCronAuth } from "@/lib/auth/guards";
import { runTransferReminderWorkflow } from "@/lib/orders/transferWorkflow";
import { drainTransferProofDeliveryIntents } from "@/lib/orders/transferProofDelivery";
import { drainTransferProofReviewDeliveryIntents } from "@/lib/orders/transferProofReviewDelivery";
import { recoverSpotifyCatalogRequestDeliveries } from "@/lib/integrations/spotify-catalog-request-delivery";
import { prisma } from "@/lib/prisma";
import { reportProductionIncident } from "@/lib/productionIncidents";
import { POST } from "@/app/api/cron/order-transfer-reminders/route";

jest.mock("@/lib/auth/guards", () => ({ hasInternalCronAuth: jest.fn() }));
jest.mock("@/lib/orders/transferWorkflow", () => ({ runTransferReminderWorkflow: jest.fn() }));
jest.mock("@/lib/orders/transferProofDelivery", () => ({ drainTransferProofDeliveryIntents: jest.fn() }));
jest.mock("@/lib/orders/transferProofReviewDelivery", () => ({ drainTransferProofReviewDeliveryIntents: jest.fn() }));
jest.mock("@/lib/integrations/spotify-catalog-request-delivery", () => ({ recoverSpotifyCatalogRequestDeliveries: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { auditLog: { create: jest.fn() } } }));
jest.mock("@/lib/productionIncidents", () => ({ reportProductionIncident: jest.fn() }));

const mockedCronAuth = hasInternalCronAuth as jest.MockedFunction<typeof hasInternalCronAuth>;
const mockedReminderWorkflow = runTransferReminderWorkflow as jest.MockedFunction<typeof runTransferReminderWorkflow>;
const mockedDeliveryDrainer = drainTransferProofDeliveryIntents as jest.MockedFunction<typeof drainTransferProofDeliveryIntents>;
const mockedReviewDrainer = drainTransferProofReviewDeliveryIntents as jest.MockedFunction<typeof drainTransferProofReviewDeliveryIntents>;
const mockedSpotifyDrainer = recoverSpotifyCatalogRequestDeliveries as jest.MockedFunction<typeof recoverSpotifyCatalogRequestDeliveries>;
const mockedAuditCreate = prisma.auditLog.create as jest.Mock;
const mockedReportIncident = reportProductionIncident as jest.MockedFunction<typeof reportProductionIncident>;

const deliveryResult = { scanned: 1, claimed: 1, delivered: 1, failed: 0, reconciliationRequired: 0 };
const reviewResult = { scanned: 1, claimed: 1, delivered: 1, failed: 0, reconciliationRequired: 0 };
const spotifyResult = { claimed: 1, delivered: 1, failed: 0, reconciliationRequired: 0 };
const reminderResult = { processed: 2 };

function request() {
  return new Request("http://localhost/api/cron/order-transfer-reminders", { method: "POST" });
}

describe("transfer reminder scheduler recovery isolation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCronAuth.mockReturnValue(true);
    mockedDeliveryDrainer.mockResolvedValue(deliveryResult);
    mockedReviewDrainer.mockResolvedValue(reviewResult);
    mockedSpotifyDrainer.mockResolvedValue(spotifyResult);
    mockedReminderWorkflow.mockResolvedValue(reminderResult as never);
    mockedAuditCreate.mockResolvedValue({ id: "audit-1" });
    mockedReportIncident.mockResolvedValue(undefined as never);
  });

  it("runs every independent component and records success", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: 2,
      transferProofDeliveries: deliveryResult,
      transferProofReviewDeliveries: reviewResult,
      spotifyCatalogRequestDeliveries: spotifyResult,
    });
    expect(mockedDeliveryDrainer).toHaveBeenCalledTimes(1);
    expect(mockedReviewDrainer).toHaveBeenCalledTimes(1);
    expect(mockedSpotifyDrainer).toHaveBeenCalledTimes(1);
    expect(mockedReminderWorkflow).toHaveBeenCalledTimes(1);
    expect(mockedAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "TRANSFER_REMINDER_SCHEDULER_RUN" }),
    }));
    expect(mockedReportIncident).not.toHaveBeenCalled();
  });

  it("still drains review deliveries and runs reminders when accepted-proof draining fails", async () => {
    mockedDeliveryDrainer.mockRejectedValue(new Error("accepted-proof poison"));

    await expect(POST(request())).rejects.toThrow(
      "Transfer reminder scheduler components failed: transferProofDeliveries",
    );

    expect(mockedReviewDrainer).toHaveBeenCalledTimes(1);
    expect(mockedSpotifyDrainer).toHaveBeenCalledTimes(1);
    expect(mockedReminderWorkflow).toHaveBeenCalledTimes(1);
    const metadata = JSON.parse(mockedAuditCreate.mock.calls[0][0].data.metadata);
    expect(metadata).toMatchObject({
      status: "FAILED",
      result: {
        components: {
          transferProofDeliveries: { status: "FAILED", error: "accepted-proof poison" },
          transferProofReviewDeliveries: { status: "SUCCESS", result: reviewResult },
          spotifyCatalogRequestDeliveries: { status: "SUCCESS", result: spotifyResult },
          transferReminders: { status: "SUCCESS", result: reminderResult },
        },
      },
    });
    expect(mockedReportIncident).toHaveBeenCalledTimes(1);
  });

  it("still runs reminders when review delivery draining fails", async () => {
    mockedReviewDrainer.mockRejectedValue(new Error("review poison"));

    await expect(POST(request())).rejects.toThrow(
      "Transfer reminder scheduler components failed: transferProofReviewDeliveries",
    );

    expect(mockedDeliveryDrainer).toHaveBeenCalledTimes(1);
    expect(mockedSpotifyDrainer).toHaveBeenCalledTimes(1);
    expect(mockedReminderWorkflow).toHaveBeenCalledTimes(1);
    expect(mockedReportIncident).toHaveBeenCalledTimes(1);
  });

  it("still runs reminders when Spotify catalog delivery recovery fails", async () => {
    mockedSpotifyDrainer.mockRejectedValue(new Error("Spotify delivery poison"));

    await expect(POST(request())).rejects.toThrow(
      "Transfer reminder scheduler components failed: spotifyCatalogRequestDeliveries",
    );

    expect(mockedDeliveryDrainer).toHaveBeenCalledTimes(1);
    expect(mockedReviewDrainer).toHaveBeenCalledTimes(1);
    expect(mockedReminderWorkflow).toHaveBeenCalledTimes(1);
    expect(mockedReportIncident).toHaveBeenCalledTimes(1);
  });

  it("refuses unauthenticated callers before any recovery work", async () => {
    mockedCronAuth.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mockedDeliveryDrainer).not.toHaveBeenCalled();
    expect(mockedReviewDrainer).not.toHaveBeenCalled();
    expect(mockedSpotifyDrainer).not.toHaveBeenCalled();
    expect(mockedReminderWorkflow).not.toHaveBeenCalled();
  });
});
