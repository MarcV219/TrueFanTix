import { buildEventStructuredData } from "@/lib/event-structured-data";

const base = {
  name: "Example Event",
  startDate: "2026-12-01T19:00:00-05:00",
  venueName: "Example Hall",
  url: "https://www.truefantix.com/events/example",
  image: ["https://www.truefantix.com/example.jpg"],
  fallbackDescription: "Verified tickets for Example Event at Example Hall.",
};

describe("Event structured data", () => {
  it("always includes a useful description", () => {
    expect(buildEventStructuredData(base)).toEqual(expect.objectContaining({
      "@type": "Event",
      description: base.fallbackDescription,
    }));
  });

  it("publishes verified optional facts", () => {
    const result = buildEventStructuredData({
      ...base,
      description: "An official description.",
      organizerName: "Example Presents",
      performerName: "Example Ensemble",
      endDate: "2026-12-01T21:00:00-05:00",
      seoVerifiedAt: "2026-11-10T17:00:00Z",
    });

    expect(result).toEqual(expect.objectContaining({
      description: "An official description.",
      organizer: { "@type": "Organization", name: "Example Presents" },
      performer: { "@type": "PerformingGroup", name: "Example Ensemble" },
      endDate: "2026-12-02T02:00:00.000Z",
    }));
  });

  it("never publishes unverified organizer, performer, or end time", () => {
    const result = buildEventStructuredData({
      ...base,
      organizerName: "Unverified Organizer",
      performerName: "Unverified Performer",
      endDate: "2026-12-01T21:00:00-05:00",
    });

    expect(result).not.toHaveProperty("organizer");
    expect(result).not.toHaveProperty("performer");
    expect(result).not.toHaveProperty("endDate");
  });
});
