import sanitizeHtmlLibrary from "sanitize-html";

const allowedTags = ["p", "div", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a"];

const emailBlockStyles: Record<string, string> = {
  p: "margin:0 0 16px",
  ul: "margin:0 0 16px;padding-left:28px",
  ol: "margin:0 0 16px;padding-left:28px",
  li: "margin:0 0 6px",
};

export const outreachLegalFooterText = `TrueFanTix
1547 Gill Road
Midhurst, Ontario L9X 1M5
Canada

This is a commercial message from TrueFanTix.`;

export function sanitizeOutreachHtml(value: string) {
  return sanitizeHtmlLibrary(value, {
    allowedTags,
    allowedAttributes: {
      a: ["href", "title", "target", "style"],
      p: ["id", "style"],
      div: ["id"],
      ul: ["style"],
      ol: ["style"],
      li: ["style"],
    },
    allowedStyles: {
      a: {
        "background-color": [/^#[0-9a-f]{3,6}$/i],
        color: [/^#[0-9a-f]{3,6}$/i],
        display: [/^inline-block$/],
        padding: [/^\d{1,2}px \d{1,2}px$/],
        "border-radius": [/^\d{1,2}px$/],
        "text-decoration": [/^none$/],
        "font-weight": [/^(bold|[5-9]00)$/],
        margin: [/^\d{1,2}px$/],
      },
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: attribs.href?.startsWith("#")
          ? { ...attribs }
          : { ...attribs, target: "_blank" },
      }),
      ...Object.fromEntries(Object.entries(emailBlockStyles).map(([tagName, style]) => [tagName, (_name: string, attribs: Record<string, string>) => ({ tagName, attribs: { ...attribs, style } })])),
    },
    exclusiveFilter(frame) {
      return frame.tag === "a" && !frame.attribs.href;
    },
  }).trim();
}

export const quebecCollaborationSubject =
  "Collaboration avec {{organization}} / Collaboration with {{organization}}";

export const quebecCollaborationHtml = `<p><strong>Choisissez votre langue / Choose your language</strong></p><p><a href="#francais" style="background-color:#1d4ed8;color:#ffffff;display:inline-block;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold;margin:4px">Français</a> <a href="#english" style="background-color:#1d4ed8;color:#ffffff;display:inline-block;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold;margin:4px">English</a></p><p id="francais"><strong>Français</strong></p><p>Bonjour {{firstName}},</p><p>Je vous écris au sujet d’une possibilité de collaboration entre {{organization}} et TrueFanTix.</p><p>TrueFanTix est une place de marché canadienne où les amateurs peuvent acheter et revendre des billets à leur prix d’origine ou à un prix inférieur. Nous aimerions discuter de la façon dont nous pourrions soutenir vos partisans et vos objectifs de billetterie.</p><p>Seriez-vous disponible pour une brève conversation?</p><p>Merci,<br>Marc<br>TrueFanTix</p><p id="english"><strong>English</strong></p><p>Hi {{firstName}},</p><p>I’m reaching out about a potential collaboration between {{organization}} and TrueFanTix.</p><p>TrueFanTix is a Canadian marketplace where fans can buy and resell tickets at or below their original price. We’d like to discuss how we could support your fans and ticketing goals.</p><p>Would you be open to a brief conversation?</p><p>Thanks,<br>Marc<br>TrueFanTix</p>`;

export function outreachHtmlToText(value: string) {
  const blockAware = value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|li|ul|ol)>/gi, "\n");
  return sanitizeHtmlLibrary(blockAware, { allowedTags: [], allowedAttributes: {} })
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function outreachHtmlDocument(bodyHtml: string, unsubscribeUrl: string) {
  const footerHtml = outreachLegalFooterText.replaceAll("\n", "<br>");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#111827">${bodyHtml}<div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280">${footerHtml}<br><a href="${unsubscribeUrl}">Unsubscribe from TrueFanTix outreach emails</a></div></div>`;
}
