/** @jest-environment node */
import { outreachReplyAddress, outreachSender, sendOutreachEmail } from "@/lib/outreach-email";
import { contactMergeVars, defaultOutreachFollowUpAt, emailFromUnsubscribeToken, isGenericOutreachEmail, normalizeEmail, outreachContactLabel, recentContactCutoff, renderMerge, unsubscribeToken, wasRecentlyContacted } from "@/lib/outreach";
import { completeQuebecCollaborationHtml, outreachHtmlDocument, outreachHtmlToText, quebecCollaborationSubject, sanitizeOutreachHtml } from "@/lib/outreach-rich-text";
import { MAX_OUTREACH_CAMPAIGN_CONTACTS } from "@/lib/outreach-config";

describe("outreach security and personalization", () => {
  test("labels unnamed person-form addresses separately from departmental mailboxes", () => {
    expect(outreachContactLabel({ email: "elopez@la-sparks.com" })).toBe("Individual contact (name not published)");
    expect(outreachContactLabel({ email: "groups@team.example" })).toBe("Departmental contact");
    expect(outreachContactLabel({ contactName: "Emilia Lopez", email: "elopez@la-sparks.com" })).toBe("Emilia Lopez");
  });
  test("recognizes shared role mailboxes and never addresses them as an individual", () => {
    expect(isGenericOutreachEmail("tickets@ottawasenators.com")).toBe(true);
    expect(isGenericOutreachEmail("group-sales@example.com")).toBe(true);
    expect(isGenericOutreachEmail("brendan.duvall@ottawasenators.com")).toBe(false);
    expect(contactMergeVars({
      contactName: "Brendan Duvall",
      subjectName: "Ottawa Senators",
      email: "tickets@ottawasenators.com",
    })).toMatchObject({ firstName: "there", contactName: "" });
  });
  beforeEach(() => {
    process.env.OUTREACH_FROM_EMAIL = "marc@truefantix.com";
    process.env.OUTREACH_UNSUBSCRIBE_SECRET = "another-secure-test-key-at-least-32-characters";
    process.env.OUTREACH_RESEND_API_KEY = "test-key";
    delete process.env.RESEND_API_KEY;
    delete process.env.SENDGRID_API_KEY;
    jest.restoreAllMocks();
  });

  it("allows campaigns to contain and send up to 40 contacts", () => {
    expect(MAX_OUTREACH_CAMPAIGN_CONTACTS).toBe(40);
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

  it("guards against contacting an address again within 30 days", () => {
    const now = new Date("2026-09-04T16:00:00.000Z");
    expect(recentContactCutoff(now).toISOString()).toBe("2026-08-05T16:00:00.000Z");
    expect(wasRecentlyContacted("2026-08-20T12:00:00.000Z", now)).toBe(true);
    expect(wasRecentlyContacted("2026-07-20T12:00:00.000Z", now)).toBe(false);
  });

  it("defaults a successful email follow-up to 45 days after it was sent", () => {
    const sentAt = new Date("2026-09-08T16:00:00.000Z");
    expect(defaultOutreachFollowUpAt(sentAt).toISOString()).toBe("2026-10-23T16:00:00.000Z");
  });

  it("uses the team name for sports campaign personalization", () => {
    expect(contactMergeVars({
      subjectName: "Toronto Sceptres",
      organization: "Toronto Sceptres / Professional Women's Hockey League",
    })).toMatchObject({
      subjectName: "Toronto Sceptres",
      organization: "Toronto Sceptres",
    });
  });

  it("renders organization possessives correctly for every team name", () => {
    const template = "Support {{organization}}’s fans and {{organization}}'s members";
    expect(renderMerge(template, { organization: "Boston Fleet" })).toBe(
      "Support Boston Fleet’s fans and Boston Fleet’s members",
    );
    expect(renderMerge(template, { organization: "Toronto Sceptres" })).toBe(
      "Support Toronto Sceptres’ fans and Toronto Sceptres’ members",
    );
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
    expect(clean).toContain('<p style="margin:0 0 16px">');
    expect(clean).toContain('<li style="margin:0 0 6px">One</li>');
    expect(clean).not.toMatch(/script|onclick|javascript|font-size/);
    expect(outreachHtmlToText(clean)).toContain("• One");
  });

  it("uses a Gmail-safe bilingual layout and preserves the collaboration wording", () => {
    const clean = sanitizeOutreachHtml(completeQuebecCollaborationHtml);
    expect(clean).toContain("Français — English follows below");
    expect(clean).toContain("Version anglaise / English version");
    expect(clean).not.toContain('href="#francais"');
    expect(clean).not.toContain('href="#english"');
    expect(clean).toContain("Je m’appelle Marc Villeneuve");
    expect(clean).toContain("Aucuns frais pour les vendeurs");
    expect(clean).toContain("conversation exploratoire de 15 minutes");
    expect(clean).toContain("I’m Marc Villeneuve, founder of TrueFanTix");
    expect(clean).toContain("complement the {{organization}}’s existing ticketing programs");
    expect(clean).toContain("No seller fees");
    expect(clean).toContain("Reinforce the Organization’s commitment");
    expect(clean).toContain("15-minute introductory conversation");
    for (const phrase of [
      "nouvelle plateforme de revente de billets entre fans",
      "frais d’administration de 8,75 %",
      "conversation exploratoire de 15 minutes",
      "new fan-to-fan ticket marketplace",
      "8.75% administration fee",
      "15-minute introductory conversation",
    ]) {
      expect(clean).toContain(`<strong>${phrase}</strong>`);
    }
    expect(clean).toContain("Pour <strong>{{organization}}</strong>, nous croyons");
    expect(clean).toContain("For <strong>{{organization}}</strong>, we believe");
    expect(quebecCollaborationSubject).toContain("Une option de revente de billets axée sur les fans");
    expect(quebecCollaborationSubject).toContain("A fan-first ticket resale option for the {{organization}}");
  });

  it("adds the unsubscribe link to the rich email footer", () => {
    const html=outreachHtmlDocument("<p>Hello</p>","https://truefantix.ca/unsubscribe/outreach?token=x");
    expect(html).not.toContain("Marc Villeneuve");
    expect(html).not.toContain("Founder, TrueFanTix");
    expect(html).not.toContain("Marc@TrueFanTix.com");
    expect(html).not.toContain("TrueFanTix.com | TrueFanTix.ca");
    expect(html).toContain("TrueFanTix<br>1547 Gill Road");
    expect(html).not.toContain("TrueFanTix Inc.");
    expect(html).toContain("1547 Gill Road");
    expect(html).toContain("Midhurst, Ontario L9X 1M5");
    expect(html).toContain("This is a commercial message from TrueFanTix.");
    expect(html).toContain("Unsubscribe from TrueFanTix outreach emails");
    expect(html).toContain("token=x");
  });
});
