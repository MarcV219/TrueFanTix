const PROFESSIONAL_ROLE = /\b(booking|agent|management|manager|press|publicity|public relations|partnership|licensing|business|professional|record label|promoter|talent)\b/i;
const EXCLUDED_ROLE = /\b(fan mail|merch|store|order|customer support|privacy|copyright|dmca|abuse|careers?|webmaster)\b/i;
const AUTHORITATIVE_SOURCE = /\b(official artist|artist-linked|official (talent|booking|management|record|label|agency|promoter)|official professional)\b/i;

export type OutreachImportEvidence = {
  email?: string | null;
  sourceUrl?: string | null;
  sourceType?: string | null;
  role?: string | null;
  confidence?: string | null;
  researchStatus?: string | null;
};

export function isAutoApprovalEligible(evidence: OutreachImportEvidence) {
  const role = evidence.role?.trim() || "";
  const sourceType = evidence.sourceType?.replaceAll("_", " ").trim() || "";
  if (!evidence.email || !evidence.sourceUrl || !role) return false;
  let source: URL;
  try {
    source = new URL(evidence.sourceUrl);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(source.protocol) || /\s|\|/.test(evidence.sourceUrl)) return false;
  if (evidence.confidence !== "HIGH") return false;
  if (!["RESEARCHED", "VERIFIED"].includes(evidence.researchStatus || "")) return false;
  if (!PROFESSIONAL_ROLE.test(role) || EXCLUDED_ROLE.test(role)) return false;
  return AUTHORITATIVE_SOURCE.test(sourceType);
}
