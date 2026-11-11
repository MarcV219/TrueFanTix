import { isReservationExpired } from "@/lib/tickets/reservation-expiry";

describe("reservation expiry boundary", () => {
  const boundary = new Date("2030-01-01T00:00:00.000Z");

  it.each([
    ["one millisecond before", new Date(boundary.getTime() - 1), false],
    ["at the boundary", new Date(boundary.getTime()), true],
    ["one millisecond after", new Date(boundary.getTime() + 1), true],
  ])("is deterministic %s", (_label, now, expected) => {
    expect(isReservationExpired(boundary, now)).toBe(expected);
  });

  it("fails closed when the reservation has no expiry", () => {
    expect(isReservationExpired(null, boundary)).toBe(true);
  });
});
