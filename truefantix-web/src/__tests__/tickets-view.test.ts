import { mapApiTicketToCard } from "@/lib/ticketsView";

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
});
