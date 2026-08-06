import { canonicalizeEventTitle, duplicateSeatBlocksSeller, eventIdentityKey } from "@/lib/tickets/eventIdentity";

describe("event identity", () => {
  it.each([
    "Green Bay vs Carolina",
    "Green Bay Packers vs Carolina Panthers",
    "Packers vs. Panthers",
  ])("normalizes %s to the full NFL team names", (title) => {
    expect(canonicalizeEventTitle(title)).toBe("Green Bay Packers vs. Carolina Panthers");
  });

  it("uses the canonical matchup when building event keys", () => {
    expect(eventIdentityKey("Packers vs Panthers", "2026-10-29 7:15 PM", "Lambeau Field"))
      .toBe(eventIdentityKey("Green Bay vs. Carolina", "2026-10-29 7:15 PM", "Lambeau Field"));
  });

  it("blocks active duplicate seats across sellers", () => {
    expect(duplicateSeatBlocksSeller("AVAILABLE", "seller-a", "seller-b")).toBe(true);
    expect(duplicateSeatBlocksSeller("RESERVED", "seller-a", "seller-b")).toBe(true);
  });

  it("allows a later owner to resell a sold seat but not the original seller", () => {
    expect(duplicateSeatBlocksSeller("SOLD", "seller-a", "seller-b")).toBe(false);
    expect(duplicateSeatBlocksSeller("SOLD", "seller-a", "seller-a")).toBe(true);
  });
});
