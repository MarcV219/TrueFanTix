import { inferCoordsFromCity, isTicketWithinRadius, mapApiTicketToCard } from "@/lib/ticketsView";

describe("tickets view", () => {
  it("prefers catalog venue location over venue-name fallback", () => {
    const card = mapApiTicketToCard({
      id: "ticket-1",
      title: "Danny Michel",
      date: "2026-07-31 7:00 PM",
      venue: "Duke's Live Music",
      venueLocation: {
        address: "2 James Bartleman Way",
        city: "Port Carling",
        region: "ON",
        country: null,
      },
      priceCents: 10000,
      currency: "CAD",
      image: "/default.jpg",
      sellerId: "seller-1",
      seller: null,
    });

    expect(card.venueAddress).toBe("2 James Bartleman Way");
    expect(card.city).toBe("Port Carling");
    expect(card.province).toBe("ON");
    expect(card.country).toBe("Canada");
  });

  it("does not invent Toronto for a single-name venue without a resolved location", () => {
    const card = mapApiTicketToCard({
      id: "ticket-2",
      title: "Chicago Bears vs. Green Bay Packers",
      date: "2026-12-25 12:00 PM",
      venue: "Soldier Field",
      venueLocation: {
        address: null,
        city: null,
        region: null,
        country: null,
      },
      priceCents: 35700,
      currency: "USD",
      image: "/default.jpg",
      sellerId: "seller-1",
      seller: null,
    });

    expect(card.city).toBe("");
    expect(card.province).toBe("");
    expect(card.country).toBe("");
  });

  it("matches tickets within a city radius", () => {
    const chicago = inferCoordsFromCity("Chicago");
    const toronto = inferCoordsFromCity("Toronto");
    const portCarling = inferCoordsFromCity("Port Carling");

    expect(chicago).toEqual(expect.any(Object));
    expect(toronto).toEqual(expect.any(Object));
    expect(portCarling).toEqual(expect.any(Object));

    expect(isTicketWithinRadius({ city: "Chicago", venue: "Soldier Field" }, chicago!, 25)).toBe(true);
    expect(isTicketWithinRadius({ city: "Toronto", venue: "Scotiabank Arena" }, chicago!, 25)).toBe(false);
    expect(isTicketWithinRadius({ city: "Chicago", venue: "Soldier Field" }, toronto!, 25)).toBe(false);
    expect(isTicketWithinRadius({ city: "Port Carling", venue: "Duke's Live Music" }, portCarling!, 10)).toBe(true);
  });
});
