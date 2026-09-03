/** @jest-environment node */
import { outreachReplyAddress, outreachSender, sendOutreachEmail } from "@/lib/outreach-email";
import { emailFromUnsubscribeToken, normalizeEmail, unsubscribeToken } from "@/lib/outreach";
import { outreachHtmlDocument, outreachHtmlToText, sanitizeOutreachHtml } from "@/lib/outreach-rich-text";

describe("outreach security and personalization", () => {
  beforeEach(() => {
    process.env.OUTREACH_FROM_EMAIL = "marc@truefantix.com";
    process.env.OUTREACH_UNSUBSCRIBE_SECRET = "another-secure-test-key-at-least-32-characters";
    process.env.OUTREACH_RESEND_API_KEY = "test-key";
    delete process.env.RESEND_API_KEY;
    delete process.env.SENDGRID_API_KEY;
    jest.restoreAllMocks();
  });

  it("signs unsubscribe addresses and rejects tampering", () => {
    const token = unsubscribeToken(" Person@Example.com ");
    expect(emailFromUnsubscribeToken(token)).toBe("person@example.com");
    expect(emailFromUnsubscribeToken(`${token}x`)).toBeNull();
  });

  it("uses the branded TrueFanTix sender", () => {
  expect(outreachSender()).toBe("Marc at TrueFanTix <marc@truefantix.com>");
  expect(outreachReplyAddress("abc123")).toBe("reply+abc123@replies.truefantix.com");
    expect(normalizeEmail(" Test@Example.COM ")).toBe("test@example.com");
  });

  it("sends through Resend with reply-to and one-click unsubscribe headers", async () => {
    const request=jest.spyOn(global,"fetch").mockResolvedValue(new Response(JSON.stringify({id:"email_123"}),{status:200,headers:{"Content-Type":"application/json"}}));
    await expect(sendOutreachEmail({to:"person@example.com",subject:"Hello",text:"Message",unsubscribeUrl:"https://truefantix.com/unsubscribe/outreach?token=x"})).resolves.toEqual({provider:"RESEND",messageId:"email_123"});
    const payload=JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(payload.from).toBe("Marc at TrueFanTix <marc@truefantix.com>");
    expect(payload.reply_to).toBe("marc@truefantix.com");
    expect(payload.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("preserves safe rich text and removes unsafe pasted Word markup", () => {
    const clean=sanitizeOutreachHtml('<p style="font-size:99px" onclick="bad()"><strong>Hello</strong> <script>bad()</script><a href="javascript:bad()">team</a></p><ul><li>One</li></ul>');
    expect(clean).toContain("<strong>Hello</strong>");
    expect(clean).toContain("<li>One</li>");
    expect(clean).not.toMatch(/script|onclick|javascript|font-size/);
    expect(outreachHtmlToText(clean)).toContain("• One");
  });

  it("adds the unsubscribe link to the rich email footer", () => {
    const html=outreachHtmlDocument("<p>Hello</p>","https://truefantix.ca/unsubscribe/outreach?token=x");
    expect(html).toContain("Unsubscribe from TrueFanTix outreach emails");
    expect(html).toContain("token=x");
  });
});
