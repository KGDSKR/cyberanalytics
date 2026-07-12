import { config } from "./config.js";
import type { Game, Match, PastMatch, PastMatchSummary, Team } from "./types.js";

const BASE = "https://api.pandascore.co";

/** Слаги игр в API PandaScore (CS2 у них до сих пор живёт под csgo). */
const GAME_SLUG: Record<Game, string> = { cs2: "csgo", dota2: "dota2" };

const VIDEOGAME_TO_GAME: Record<string, Game> = { "cs-go": "cs2", "dota-2": "dota2" };

async function psGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  // Разовые сетевые сбои (ConnectTimeout и т.п.) бывают — раньше вызывающий код
  // ловил исключение через .catch(() => null) и молча терял данные (например,
  // результат матча для расчёта точности). 3 попытки с паузой заметно снижают
  // шанс, что случайный сбой сети превратится в неверную статистику.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${config.pandascoreToken}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`PandaScore ${res.status} on ${path}: ${body.slice(0, 300)}`);
      }
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr;
}

// --- Сырые типы PandaScore (только используемые поля) ---
interface RawOpponent {
  opponent: { id: number; name: string; acronym: string | null; image_url: string | null } | null;
}
interface RawGame {
  length: number | null; // секунды
  finished: boolean;
}
interface RawMatch {
  id: number;
  name: string;
  status: "not_started" | "running" | "finished" | "canceled" | "postponed";
  begin_at: string | null;
  number_of_games: number | null;
  league: { id: number; name: string } | null;
  serie: { full_name: string | null } | null;
  tournament: { name: string; tier: string | null; prizepool: string | null } | null;
  videogame: { slug: string } | null;
  opponents: RawOpponent[];
  results: { team_id: number; score: number }[];
  games?: RawGame[];
  winner_id: number | null;
}

function mapTeams(raw: RawMatch): Team[] {
  return raw.opponents
    .map((o) => o.opponent)
    .filter((t): t is NonNullable<RawOpponent["opponent"]> => t !== null)
    .map((t) => ({ id: t.id, name: t.name, acronym: t.acronym, imageUrl: t.image_url }));
}

function mapMatch(raw: RawMatch, fallbackGame: Game): Match {
  const live = raw.status === "running";
  const teams = mapTeams(raw);
  // Счёт в порядке команд, а не в порядке results
  const score = live
    ? teams
        .map((t) => raw.results.find((r) => r.team_id === t.id)?.score ?? 0)
        .join(":")
    : null;
  return {
    id: raw.id,
    name: raw.name,
    beginAt: raw.begin_at ?? new Date().toISOString(),
    game: VIDEOGAME_TO_GAME[raw.videogame?.slug ?? ""] ?? fallbackGame,
    status: live ? "live" : "upcoming",
    score,
    roundScore: null, // заполняется из bo3.gg в routes для live CS2
    mapName: null,
    league: raw.league?.name ?? "",
    serie: raw.serie?.full_name ?? "",
    tournament: raw.tournament?.name ?? "",
    tier: raw.tournament?.tier ?? null,
    prizepool: raw.tournament?.prizepool ?? null,
    bestOf: raw.number_of_games,
    teams,
  };
}

/** Матчи одной игры: идущие сейчас или предстоящие. */
export async function fetchMatches(game: Game, kind: "running" | "upcoming"): Promise<Match[]> {
  const raw = await psGet<RawMatch[]>(`/${GAME_SLUG[game]}/matches/${kind}`, {
    sort: "begin_at",
    "page[size]": "50",
  });
  // Показываем только матчи, где известны обе команды
  return raw.map((m) => mapMatch(m, game)).filter((m) => m.teams.length === 2);
}

export async function fetchMatchById(id: number): Promise<Match> {
  const raw = await psGet<RawMatch>(`/matches/${id}`);
  return mapMatch(raw, "cs2");
}

/** Итог матча для проверки точности прогноза. */
export interface MatchResult {
  status: string; // finished | running | not_started | canceled | ...
  winnerId: number | null;
  scores: { teamId: number; score: number }[];
}

export async function fetchMatchResult(id: number): Promise<MatchResult> {
  const raw = await psGet<RawMatch>(`/matches/${id}`);
  return {
    status: raw.status,
    winnerId: raw.winner_id,
    scores: raw.results.map((r) => ({ teamId: r.team_id, score: r.score })),
  };
}

/** Прошедшие матчи для вкладки «Прошедшие»: постранично, с поиском и фильтром по лиге. */
export async function fetchPastMatches(
  game: Game,
  page = 1,
  search = "",
  leagueId?: number
): Promise<PastMatch[]> {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 19) + "Z";
  const params: Record<string, string> = {
    sort: "-end_at",
    "page[size]": "50",
    "page[number]": String(Math.max(1, page)),
    "filter[status]": "finished", // отменённые матчи с пустым счётом не показываем
    // матчи без end_at при desc-сортировке всплывают наверх — отсекаем диапазоном
    "range[end_at]": `2015-01-01T00:00:00Z,${tomorrow}`,
  };
  if (search) params["search[name]"] = search;
  if (leagueId) params["filter[league_id]"] = String(leagueId);
  const raw = await psGet<RawMatch[]>(`/${GAME_SLUG[game]}/matches/past`, params);
  return raw
    .map((m) => {
      const teams = mapTeams(m);
      const score = teams
        .map((t) => m.results.find((r) => r.team_id === t.id)?.score ?? 0)
        .join(":");
      const mapDurationsMin = (m.games ?? [])
        .filter((g) => g.finished && typeof g.length === "number" && g.length > 0)
        .map((g) => Math.round((g.length as number) / 60));
      return {
        id: m.id,
        game: VIDEOGAME_TO_GAME[m.videogame?.slug ?? ""] ?? game,
        name: m.name,
        beginAt: m.begin_at ?? "",
        league: m.league?.name ?? "",
        leagueId: m.league?.id ?? null,
        serie: m.serie?.full_name ?? "",
        tournament: m.tournament?.name ?? "",
        teams,
        winnerId: m.winner_id,
        score,
        mapDurationsMin,
        totalDurationMin: mapDurationsMin.reduce((s, x) => s + x, 0),
      };
    })
    .filter((m) => m.teams.length === 2);
}

/** Последние сыгранные матчи команды — сырьё для ИИ-анализа формы. */
export async function fetchTeamRecentMatches(
  game: Game,
  teamId: number,
  limit = 10
): Promise<PastMatchSummary[]> {
  const raw = await psGet<RawMatch[]>(`/${GAME_SLUG[game]}/matches/past`, {
    "filter[opponent_id]": String(teamId),
    sort: "-begin_at",
    "page[size]": String(limit),
  });
  return raw.map((m) => {
    const teams = mapTeams(m);
    const opponent = teams.find((t) => t.id !== teamId);
    const own = m.results.find((r) => r.team_id === teamId)?.score ?? 0;
    const opp = m.results.find((r) => r.team_id !== teamId)?.score ?? 0;
    const gameDurationsMin = (m.games ?? [])
      .filter((g) => g.finished && typeof g.length === "number" && g.length > 0)
      .map((g) => Math.round((g.length as number) / 60));
    return {
      opponentName: opponent?.name ?? "unknown",
      won: m.winner_id === teamId,
      score: `${own}:${opp}`,
      beginAt: m.begin_at ?? "",
      gameDurationsMin,
      tier: m.tournament?.tier ?? null,
    };
  });
}
