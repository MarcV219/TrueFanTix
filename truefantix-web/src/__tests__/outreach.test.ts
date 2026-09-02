/** @jest-environment node */
import { buildGmailRaw, decryptGmailToken, encryptGmailToken, gmailAuthorizeUrl, renderMerge } from "@/lib/integrations/gmail";
import { emailFromUnsubscribeToken, normalizeEmail, unsubscribeToken } from "@/lib/outreach";

describe("outreach security and personalization", () => {
  beforeEach(() => {
    process.env.GOOGLE_GMAIL_CLIENT_ID = "client-id";
    process.env.GOOGLE_GMAIL_CLIENT_SECRET = "client-secret";
    process.env.OUTREACH_FROM_EMAIL = "marc@truefantix.com";
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY = "a-secure-test-key-that-is-at-least-32-characters";
    process.env.OUTREACH_UNSUBSCRIBE_SECRET = "another-secure-test-key-at-least-32-characters";
  });

  it("requests only send-only Gmail access and an offline refresh token", () => {
    const url = new URL(gmailAuthorizeUrl("state"));
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.send");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("encrypts Gmail tokens with authenticated encryption", () => {
    const encrypted = encryptGmailToken("secret-token");
    expect(encrypted).not.toContain("secret-token");
    expect(decryptGmailToken(encrypted)).toBe("secret-token");
    expect(() => decryptGmailToken(`${encrypted.slice(0, -1)}x`)).toThrow();
  });

  it("signs unsubscribe addresses and rejects tampering", () => {
    const token = unsubscribeToken(" Person@Example.com ");
    expect(emailFromUnsubscribeToken(token)).toBe("person@example.com");
    expect(emailFromUnsubscribeToken(`${token}x`)).toBeNull();
  });

  it("renders allowed merge fields and removes unknown values", () => {
    expect(renderMerge("Hi {{firstName}} from {{organization}} {{unknown}}", { firstName: "Marc", organization: "TrueFanTix" })).toBe("Hi Marc from TrueFanTix ");
    expect(normalizeEmail(" Test@Example.COM ")).toBe("test@example.com");
  });

  it("creates one-click unsubscribe MIME headers and blocks header injection", () => {
    const raw = buildGmailRaw({ from: "marc@truefantix.com", to: "person@example.com", subject: "Hello", text: "Message", unsubscribeUrl: "https://truefantix.com/unsubscribe/outreach?token=x" });
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    expect(mime).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    expect(() => buildGmailRaw({ from: "marc@truefantix.com", to: "person@example.com\r\nBcc: bad@example.com", subject: "Hello", text: "Message", unsubscribeUrl: "https://truefantix.com" })).toThrow("line breaks");
  });
});
