/** @jest-environment node */
import { isAllowedImageProxyUrl } from "@/app/api/image-proxy/route";

describe("image proxy URL security", () => {
  const hosts = new Set(["images.example.com"]);

  it("allows only explicitly configured HTTPS image hosts", () => {
    expect(isAllowedImageProxyUrl(new URL("https://images.example.com/photo.jpg"), hosts)).toBe(true);
    expect(isAllowedImageProxyUrl(new URL("https://other.example.com/photo.jpg"), hosts)).toBe(false);
    expect(isAllowedImageProxyUrl(new URL("http://images.example.com/photo.jpg"), hosts)).toBe(false);
  });

  it("rejects credentials and private or local destinations", () => {
    expect(isAllowedImageProxyUrl(new URL("https://user:pass@images.example.com/photo.jpg"), hosts)).toBe(false);
    expect(isAllowedImageProxyUrl(new URL("https://127.0.0.1/photo.jpg"), new Set(["127.0.0.1"]))).toBe(false);
    expect(isAllowedImageProxyUrl(new URL("https://169.254.169.254/latest/meta-data"), new Set(["169.254.169.254"]))).toBe(false);
    expect(isAllowedImageProxyUrl(new URL("https://service.internal/photo.jpg"), new Set(["service.internal"]))).toBe(false);
  });
});
