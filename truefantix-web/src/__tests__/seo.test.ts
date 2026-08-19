import { absoluteUrl, conciseDescription, safeJsonLd, schemaDate, SITE_URL } from "@/lib/seo";
import robots from "@/app/robots";

describe("SEO helpers", () => {
  it("builds canonical absolute URLs on the public www domain", () => {
    expect(absoluteUrl("/tickets/example")).toBe(`${SITE_URL}/tickets/example`);
  });

  it("keeps descriptions within the requested length", () => {
    const description = conciseDescription("word ".repeat(100), 80);
    expect(description.length).toBeLessThanOrEqual(80);
    expect(description.endsWith("…")).toBe(true);
  });

  it("normalizes parseable event dates for structured data", () => {
    expect(schemaDate("2026-08-19T18:00:00Z")).toBe("2026-08-19T18:00:00.000Z");
    expect(schemaDate("Date to be confirmed")).toBe("Date to be confirmed");
  });

  it("escapes HTML-significant characters in JSON-LD", () => {
    expect(safeJsonLd({ name: "</script>" })).not.toContain("</script>");
    expect(safeJsonLd({ name: "</script>" })).toContain("\\u003c/script>");
  });
});

describe("robots metadata", () => {
  it("advertises the sitemap and keeps private application areas out of search", () => {
    const result = robots();
    expect(result.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    expect(result.host).toBe(SITE_URL);
    expect(result.rules).toEqual(expect.objectContaining({
      disallow: expect.arrayContaining(["/account/", "/admin/", "/api/", "/checkout"]),
    }));
  });
});
