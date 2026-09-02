import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/outreach";

const BASES = new Set(["UNASSESSED", "EXPRESS_CONSENT", "EXISTING_BUSINESS_RELATIONSHIP", "CONSPICUOUSLY_PUBLISHED", "NOT_REQUIRED"]);
export async function GET(req: Request) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  const url = new URL(req.url); const q = (url.searchParams.get("q") || "").trim(); const category = url.searchParams.get("category") || "";
  const league = url.searchParams.get("league") || ""; const city = url.searchParams.get("city") || ""; const team = url.searchParams.get("team") || "";
  const email = url.searchParams.get("email") || "";
  const sendable = url.searchParams.get("sendable"); const page = Math.max(1, Number(url.searchParams.get("page")) || 1); const take = Math.min(100, Math.max(10, Number(url.searchParams.get("take")) || 50));
  const where: any = {};
  if (q) where.OR = ["organization", "subjectName", "contactName", "role", "email"].map((field) => ({ [field]: { contains: q, mode: "insensitive" } }));
  if (category) where.category = category;
  if (league) where.league = league;
  if (city) where.city = city;
  if (team) where.subjectName = team;
  if (sendable === "true") { where.email = { not: null }; where.normalizedEmail = { not: null }; where.unsubscribedAt = null; where.consentBasis = { not: "UNASSESSED" }; where.sourceUrl = { not: null }; }
  if (email === "yes") where.email = { not: null };
  if (email === "no") where.email = null;
  const [items, count, totalCount, categories, leagues, cities, teams, suppressions] = await prisma.$transaction([
    prisma.outreachContact.findMany({ where, orderBy: [{ lastContactedAt: "asc" }, { organization: "asc" }], skip: (page - 1) * take, take }),
    prisma.outreachContact.count({ where }),
    prisma.outreachContact.count(),
    prisma.outreachContact.findMany({ distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
    prisma.outreachContact.findMany({ where: { league: { not: null } }, distinct: ["league"], select: { league: true }, orderBy: { league: "asc" } }),
    prisma.outreachContact.findMany({ where: { city: { not: null } }, distinct: ["city"], select: { city: true }, orderBy: { city: "asc" } }),
    prisma.outreachContact.findMany({ where: { league: { not: null }, subjectName: { not: null } }, distinct: ["subjectName"], select: { subjectName: true }, orderBy: { subjectName: "asc" } }),
    prisma.outreachSuppression.findMany({ select: { normalizedEmail: true, reason: true } }),
  ]);
  const blocked = new Map(suppressions.map((item) => [item.normalizedEmail, item.reason]));
  return NextResponse.json({ ok: true, items: items.map((item) => ({ ...item, suppressionReason: item.normalizedEmail ? blocked.get(item.normalizedEmail) || null : null })), count, totalCount, page, take, categories: categories.map((x) => x.category), leagues: leagues.map((x) => x.league).filter(Boolean), cities: cities.map((x) => x.city).filter(Boolean), teams: teams.map((x) => x.subjectName).filter(Boolean) });
}

export async function PATCH(req: Request) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => null); const id = String(body?.id || "");
  if (!id) return NextResponse.json({ ok: false, error: "Contact ID is required." }, { status: 400 });
  const data: any = {};
  if (body.consentBasis !== undefined) { const basis = String(body.consentBasis); if (!BASES.has(basis)) return NextResponse.json({ ok: false, error: "Invalid consent basis." }, { status: 400 }); data.consentBasis = basis; }
  if (body.consentEvidence !== undefined) data.consentEvidence = String(body.consentEvidence || "").trim() || null;
  if (body.consentExpiresAt !== undefined) data.consentExpiresAt = body.consentExpiresAt ? new Date(body.consentExpiresAt) : null;
  if (body.email !== undefined) { data.email = String(body.email || "").trim() || null; data.normalizedEmail = data.email ? normalizeEmail(data.email) : null; }
  const item = await prisma.outreachContact.update({ where: { id }, data });
  return NextResponse.json({ ok: true, item });
}
