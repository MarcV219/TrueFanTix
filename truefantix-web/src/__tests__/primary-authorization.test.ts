/** @jest-environment node */
import { authorizePrimaryEvent, authorizePrimaryOrganizer, PrimaryAccessError } from "@/lib/primary/authorization";

const env = {
  NODE_ENV: "test",
  PRIMARY_TICKETING_ENABLED: "true",
  PRIMARY_TICKETING_ENVIRONMENT_ID: "isolated-test",
  PRIMARY_TICKETING_DEPLOYMENT_ID: "isolated-test",
  PRIMARY_TICKETING_DATABASE_URL: "postgresql://localhost/primary_ticketing_test",
  DATABASE_URL: "postgresql://localhost/primary_ticketing_test",
} as NodeJS.ProcessEnv;

function store() {
  return {
    primaryOrganizerMembership: { findFirst: jest.fn() },
    primaryEvent: { findFirst: jest.fn() },
    primaryEventStaffAssignment: { findFirst: jest.fn() },
  };
}

describe("primary tenant authorization", () => {
  it("denies cross-organizer access without querying a record globally", async () => {
    const db = store();
    db.primaryOrganizerMembership.findFirst.mockResolvedValue(null);

    await expect(authorizePrimaryOrganizer({
      store: db,
      actor: { id: "user-a", role: "USER" },
      organizerId: "organizer-b",
      env,
    })).rejects.toEqual(expect.objectContaining<Partial<PrimaryAccessError>>({ code: "NOT_FOUND", status: 404 }));

    expect(db.primaryOrganizerMembership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizerId: "organizer-b", userId: "user-a", status: "ACTIVE" }),
    }));
    expect(db.primaryEvent.findFirst).not.toHaveBeenCalled();
  });

  it("requires the event and assignment to share the organizer boundary", async () => {
    const db = store();
    db.primaryOrganizerMembership.findFirst.mockResolvedValue({ id: "member-a", organizerId: "organizer-a", role: "SCANNER" });
    db.primaryEvent.findFirst.mockResolvedValue({ id: "event-a", organizerId: "organizer-a" });
    db.primaryEventStaffAssignment.findFirst.mockResolvedValue({ id: "assignment-a" });

    await expect(authorizePrimaryEvent({
      store: db,
      actor: { id: "user-a", role: "USER" },
      organizerId: "organizer-a",
      eventId: "event-a",
      allowedRoles: ["SCANNER"],
      env,
    })).resolves.toMatchObject({ assignment: { id: "assignment-a" } });

    expect(db.primaryEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "event-a", organizerId: "organizer-a" },
    }));
    expect(db.primaryEventStaffAssignment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ eventId: "event-a", organizerId: "organizer-a", membershipId: "member-a" }),
    }));
  });

  it("never reaches the database when the feature is disabled", async () => {
    const db = store();
    await expect(authorizePrimaryOrganizer({
      store: db,
      actor: { id: "user-a", role: "USER" },
      organizerId: "organizer-a",
      env: { NODE_ENV: "test" },
    })).rejects.toMatchObject({ code: "PRIMARY_FEATURE_UNAVAILABLE" });
    expect(db.primaryOrganizerMembership.findFirst).not.toHaveBeenCalled();
  });
});
