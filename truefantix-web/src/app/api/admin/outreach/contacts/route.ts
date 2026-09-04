import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/outreach";

const BASES = new Set(["UNASSESSED", "EXPRESS_CONSENT", "EXISTING_BUSINESS_RELATIONSHIP", "CONSPICUOUSLY_PUBLISHED", "NOT_REQUIRED"]);
const STAGES = new Set(["NEW", "CONTACTED", "REPLIED", "INTERESTED", "FOLLOW_UP", "NOT_INTERESTED", "CLOSED"]);
const SPORT_CATEGORIES: Record<string, string[]> = {
  SPORTS_BASEBALL: ["MLB"],
  SPORTS_BASKETBALL: ["NBA", "NBA G League", "WNBA"],
  SPORTS_FOOTBALL: ["CFL", "NCAA Division I FBS", "NFL"],
  SPORTS_HOCKEY: ["AHL", "ECHL", "NHL", "OHL", "QMJHL"],
  SPORTS_SOCCER: ["MLS", "NWSL", "USL Championship"],
  SPORTS_COLLEGE_OTHER: ["U Sports"],
};
const NON_SPORT_CATEGORIES = new Set(["ARTIST", "TEST_CONTACT"]);
export async function GET(req: Request) {
  const gate = await requireAdmin(req); if (!gate.ok) return gate.res;
  const url = new URL(req.url); const q = (url.searchParams.get("q") || "").trim(); const category = url.searchParams.get("category") || "";
  const league = url.searchParams.get("league") || ""; const city = url.searchParams.get("city") || ""; const team = url.searchParams.get("team") || "";
  const email = url.searchParams.get("email") || ""; const researchStatus = url.searchParams.get("researchStatus") || "";
  const sendable = url.searchParams.get("sendable"); const page = Math.max(1, Number(url.searchParams.get("page")) || 1); const take = Math.min(100, Math.max(10, Number(url.searchParams.get("take")) || 50));
  const where: any = {};
  if (q) where.OR = ["organization", "subjectName", "contactName", "role", "email"].map((field) => ({ [field]: { contains: q, mode: "insensitive" } }));
  if (SPORT_CATEGORIES[category]) where.AND = [{ league: { in: SPORT_CATEGORIES[category] } }];
  else if (category === "SPORTS_OTHER") {
    where.AND = [
      { category: { startsWith: "SPORTS_" } },
      { OR: [{ league: null }, { league: { notIn: Object.values(SPORT_CATEGORIES).flat() } }] },
    ];
  } else if (category) where.category = category;
  if (league) where.AND = [...(where.AND || []), { league }];
  if (city) where.city = city;
  if (team) where.subjectName = team;
  if (researchStatus) where.researchStatus = researchStatus;
  if (sendable === "true") { where.email = { not: null }; where.normalizedEmail = { not: null }; where.unsubscribedAt = null; where.consentBasis = { not: "UNASSESSED" }; where.sourceUrl = { not: null }; }
  if (email === "yes") where.email = { not: null };
  if (email === "no") where.email = null;
  const [items, count, totalCount, categories, leagues, cities, teams, researchStatuses, suppressions] = await prisma.$transaction([
    prisma.outreachContact.findMany({ where, orderBy: [{ lastContactedAt: "asc" }, { organization: "asc" }], skip: (page - 1) * take, take }),
    prisma.outreachContact.count({ where }),
    prisma.outreachContact.count(),
    prisma.outreachContact.groupBy({ by: ["category"], _count: { _all: true }, orderBy: { category: "asc" } }),
    prisma.outreachContact.groupBy({ by: ["league"], where: { league: { not: null } }, _count: { _all: true }, orderBy: { league: "asc" } }),
    prisma.outreachContact.groupBy({ by: ["city"], where: { city: { not: null } }, _count: { _all: true }, orderBy: { city: "asc" } }),
    prisma.outreachContact.groupBy({ by: ["subjectName"], where: { subjectName: { not: null } }, _count: { _all: true }, orderBy: { subjectName: "asc" } }),
    prisma.outreachContact.groupBy({ by: ["researchStatus"], where: { researchStatus: { not: null } }, _count: { _all: true }, orderBy: { researchStatus: "asc" } }),
    prisma.outreachSuppression.findMany({ select: { normalizedEmail: true, reason: true } }),
  ]);
  const blocked = new Map(suppressions.map((item) => [item.normalizedEmail, item.reason]));
  const groupedCount = (item: { _count?: true | { _all?: number } }) =>
    typeof item._count === "object" ? item._count._all || 0 : 0;
  const rawCategoryCounts = Object.fromEntries(categories.map((x) => [x.category, groupedCount(x)]));
  const leagueCounts = Object.fromEntries(leagues.filter((x) => x.league).map((x) => [x.league!, groupedCount(x)]));
  const sportCategoryCounts = Object.fromEntries(
    Object.entries(SPORT_CATEGORIES).map(([sport, sportLeagues]) => [
      sport,
      sportLeagues.reduce((sum, sportLeague) => sum + (leagueCounts[sportLeague] || 0), 0),
    ]),
  );
  const knownSportCount = Object.values(sportCategoryCounts).reduce((sum, value) => sum + value, 0);
  const totalSportCount = categories
    .filter((x) => x.category.startsWith("SPORTS_"))
    .reduce((sum, x) => sum + groupedCount(x), 0);
  const categoryCounts = {
    ...Object.fromEntries([...NON_SPORT_CATEGORIES].filter((key) => rawCategoryCounts[key]).map((key) => [key, rawCategoryCounts[key]])),
    ...Object.fromEntries(Object.entries(sportCategoryCounts).filter(([, value]) => value > 0)),
    ...(totalSportCount > knownSportCount ? { SPORTS_OTHER: totalSportCount - knownSportCount } : {}),
  };
  return NextResponse.json({
    ok: true,
    items: items.map((item) => ({ ...item, suppressionReason: item.normalizedEmail ? blocked.get(item.normalizedEmail) || null : null })),
    count, totalCount, page, take,
    categories: Object.keys(categoryCounts),
    leagues: leagues.map((x) => x.league).filter(Boolean),
    cities: cities.map((x) => x.city).filter(Boolean),
    teams: teams.map((x) => x.subjectName).filter(Boolean),
    researchStatuses: researchStatuses.map((x) => x.researchStatus).filter(Boolean),
    filterCounts: {
      categories: categoryCounts,
      leagues: leagueCounts,
      cities: Object.fromEntries(cities.filter((x) => x.city).map((x) => [x.city!, groupedCount(x)])),
      teams: Object.fromEntries(teams.filter((x) => x.subjectName).map((x) => [x.subjectName!, groupedCount(x)])),
      researchStatuses: Object.fromEntries(researchStatuses.filter((x) => x.researchStatus).map((x) => [x.researchStatus!, groupedCount(x)])),
    },
  });
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
  if (body.engagementStage !== undefined) { const stage = String(body.engagementStage); if (!STAGES.has(stage)) return NextResponse.json({ ok: false, error: "Invalid contact stage." }, { status: 400 }); data.engagementStage = stage; }
  if (body.followUpAt !== undefined) data.followUpAt = body.followUpAt ? new Date(body.followUpAt) : null;
  if (body.adminNotes !== undefined) data.adminNotes = String(body.adminNotes || "").trim().slice(0, 10000) || null;
  const item = await prisma.outreachContact.update({ where: { id }, data });
  return NextResponse.json({ ok: true, item });
}
