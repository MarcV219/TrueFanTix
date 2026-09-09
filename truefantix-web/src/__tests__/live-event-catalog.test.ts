import { LIVE_EVENT_CATALOG, searchCatalogSuggestions } from "@/lib/catalog/live-event-catalog";

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

  it("uses all 12 official PWHL team names", () => {
    const expected = [
      "Boston Fleet", "PWHL Detroit", "PWHL Hamilton", "PWHL Las Vegas",
      "Minnesota Frost", "Montréal Victoire", "New York Sirens", "Ottawa Charge",
      "PWHL San Jose", "Seattle Torrent", "Toronto Sceptres", "Vancouver Goldeneyes",
    ];
    const actual = LIVE_EVENT_CATALOG
      .filter((team) => team.type === "TEAM" && team.subtitle?.startsWith("PWHL ·"))
      .map((team) => team.value)
      .sort();
    expect(actual).toEqual([...expected].sort());
  });
});
