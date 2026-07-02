import { cacheGet, cacheSet } from "./cache.js";
import { config } from "./config.js";

/**
 * Live-данные текущей карты Dota 2: драфт, киллы, золото.
 * Источники: Steam Web API (официальный, полное покрытие лиг, нужен ключ)
 * и OpenDota (без ключа, но видит только топовые игры).
 */
export interface LiveDraft {
  gameTimeMin: number;
  kills: [number, number]; // [команда A, команда B] в порядке команд матча
  goldLead: number | null; // >0 — преимущество команды A
  heroes: [string[], string[]];
  source: "steam" | "opendota";
}

// --- Справочник героев (id -> имя), OpenDota, кэш сутки ---
async function heroNames(): Promise<Record<number, string>> {
  const cached = cacheGet<Record<number, string>>("heroes");
  if (cached) return cached;
  const res = await fetch("https://api.opendota.com/api/constants/heroes");
  if (!res.ok) throw new Error(`OpenDota heroes ${res.status}`);
  const data = (await res.json()) as Record<string, { id: number; localized_name: string }>;
  const map: Record<number, string> = {};
  for (const h of Object.values(data)) map[h.id] = h.localized_name;
  cacheSet("heroes", map, 24 * 3_600_000);
  return map;
}

// --- Сопоставление названий команд PandaScore <-> Steam/OpenDota ---
function norm(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bteam\b|\besports?\b|\bgaming\b/g, "")
    .replace(/[^a-z0-9а-яё]/g, "");
}

function sameTeam(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

interface FoundGame {
  radiantName: string;
  direName: string;
  gameTimeSec: number;
  radiantKills: number;
  direKills: number;
  radiantGoldLead: number | null;
  radiantHeroIds: number[];
  direHeroIds: number[];
  source: "steam" | "opendota";
}

// --- Steam: GetLiveLeagueGames (все лиговые игры) ---
interface SteamPlayer {
  hero_id: number;
  team: number; // 0 radiant, 1 dire, 2+ наблюдатели
}
interface SteamGame {
  radiant_team?: { team_name: string };
  dire_team?: { team_name: string };
  players?: SteamPlayer[];
  scoreboard?: {
    duration: number;
    radiant?: { score: number; players?: { net_worth?: number }[] };
    dire?: { score: number; players?: { net_worth?: number }[] };
  };
}

async function steamLiveGames(): Promise<FoundGame[]> {
  if (!config.steamApiKey) return [];
  const url = `https://api.steampowered.com/IDOTA2Match_570/GetLiveLeagueGames/v1/?key=${config.steamApiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Steam API ${res.status}`);
  const data = (await res.json()) as { result?: { games?: SteamGame[] } };
  return (data.result?.games ?? [])
    .filter((g) => g.radiant_team?.team_name || g.dire_team?.team_name)
    .map((g) => {
      const sumNw = (players?: { net_worth?: number }[]) =>
        players?.reduce((s, p) => s + (p.net_worth ?? 0), 0) ?? 0;
      const radNw = sumNw(g.scoreboard?.radiant?.players);
      const dirNw = sumNw(g.scoreboard?.dire?.players);
      return {
        radiantName: g.radiant_team?.team_name ?? "",
        direName: g.dire_team?.team_name ?? "",
        gameTimeSec: g.scoreboard?.duration ?? 0,
        radiantKills: g.scoreboard?.radiant?.score ?? 0,
        direKills: g.scoreboard?.dire?.score ?? 0,
        radiantGoldLead: radNw + dirNw > 0 ? radNw - dirNw : null,
        radiantHeroIds: (g.players ?? []).filter((p) => p.team === 0 && p.hero_id > 0).map((p) => p.hero_id),
        direHeroIds: (g.players ?? []).filter((p) => p.team === 1 && p.hero_id > 0).map((p) => p.hero_id),
        source: "steam" as const,
      };
    });
}

// --- OpenDota: /live (без ключа, только топовые игры) ---
interface OpenDotaGame {
  league_id: number;
  team_name_radiant?: string;
  team_name_dire?: string;
  game_time?: number;
  radiant_score?: number;
  dire_score?: number;
  radiant_lead?: number;
  players?: { hero_id: number; team: number }[];
}

async function opendotaLiveGames(): Promise<FoundGame[]> {
  const res = await fetch("https://api.opendota.com/api/live");
  if (!res.ok) throw new Error(`OpenDota live ${res.status}`);
  const data = (await res.json()) as OpenDotaGame[];
  return data
    .filter((g) => g.league_id > 0 && (g.team_name_radiant || g.team_name_dire))
    .map((g) => ({
      radiantName: g.team_name_radiant ?? "",
      direName: g.team_name_dire ?? "",
      gameTimeSec: g.game_time ?? 0,
      radiantKills: g.radiant_score ?? 0,
      direKills: g.dire_score ?? 0,
      radiantGoldLead: g.radiant_lead ?? null,
      radiantHeroIds: (g.players ?? []).filter((p) => p.team === 0 && p.hero_id > 0).map((p) => p.hero_id),
      direHeroIds: (g.players ?? []).filter((p) => p.team === 1 && p.hero_id > 0).map((p) => p.hero_id),
      source: "opendota" as const,
    }));
}

/** Найти live-игру по названиям команд и вернуть драфт в порядке [teamA, teamB]. */
export async function fetchLiveDraft(teamA: string, teamB: string): Promise<LiveDraft | null> {
  const cacheKey = `draft:${norm(teamA)}:${norm(teamB)}`;
  const cached = cacheGet<LiveDraft | "miss">(cacheKey);
  if (cached) return cached === "miss" ? null : cached;

  const sources = [steamLiveGames, opendotaLiveGames];
  let games: FoundGame[] = [];
  for (const src of sources) {
    try {
      games = games.concat(await src());
    } catch {
      /* источник недоступен — пробуем следующий */
    }
  }

  const found = games.find(
    (g) =>
      (sameTeam(g.radiantName, teamA) && sameTeam(g.direName, teamB)) ||
      (sameTeam(g.radiantName, teamB) && sameTeam(g.direName, teamA))
  );
  if (!found) {
    cacheSet(cacheKey, "miss", 45_000);
    return null;
  }

  const heroes = await heroNames();
  const nameOf = (ids: number[]) => ids.map((id) => heroes[id] ?? `hero#${id}`);
  const aIsRadiant = sameTeam(found.radiantName, teamA);

  const draft: LiveDraft = {
    gameTimeMin: Math.round(found.gameTimeSec / 60),
    kills: aIsRadiant
      ? [found.radiantKills, found.direKills]
      : [found.direKills, found.radiantKills],
    goldLead:
      found.radiantGoldLead === null
        ? null
        : aIsRadiant
          ? found.radiantGoldLead
          : -found.radiantGoldLead,
    heroes: aIsRadiant
      ? [nameOf(found.radiantHeroIds), nameOf(found.direHeroIds)]
      : [nameOf(found.direHeroIds), nameOf(found.radiantHeroIds)],
    source: found.source,
  };
  cacheSet(cacheKey, draft, 45_000);
  return draft;
}
