import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { isAutoApprovalEligible } from "../src/lib/outreach-import-policy";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool), log: ["error"] });
function parseCsv(input: string) {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let i = 0; i < input.length; i++) { const char = input[i];
    if (quoted) { if (char === '"' && input[i + 1] === '"') { field += '"'; i++; } else if (char === '"') quoted = false; else field += char; }
    else if (char === '"') quoted = true; else if (char === ",") { row.push(field); field = ""; } else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift()?.map((x) => x.trim()) || [];
  return rows.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()])) as Record<string, string>);
}
function date(value: string) { if (!value) return null; const parsed = new Date(`${value}T00:00:00Z`); return Number.isNaN(parsed.getTime()) ? null : parsed; }
function value(input: string | undefined) { return input?.trim() || null; }
function key(parts: Array<string | null | undefined>) { return crypto.createHash("sha256").update(parts.map((x) => (x || "").trim().toLowerCase()).join("\u001f")).digest("hex"); }

type Source = { namespace: string; category: string; file: string; kind: "artist" | "sports" };
const workspace = path.resolve(process.cwd(), "../..");
const sources: Source[] = [
  { namespace: "artist", category: "ARTIST", file: path.join(workspace, "marketing/artist-contact-research.csv"), kind: "artist" },
  { namespace: "hockey", category: "SPORTS_HOCKEY", file: path.join(workspace, "marketing/sports-contacts/hockey.csv"), kind: "sports" },
  { namespace: "major-pro", category: "SPORTS_MAJOR_PRO", file: path.join(workspace, "marketing/sports-contacts/major-pro.csv"), kind: "sports" },
  { namespace: "college-other", category: "SPORTS_COLLEGE", file: path.join(workspace, "marketing/sports-contacts/college-other.csv"), kind: "sports" },
];

async function main() {
  let processed = 0;
  for (const source of sources) {
    if (!fs.existsSync(source.file)) { console.warn(`Skipping missing ${source.file}`); continue; }
    const rows = parseCsv(fs.readFileSync(source.file, "utf8"));
    for (let offset = 0; offset < rows.length; offset += 1000) {
      const dataRows = rows.slice(offset, offset + 1000).map((row) => {
        const isArtist = source.kind === "artist"; const organization = value(row.organization) || (isArtist ? null : value(row.team)); const subjectName = isArtist ? value(row.artist) : value(row.team);
        const role = value(row.role) || value(row.title) || value(row.department) || value(row.contact_type); const email = value(row.email); const normalizedEmail = email?.toLowerCase() || null; const sourceUrl = value(row.source_url);
        const externalKey = key([source.namespace, subjectName, organization, value(row.contact_name), role, email, value(row.phone), sourceUrl]);
        const data = { category: source.category, league: value(row.league), city: value(row.city), region: value(row.region), country: value(row.country), organization, subjectName, contactName: value(row.contact_name), role, email, normalizedEmail, phone: value(row.phone), websiteUrl: value(row.official_website) || value(row.team_website), sourceUrl, sourceType: value(row.source_type), verifiedAt: date(row.verified_date), confidence: value(row.confidence)?.toUpperCase() || null, researchStatus: value(row.status)?.toUpperCase() || null, notes: value(row.notes) };
        return { externalKey, ...data };
      });
      if (source.kind === "artist") {
        const researchedArtists = [...new Set(dataRows.filter((row) => row.researchStatus !== "PENDING").map((row) => row.subjectName).filter((name): name is string => Boolean(name)))];
        if (researchedArtists.length) {
          await prisma.outreachContact.deleteMany({
            where: {
              category: source.category,
              subjectName: { in: researchedArtists },
              researchStatus: "PENDING",
              email: null,
              recipients: { none: {} },
            },
          });
        }
      }
      await prisma.outreachContact.createMany({ data: dataRows, skipDuplicates: true }); processed += dataRows.length;
      if (source.kind === "sports") {
        for (let updateOffset = 0; updateOffset < dataRows.length; updateOffset += 100) {
          await prisma.$transaction(dataRows.slice(updateOffset, updateOffset + 100).map(({ externalKey, ...data }) =>
            prisma.outreachContact.update({ where: { externalKey }, data })
          ));
        }
      }
      if (processed % 5000 === 0) console.log(`Imported ${processed.toLocaleString()} rows`);
    }
  }
  const classificationCandidates = await prisma.outreachContact.findMany({
    where: {
      consentBasis: "UNASSESSED",
      email: { not: null },
      sourceUrl: { not: null },
      role: { not: null },
      confidence: "HIGH",
      researchStatus: { in: ["RESEARCHED", "VERIFIED"] },
    },
    select: { id: true, email: true, sourceUrl: true, sourceType: true, role: true, confidence: true, researchStatus: true },
  });
  const eligibleIds = classificationCandidates.filter(isAutoApprovalEligible).map((contact) => contact.id);
  let classifiedCount = 0;
  for (let offset = 0; offset < eligibleIds.length; offset += 1000) {
    const classified = await prisma.outreachContact.updateMany({
      where: { id: { in: eligibleIds.slice(offset, offset + 1000) } },
      data: {
        consentBasis: "CONSPICUOUSLY_PUBLISHED",
        consentEvidence: "High-confidence public professional address and role retained from an authoritative source URL.",
      },
    });
    classifiedCount += classified.count;
  }
  console.log(`Classified ${classifiedCount.toLocaleString()} high-confidence published business contact(s).`);
  console.log(`Outreach import complete: ${processed.toLocaleString()} rows processed.`);
}
main().finally(async () => { await prisma.$disconnect(); await pool.end(); });
