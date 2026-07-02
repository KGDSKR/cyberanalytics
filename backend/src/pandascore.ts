import { config } from "./config.js";
import type { Game, Match, PastMatchSummary, Team } from "./types.js";

const BASE = "https://api.pandascore.co";

/** Слаги игр в API PandaScore (CS2 у них до сих пор живёт под csgo). */
const GAME_SLUG: Record<Game, string> = { cs2: "csgo", dota2: "dota2" };

const VIDEOGAME_TO_GAME: Record<string, Game> = { "cs-go": "cs2", "dota-2": "dota2" };

async function psGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

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
}

// --- Сырые типы PandaScore (только используемые поля) ---
interface RawOpponent {
  opponent: { id: number; name: string; acronym: string | null; image_url: string | null } | null;
}
interface RawMatch {
  id: number;
  name: string;
  status: "not_started" | "running" | "finished" | "canceled" | "postponed";
  begin_at: string | null;
  number_of_games: number | null;
  league: { name: string } | null;
  serie: { full_name: string | null } | null;
  tournament: { name: string } | null;
  videogame: { slug: string } | null;
  opponents: RawOpponent[];
  results: { team_id: number; score: number }[];
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
    league: raw.league?.name ?? "",
    serie: raw.serie?.full_name ?? "",
    tournament: raw.tournament?.name ?? "",
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
    const score = m.results.map((r) => r.score).join(":");
    return {
      opponentName: opponent?.name ?? "unknown",
      won: m.winner_id === teamId,
      score,
      beginAt: m.begin_at ?? "",
    };
  });
}
