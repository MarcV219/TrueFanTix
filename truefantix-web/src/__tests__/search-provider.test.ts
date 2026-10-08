import { paidBraveFallbackEnabled, searchImages, searchWeb } from "@/lib/searchProvider";

const mockedFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe("local search provider", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    global.fetch = mockedFetch;
    delete process.env.BRAVE_SEARCH_FALLBACK_ENABLED;
    process.env.SEARXNG_BASE_URL = "http://127.0.0.1:8888/";
  });

  it("normalizes local web results", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ title: "Official venue", url: "https://venue.example/event", content: "Event details", engine: "test" }],
      }),
    } as Response);

    await expect(searchWeb("example event", 5)).resolves.toEqual([
      {
        title: "Official venue",
        url: "https://venue.example/event",
        description: "Event details",
        source: "test",
      },
    ]);
    expect(String(mockedFetch.mock.calls[0][0])).toContain("http://127.0.0.1:8888/search?");
  });

  it("normalizes image results and ignores rows without an image URL", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: "Team", url: "https://team.example", img_src: "https://cdn.example/team.jpg", engine: "images" },
          { title: "No image", url: "https://example.invalid" },
        ],
      }),
    } as Response);

    const results = await searchImages("team", 10);
    expect(results).toHaveLength(1);
    expect(results[0].imageUrl).toBe("https://cdn.example/team.jpg");
  });

  it("fails closed and leaves paid Brave fallback off by default", async () => {
    mockedFetch.mockRejectedValue(new Error("offline"));
    await expect(searchWeb("anything")).resolves.toEqual([]);
    expect(paidBraveFallbackEnabled()).toBe(false);
    process.env.BRAVE_SEARCH_FALLBACK_ENABLED = "true";
    expect(paidBraveFallbackEnabled()).toBe(true);
  });
});
