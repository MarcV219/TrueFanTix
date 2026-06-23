import { resolveCatalogRequest } from "@/lib/catalog/request-resolver";
import { searchProviderCatalog } from "@/lib/catalog/provider-catalog";

jest.mock("@/lib/catalog/provider-catalog", () => ({
  searchProviderCatalog: jest.fn(),
}));

const mockedSearchProviderCatalog = searchProviderCatalog as jest.MockedFunction<typeof searchProviderCatalog>;

function suggestion(overrides: Partial<Awaited<ReturnType<typeof searchProviderCatalog>>[number]>) {
  return {
    type: "ARTIST" as const,
    value: "Ice Cube",
    label: "Ice Cube",
    canonicalName: "Ice Cube",
    catalogEntityId: "catalog-ice-cube",
    provider: "wikidata",
    providerId: "Q174346:artist",
    subtitle: "American rapper and actor - Wikidata",
    ...overrides,
  };
}

describe("catalog request resolver", () => {
  beforeEach(() => {
    mockedSearchProviderCatalog.mockReset();
  });

  it("auto-resolves a single exact provider match", async () => {
    mockedSearchProviderCatalog.mockResolvedValue([suggestion({})]);

    const result = await resolveCatalogRequest({ type: "ARTIST", value: "Ice Cube" });

    expect(result.status).toBe("FOUND");
    if (result.status === "FOUND") {
      expect(result.suggestion.canonicalName).toBe("Ice Cube");
      expect(result.suggestion.catalogEntityId).toBe("catalog-ice-cube");
    }
  });

  it("asks for clarification when exact matches are ambiguous", async () => {
    mockedSearchProviderCatalog.mockResolvedValue([
      suggestion({
        type: "VENUE",
        providerId: "venue-1",
        canonicalName: "The Forum",
        label: "The Forum",
        value: "The Forum",
        city: "Inglewood",
      }),
      suggestion({
        type: "VENUE",
        providerId: "venue-2",
        canonicalName: "The Forum",
        label: "The Forum",
        value: "The Forum",
        city: "Melbourne",
      }),
    ]);

    const result = await resolveCatalogRequest({ type: "VENUE", value: "The Forum" });

    expect(result.status).toBe("NEEDS_CLARIFICATION");
    if (result.status === "NEEDS_CLARIFICATION") {
      expect(result.suggestions).toHaveLength(2);
      expect(result.question).toContain("Which one did you mean?");
    }
  });

  it("falls back to manual review when no reliable provider match exists", async () => {
    mockedSearchProviderCatalog.mockResolvedValue([]);

    await expect(resolveCatalogRequest({ type: "ARTIST", value: "Not A Real Artist" })).resolves.toEqual({
      status: "NOT_FOUND",
    });
  });
});
