import { fetchOfficialSnapshot } from "@/lib/officialPricing";

const ticketmasterEvent = {
  name: "Toronto Raptors vs Boston Celtics",
  url: "https://www.ticketmaster.ca/event/example",
  dates: {
    start: {
      localDate: "2026-10-20",
      localTime: "19:00:00",
      dateTime: "2026-10-20T23:00:00Z",
    },
    status: { code: "onsale" },
  },
  priceRanges: [{ min: 80, max: 120 }],
  _embedded: {
    venues: [
      {
        name: "Scotiabank Arena",
        city: { name: "Toronto" },
      },
    ],
  },
};

type TicketmasterEventFixture = typeof ticketmasterEvent & {
  priceRanges?: Array<{ min: number; max: number; type?: string }>;
};

function mockTicketmasterResponse(events: TicketmasterEventFixture[]) {
  jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ _embedded: { events } }),
  } as Response);
}

describe("official pricing lookup", () => {
  const originalTicketmasterKey = process.env.TICKETMASTER_API_KEY;
  const originalBraveKey = process.env.BRAVE_API_KEY;

  beforeEach(() => {
    process.env.TICKETMASTER_API_KEY = "test-ticketmaster-key";
    process.env.BRAVE_API_KEY = "test-brave-key";
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env.TICKETMASTER_API_KEY = originalTicketmasterKey;
    process.env.BRAVE_API_KEY = originalBraveKey;
  });

  it("rejects Ticketmaster matches when the submitted venue name is wrong", async () => {
    mockTicketmasterResponse([ticketmasterEvent]);

    const result = await fetchOfficialSnapshot({
      title: "Toronto Raptors vs Boston Celtics",
      date: "2026-10-20 7:00 PM",
      venue: "Wrong Venue, Toronto",
      primaryVendor: "Ticketmaster",
    });

    expect(result.found).toBe(false);
    expect(result.reason).toBe("venue-not-confirmed");
    expect(result.officialVenueName).toBe("Scotiabank Arena");
  });

  it("accepts Ticketmaster matches when the submitted venue name matches", async () => {
    mockTicketmasterResponse([ticketmasterEvent]);

    const result = await fetchOfficialSnapshot({
      title: "Toronto Raptors vs Boston Celtics",
      date: "2026-10-20 7:00 PM",
      venue: "Scotiabank Arena, Toronto",
      primaryVendor: "Ticketmaster",
    });

    expect(result.found).toBe(true);
    expect(result.officialFaceValueCents).toBe(12000);
    expect(result.officialPriceRangeMinCents).toBe(8000);
    expect(result.officialPriceRangeMaxCents).toBe(12000);
    expect(result.officialServiceFeesCents).toBeNull();
    expect(result.officialStatusCode).toBe("onsale");
    expect(result.soldOut).toBe(false);
    expect(result.officialVenueName).toBe("Scotiabank Arena");
    expect(result.officialEventTime).toBe("7:00 PM");
  });

  it("accepts Ticketmaster matches when venue input includes a hyphenated city", async () => {
    const modClubEvent = {
      ...ticketmasterEvent,
      name: "Daniela Andrade - Oda Tour",
      url: "https://www.ticketmaster.ca/daniela-andrade-oda-tour-toronto-ontario-06-20-2026/event/example",
      dates: {
        start: {
          localDate: "2026-06-20",
          localTime: "19:00:00",
          dateTime: "2026-06-20T23:00:00Z",
        },
        status: { code: "onsale" },
      },
      priceRanges: [],
      _embedded: {
        venues: [
          {
            name: "The Mod Club",
            city: { name: "Toronto" },
          },
        ],
      },
    };
    mockTicketmasterResponse([modClubEvent]);

    const result = await fetchOfficialSnapshot({
      title: "Daniela Andrade",
      date: "2026-06-20 7:00 PM",
      venue: "The Mod Club - Toronto, ON",
      primaryVendor: "Ticketmaster",
    });

    expect(result.found).toBe(true);
    expect(result.officialEventTitle).toBe("Daniela Andrade - Oda Tour");
    expect(result.officialEventDate).toBe("2026-06-20");
    expect(result.officialEventTime).toBe("7:00 PM");
    expect(result.officialVenueName).toBe("The Mod Club");
  });

  it("marks Ticketmaster offsale events as sold out source status", async () => {
    mockTicketmasterResponse([
      {
        ...ticketmasterEvent,
        dates: {
          ...ticketmasterEvent.dates,
          status: { code: "offsale" },
        },
      },
    ]);

    const result = await fetchOfficialSnapshot({
      title: "Toronto Raptors vs Boston Celtics",
      date: "2026-10-20 7:00 PM",
      venue: "Scotiabank Arena, Toronto",
      primaryVendor: "Ticketmaster",
    });

    expect(result.found).toBe(true);
    expect(result.officialStatusCode).toBe("offsale");
    expect(result.soldOut).toBe(true);
    expect(result.soldOutSource).toBe("ticketmaster-event-status");
  });

  it("marks Ticketmaster resale-only events as sold out without treating resale as face value", async () => {
    mockTicketmasterResponse([
      {
        ...ticketmasterEvent,
        dates: {
          ...ticketmasterEvent.dates,
          status: { code: "onsale" },
        },
        priceRanges: [{ type: "resale", min: 178.5, max: 242 }],
      },
    ]);

    const result = await fetchOfficialSnapshot({
      title: "Toronto Raptors vs Boston Celtics",
      date: "2026-10-20 7:00 PM",
      venue: "Scotiabank Arena, Toronto",
      primaryVendor: "Ticketmaster",
    });

    expect(result.found).toBe(true);
    expect(result.officialStatusCode).toBe("onsale");
    expect(result.soldOut).toBe(true);
    expect(result.soldOutSource).toBe("ticketmaster-resale-only");
    expect(result.officialFaceValueCents).toBeNull();
    expect(result.officialPriceRangeMinCents).toBeNull();
    expect(result.officialPriceRangeMaxCents).toBeNull();
  });

  it("uses standard primary price ranges when Ticketmaster also exposes resale ranges", async () => {
    mockTicketmasterResponse([
      {
        ...ticketmasterEvent,
        priceRanges: [
          { type: "resale", min: 178.5, max: 242 },
          { type: "standard", min: 65, max: 95 },
        ],
      },
    ]);

    const result = await fetchOfficialSnapshot({
      title: "Toronto Raptors vs Boston Celtics",
      date: "2026-10-20 7:00 PM",
      venue: "Scotiabank Arena, Toronto",
      primaryVendor: "Ticketmaster",
    });

    expect(result.found).toBe(true);
    expect(result.soldOut).toBe(false);
    expect(result.soldOutSource).toBe("ticketmaster-event-status");
    expect(result.officialFaceValueCents).toBe(9500);
    expect(result.officialPriceRangeMinCents).toBe(6500);
    expect(result.officialPriceRangeMaxCents).toBe(9500);
  });

  it("resolves Ticketmaster event detail by id when broad event search misses but web fallback finds the event URL", async () => {
    const fetchMock = jest.spyOn(global, "fetch");
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ _embedded: { events: [] } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          web: {
            results: [
              {
                title: "Green Bay Packers vs Minnesota Vikings Tickets",
                description: "Official tickets for Sun Nov 15, 2026 at Lambeau Field, Green Bay.",
                url: "https://www.ticketmaster.com/green-bay-packers-vs-minnesota-vikings-green-bay-wisconsin-11-15-2026/event/0700646BCF6D88C8",
              },
            ],
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ...ticketmasterEvent,
          name: "Green Bay Packers vs Minnesota Vikings",
          url: "https://www.ticketmaster.com/green-bay-packers-vs-minnesota-vikings-green-bay-wisconsin-11-15-2026/event/0700646BCF6D88C8",
          dates: {
            start: {
              localDate: "2026-11-15",
              localTime: "12:00:00",
              dateTime: "2026-11-15T18:00:00Z",
            },
            status: { code: "onsale" },
          },
          priceRanges: [{ type: "verified resale", min: 350, max: 500 }],
          _embedded: {
            venues: [
              {
                name: "Lambeau Field",
                city: { name: "Green Bay" },
              },
            ],
          },
        }),
      } as Response);

    const result = await fetchOfficialSnapshot({
      title: "Green Bay Packers vs Minnesota Vikings",
      date: "2026-11-15 12:00 PM",
      venue: "Lambeau Field",
      primaryVendor: "Ticketmaster",
    });

    expect(result.found).toBe(true);
    expect(result.vendor).toBe("ticketmaster");
    expect(result.reason).toBe("confirmed-ticketmaster-event-id-fallback");
    expect(result.sourceUrl).toContain("/event/0700646BCF6D88C8");
    expect(result.soldOut).toBe(true);
    expect(result.soldOutSource).toBe("ticketmaster-resale-only");
    expect(result.officialFaceValueCents).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("confirms non-Ticketmaster events from official venue web results when Ticketmaster has no match", async () => {
    const fetchMock = jest.spyOn(global, "fetch");
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ _embedded: { events: [] } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          web: {
            results: [
              {
                title: "Danny Michel - Duke's Live Music",
                description: "Danny Michel concert at Duke's Live Music on July 31, 2026 at 7:00 PM. Tickets and reserved seating available.",
                url: "https://www.dukeslivemusic.com/2026-shows/danny-michel",
              },
            ],
          },
        }),
      } as Response);

    const result = await fetchOfficialSnapshot({
      title: "Danny Michel",
      date: "2026-07-31 7:00 PM",
      venue: "Duke's Live Music",
      primaryVendor: "Other",
    });

    expect(result.found).toBe(true);
    expect(result.vendor).toBe("primary-web");
    expect(result.reason).toBe("confirmed-official-web-fallback");
    expect(result.officialEventTitle).toBe("Danny Michel");
    expect(result.officialEventDate).toBe("2026-07-31");
    expect(result.officialEventTime).toBe("7:00 PM");
    expect(result.officialVenueName).toBe("Duke's Live Music");
    expect(result.sourceUrl).toBe("https://www.dukeslivemusic.com/2026-shows/danny-michel");
  });
});
