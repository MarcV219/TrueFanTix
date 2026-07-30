import { pastEventListingMessage } from "@/lib/tickets/expiry";

describe("past event listing validation", () => {
  const now = new Date("2026-07-30T14:00:00.000Z"); // 10:00 AM in Toronto

  it("rejects an event on a prior date", () => {
    expect(
      pastEventListingMessage(
        { date: "2026-07-29 7:00 PM", venue: "Toronto, Ontario" },
        now
      )
    ).toContain("already started or passed");
  });

  it("rejects an event that already started today", () => {
    expect(
      pastEventListingMessage(
        { date: "2026-07-30 9:00 AM", venue: "Toronto, Ontario" },
        now
      )
    ).toContain("already started or passed");
  });

  it("allows an upcoming event later today", () => {
    expect(
      pastEventListingMessage(
        { date: "2026-07-30 7:00 PM", venue: "Toronto, Ontario" },
        now
      )
    ).toBeNull();
  });

  it("allows an event on a future date", () => {
    expect(
      pastEventListingMessage(
        { date: "2026-08-01 7:00 PM", venue: "Toronto, Ontario" },
        now
      )
    ).toBeNull();
  });
});
