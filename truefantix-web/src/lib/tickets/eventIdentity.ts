import { LIVE_EVENT_CATALOG } from "@/lib/catalog/live-event-catalog";

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const TEAM_MATCHES = LIVE_EVENT_CATALOG
  .filter((item) => item.type === "TEAM")
  .map((item) => ({
    name: item.label,
    league: String(item.subtitle ?? "").split("·")[0].trim(),
    terms: Array.from(new Set([
      item.label,
      item.value,
      item.city,
      ...(item.aliases ?? []),
      item.label.split(" ").at(-1),
      item.label.split(" ").slice(0, -1).join(" "),
    ].map(normalize).filter(Boolean))),
  }));

function teamCandidates(value: string) {
  const key = normalize(value);
  return TEAM_MATCHES.filter((team) => team.terms.includes(key));
}

/** Converts a recognizable two-team matchup to canonical full team names. */
export function canonicalizeEventTitle(title: string) {
  const parts = title.trim().split(/\s+(?:vs\.?|versus|v\.?|@|at)\s+/i);
  if (parts.length !== 2) return title.trim();

  const compatible = teamCandidates(parts[0]).flatMap((home) =>
    teamCandidates(parts[1])
      .filter((away) => home.name !== away.name && home.league && home.league === away.league)
      .map((away) => ({ home, away }))
  );

  const leaguePriority = ["NFL", "CFL", "NHL", "NBA", "MLB", "MLS", "WNBA", "PWHL", "NLL", "AHL", "OHL", "QMJHL", "WHL", "NCAA"];
  const priority = (league: string) => {
    const index = leaguePriority.findIndex((name) => league === name || league.startsWith(`${name} `));
    return index < 0 ? leaguePriority.length : index;
  };
  compatible.sort((a, b) => priority(a.home.league) - priority(b.home.league));
  const bestPriority = compatible.length ? priority(compatible[0].home.league) : -1;
  const best = compatible.filter((pair) => priority(pair.home.league) === bestPriority);

  if (best.length !== 1) return title.trim();
  return `${best[0].home.name} vs. ${best[0].away.name}`;
}

export function eventIdentityKey(title: string, date: string, venue: string) {
  return [canonicalizeEventTitle(title), date, venue].map(normalize).join("|");
}

export function duplicateSeatBlocksSeller(
  existingStatus: string,
  existingSellerId: string,
  listingSellerId: string
) {
  return existingStatus !== "SOLD" || existingSellerId === listingSellerId;
}
