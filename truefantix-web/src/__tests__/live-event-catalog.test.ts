import { searchCatalogSuggestions } from "@/lib/catalog/live-event-catalog";

describe("live event catalog", () => {
  it("finds Monster Jam as a show", () => {
    expect(searchCatalogSuggestions({ query: "Monster Jam", type: "SHOW" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "SHOW",
          value: "Monster Jam",
        }),
      ])
    );
  });
});
