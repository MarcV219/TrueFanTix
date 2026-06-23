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

type TicketmasterEventFixture = typeof ticketmasterEvent;

function mockTicketmasterResponse(events: TicketmasterEventFixture[]) {
  jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ _embedded: { events } }),
  } as Response);
}

describe("official pricing lookup", () => {
  const originalTicketmasterKey = process.env.TICKETMASTER_API_KEY;

  beforeEach(() => {
    process.env.TICKETMASTER_API_KEY = "test-ticketmaster-key";
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env.TICKETMASTER_API_KEY = originalTicketmasterKey;
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
});
