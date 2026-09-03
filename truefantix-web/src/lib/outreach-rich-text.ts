import sanitizeHtmlLibrary from "sanitize-html";

const allowedTags = ["p", "div", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a"];

export function sanitizeOutreachHtml(value: string) {
  return sanitizeHtmlLibrary(value, {
    allowedTags,
    allowedAttributes: { a: ["href", "title", "target"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (_tagName, attribs) => ({ tagName: "a", attribs: { ...attribs, target: "_blank" } }),
    },
    exclusiveFilter(frame) {
      return frame.tag === "a" && !frame.attribs.href;
    },
  }).trim();
}

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
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#111827">${bodyHtml}<div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280">TrueFanTix Inc.<br>Toronto, Ontario, Canada<br><a href="${unsubscribeUrl}">Unsubscribe from TrueFanTix outreach emails</a></div></div>`;
}
