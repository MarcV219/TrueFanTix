/** @jest-environment node */
import { recordPrimaryAuditAndOutbox, redactPrimaryAuditSnapshot } from "@/lib/primary/audit-outbox";
import { requirePrimaryPreflight } from "@/lib/primary/config";

const isolatedEnv = {
  NODE_ENV: "test",
  PRIMARY_TICKETING_ENABLED: "true",
  PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-test",
  PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-test",
  PRIMARY_TICKETING_DATABASE_URL: "postgresql://localhost/primary_ticketing_test",
  DATABASE_URL: "postgresql://localhost/primary_ticketing_test",
} as NodeJS.ProcessEnv;

describe("primary audit and outbox foundation", () => {
  it("retains only allowlisted audit fields", () => {
    expect(redactPrimaryAuditSnapshot({
      status: "ACTIVE",
      supportEmail: "synthetic@example.test",
      tokenHash: "must-not-appear",
      businessNumberEncrypted: "must-not-appear",
    })).toEqual({ status: "ACTIVE", supportEmail: "synthetic@example.test" });
  });

  it("writes audit and outbox records through the caller transaction", async () => {
    const tx = {
      primaryAuditEvent: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) },
      primaryOutboxMessage: { create: jest.fn().mockResolvedValue({ id: "outbox-1" }) },
    };
    await expect(recordPrimaryAuditAndOutbox(requirePrimaryPreflight(isolatedEnv), tx, {
      organizerId: "organizer-1",
      actorUserId: "user-1",
      actorType: "USER",
      action: "MEMBERSHIP_REVOKED",
      targetType: "PrimaryOrganizerMembership",
      targetId: "membership-1",
      before: { status: "ACTIVE", tokenHash: "secret" },
      after: { status: "REVOKED" },
      topic: "primary.membership.revoked",
      payload: { membershipId: "membership-1" },
      idempotencyKey: "membership-1:revoked:v1",
    })).resolves.toEqual({ audit: { id: "audit-1" }, outbox: { id: "outbox-1" } });

    expect(tx.primaryAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ beforeJson: { status: "ACTIVE" }, afterJson: { status: "REVOKED" } }),
    }));
    expect(tx.primaryOutboxMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ idempotencyKey: "membership-1:revoked:v1" }),
    }));
  });

  it("rejects writes without a capability issued by successful preflight", async () => {
    const tx = {
      primaryAuditEvent: { create: jest.fn() },
      primaryOutboxMessage: { create: jest.fn() },
    };
    await expect(recordPrimaryAuditAndOutbox(
      { environmentId: "isolated-test", databaseName: "primary_ticketing_test" },
      tx,
      {
        actorType: "SYSTEM",
        action: "TEST",
        targetType: "Test",
        targetId: "test-1",
        topic: "primary.test",
        payload: {},
        idempotencyKey: "test-1:v1",
      },
    )).rejects.toMatchObject({ reason: "VERIFIED_PREFLIGHT_REQUIRED" });
    expect(tx.primaryAuditEvent.create).not.toHaveBeenCalled();
    expect(tx.primaryOutboxMessage.create).not.toHaveBeenCalled();
  });
});
