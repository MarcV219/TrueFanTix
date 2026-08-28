import {
  attributionSource,
  sanitizeAttribution,
  sanitizeReferrerHost,
} from "@/lib/analytics/campaign-attribution";

describe("campaign attribution", () => {
  it("keeps sanitized campaign labels and an external referring host", () => {
    const value = sanitizeAttribution({
      source: " facebook ",
      medium: " social ",
      campaign: "mlb-fan-groups",
      content: "blue-jays-post",
      term: "tickets",
      firstPath: "/register",
      referrerHost: "https://www.facebook.com/groups/example?private=value",
    });

    expect(value).toEqual({
      source: "facebook",
      medium: "social",
      campaign: "mlb-fan-groups",
      content: "blue-jays-post",
      term: "tickets",
      firstPath: "/register",
      referrerHost: "facebook.com",
    });
    expect(attributionSource(value)).toBe("facebook");
  });

  it("drops internal referrers, unsafe paths, and control characters", () => {
    const value = sanitizeAttribution({
      source: "news\nletter",
      firstPath: "//malicious.example",
      referrerHost: "https://truefantix.ca/tickets?token=secret",
    });

    expect(value.source).toBe("newsletter");
    expect(value.firstPath).toBeNull();
    expect(value.referrerHost).toBeNull();
  });

  it("is idempotent when a stored hostname is sanitized again", () => {
    expect(sanitizeReferrerHost("www.instagram.com")).toBe("instagram.com");
  });
});
