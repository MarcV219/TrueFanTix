import { saveWebVenueCandidate, searchWebVenueCandidates } from "@/lib/catalog/web-venue-search";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    catalogEntity: {
      upsert: jest.fn(),
    },
  },
}));

function jsonResponse(data: unknown) {
  return {
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

function htmlResponse(html: string) {
  return {
    ok: true,
    headers: { get: () => "text/html; charset=utf-8" },
    json: async () => ({}),
    text: async () => html,
  } as unknown as Response;
}

const mockedFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
const mockedUpsert = prisma.catalogEntity.upsert as jest.Mock;

describe("web venue search", () => {
  beforeEach(() => {
    process.env.BRAVE_API_KEY = "brave-test-key";
    mockedFetch.mockReset();
    mockedUpsert.mockReset();
    global.fetch = mockedFetch;
  });

  it("finds a web venue result and enriches it with visible address information", async () => {
    mockedFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes("nominatim.openstreetmap.org")) {
        return jsonResponse([]);
      }
      if (href.includes("api.search.brave.com")) {
        return jsonResponse({
          web: {
            results: [
              {
                title: "Duke's Live Music",
                description: "Live music upstairs at Duke's in Port Carling.",
                url: "https://www.dukeslivemusic.com/",
              },
            ],
          },
        });
      }
      if (href === "https://www.dukeslivemusic.com/") {
        return htmlResponse(`
          <html>
            <body>
              <h1>Duke's Live Music</h1>
              <p>Welcome to our 50-seat boathouse concert venue in Port Carling.</p>
              <p>2 James Bartleman Way, PO Box 366, Port Carling, ON P0B 1J0</p>
            </body>
          </html>
        `);
      }
      return jsonResponse({});
    });

    const candidates = await searchWebVenueCandidates({ query: "Duke's Live Music", limit: 5 });

    expect(candidates[0]).toMatchObject({
      canonicalName: "Duke's Live Music",
      address: "2 James Bartleman Way",
      city: "Port Carling",
      region: "ON",
      sourceUrl: "https://www.dukeslivemusic.com/",
    });
  });

  it("stores selected web venue candidates with address and source details", async () => {
    mockedUpsert.mockResolvedValue({
      id: "catalog-dukes",
      type: "VENUE",
      canonicalName: "Duke's Live Music",
      provider: "web-search",
      providerId: "dukes-web",
      address: "2 James Bartleman Way",
      city: "Port Carling",
      region: "ON",
      country: "Canada",
      sourceUrl: "https://www.dukeslivemusic.com/",
    });

    await saveWebVenueCandidate({
      type: "VENUE",
      label: "Duke's Live Music",
      canonicalName: "Duke's Live Music",
      provider: "web-search",
      providerId: "dukes-web",
      address: "2 James Bartleman Way",
      city: "Port Carling",
      region: "ON",
      country: "Canada",
      sourceUrl: "https://www.dukeslivemusic.com/",
      sourceName: "dukeslivemusic.com",
      confidence: 98,
    });

    expect(mockedUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        type: "VENUE",
        canonicalName: "Duke's Live Music",
        provider: "web-search",
        providerId: "dukes-web",
        address: "2 James Bartleman Way",
        city: "Port Carling",
        region: "ON",
        country: "Canada",
        sourceUrl: "https://www.dukeslivemusic.com/",
      }),
      update: expect.objectContaining({
        address: "2 James Bartleman Way",
        city: "Port Carling",
        region: "ON",
        country: "Canada",
        sourceUrl: "https://www.dukeslivemusic.com/",
      }),
    }));
  });
});
