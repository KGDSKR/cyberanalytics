import { cacheGet, cacheSet } from "./cache.js";
import { sameTeam } from "./dota-live.js";

/**
 * Live-счёт по раундам для CS2 — неофициальный публичный API bo3.gg.
 * PandaScore на бесплатном тарифе пораундовый счёт не отдаёт (платный live-пакет).
 * Источник может поменять формат — весь модуль обёрнут в try/catch на вызывающей стороне.
 */
export interface CsLive {
  rounds: [number, number]; // раунды текущей карты в порядке [teamA, teamB]
  mapName: string | null; // например "Ancient"
}

interface Bo3Side {
  game_score?: number;
}
interface Bo3Match {
  team1?: { name?: string };
  team2?: { name?: string };
  live_updates?: {
    team_1?: Bo3Side;
    team_2?: Bo3Side;
    map_name?: string;
  } | null;
}

async function bo3CurrentMatches(): Promise<Bo3Match[]> {
  const cached = cacheGet<Bo3Match[]>("bo3-current");
  if (cached) return cached;

  const url =
    "https://api.bo3.gg/api/v1/matches?page%5Boffset%5D=0&page%5Blimit%5D=50" +
    "&sort=start_date&filter%5Bmatches.status%5D%5Bin%5D=current&with=teams";
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`bo3.gg ${res.status}`);
  const data = (await res.json()) as { results?: Bo3Match[] };
  const matches = data.results ?? [];
  cacheSet("bo3-current", matches, 20_000);
  return matches;
}

function prettyMap(raw?: string): string | null {
  if (!raw) return null;
  const name = raw.replace(/^de_/, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Раунды текущей карты для пары команд; null — матч не найден у bo3.gg. */
export async function fetchCsRounds(teamA: string, teamB: string): Promise<CsLive | null> {
  const games = await bo3CurrentMatches();
  const g = games.find((x) => {
    const n1 = x.team1?.name ?? "";
    const n2 = x.team2?.name ?? "";
    return (
      (sameTeam(n1, teamA) && sameTeam(n2, teamB)) ||
      (sameTeam(n1, teamB) && sameTeam(n2, teamA))
    );
  });
  if (!g?.live_updates) return null;

  const lu = g.live_updates;
  const r1 = lu.team_1?.game_score ?? 0;
  const r2 = lu.team_2?.game_score ?? 0;
  const aIsTeam1 = sameTeam(g.team1?.name ?? "", teamA);
  return {
    rounds: aIsTeam1 ? [r1, r2] : [r2, r1],
    mapName: prettyMap(lu.map_name),
  };
}
