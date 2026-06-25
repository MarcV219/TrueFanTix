import { searchProviderCatalog } from "@/lib/catalog/provider-catalog";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    catalogEntity: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

const mockedFindMany = prisma.catalogEntity.findMany as jest.Mock;
const mockedUpsert = prisma.catalogEntity.upsert as jest.Mock;

describe("provider catalog suggestions", () => {
  beforeEach(() => {
    mockedFindMany.mockReset();
    mockedUpsert.mockReset();
    mockedUpsert.mockImplementation(async ({ create }) => ({ id: `${create.provider}-${create.providerId}`, ...create }));
  });

  it("keeps the best located venue when duplicate venue names come from multiple sources", async () => {
    mockedFindMany.mockResolvedValue([
      {
        id: "dukes-ticketmaster",
        type: "VENUE",
        canonicalName: "Duke's Live Music",
        provider: "ticketmaster",
        providerId: "dukes-ticketmaster",
        aliases: null,
        subtitle: "Ticketmaster venue",
        address: null,
        city: null,
        region: null,
        country: null,
        sourceUrl: null,
        popularity: 50,
        lastSeenAt: new Date("2026-06-25T12:00:00Z"),
      },
      {
        id: "dukes-web",
        type: "VENUE",
        canonicalName: "Duke's Live Music",
        provider: "web-search",
        providerId: "dukes-web",
        aliases: null,
        subtitle: "dukeslivemusic.com",
        address: "2 James Bartleman Way",
        city: "Port Carling",
        region: "ON",
        country: null,
        sourceUrl: "https://www.dukeslivemusic.com/",
        popularity: 0,
        lastSeenAt: new Date("2026-06-25T13:00:00Z"),
      },
    ]);

    const suggestions = await searchProviderCatalog({
      query: "Duke's Live Music",
      type: "VENUE",
      limit: 10,
      includeProviders: false,
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      canonicalName: "Duke's Live Music",
      address: "2 James Bartleman Way",
      city: "Port Carling",
      region: "ON",
    });
  });

  it("keeps same-name venues separate when locations differ", async () => {
    mockedFindMany.mockResolvedValue([
      {
        id: "forum-inglewood",
        type: "VENUE",
        canonicalName: "The Forum",
        provider: "static",
        providerId: "forum-inglewood",
        aliases: null,
        subtitle: null,
        address: "3900 W Manchester Blvd",
        city: "Inglewood",
        region: "CA",
        country: "USA",
        sourceUrl: null,
        popularity: 0,
        lastSeenAt: new Date("2026-06-25T12:00:00Z"),
      },
      {
        id: "forum-melbourne",
        type: "VENUE",
        canonicalName: "The Forum",
        provider: "web-search",
        providerId: "forum-melbourne",
        aliases: null,
        subtitle: null,
        address: "154 Flinders St",
        city: "Melbourne",
        region: "VIC",
        country: "Australia",
        sourceUrl: null,
        popularity: 0,
        lastSeenAt: new Date("2026-06-25T12:00:00Z"),
      },
    ]);

    const suggestions = await searchProviderCatalog({
      query: "The Forum",
      type: "VENUE",
      limit: 10,
      includeProviders: false,
    });

    expect(suggestions.map((item) => item.city).sort()).toEqual(["Inglewood", "Melbourne"]);
  });
});
