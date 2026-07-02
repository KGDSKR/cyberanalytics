import { config } from "./config.js";
import type { Match, PastMatchSummary, Team } from "./types.js";

const BASE = "https://api.pandascore.co";

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
  begin_at: string | null;
  number_of_games: number | null;
  league: { name: string } | null;
  serie: { full_name: string | null } | null;
  tournament: { name: string } | null;
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

function mapMatch(raw: RawMatch): Match {
  return {
    id: raw.id,
    name: raw.name,
    beginAt: raw.begin_at ?? new Date().toISOString(),
    league: raw.league?.name ?? "",
    serie: raw.serie?.full_name ?? "",
    tournament: raw.tournament?.name ?? "",
    bestOf: raw.number_of_games,
    teams: mapTeams(raw),
  };
}

/** Ближайшие матчи CS2 (в PandaScore игра до сих пор ходит под слагом csgo). */
export async function fetchUpcomingMatches(): Promise<Match[]> {
  const raw = await psGet<RawMatch[]>("/csgo/matches/upcoming", {
    sort: "begin_at",
    "page[size]": "20",
  });
  // Показываем только матчи, где известны обе команды
  return raw.map(mapMatch).filter((m) => m.teams.length === 2);
}

export async function fetchMatchById(id: number): Promise<Match> {
  const raw = await psGet<RawMatch>(`/matches/${id}`);
  return mapMatch(raw);
}

/** Последние сыгранные матчи команды — сырьё для ИИ-анализа формы. */
export async function fetchTeamRecentMatches(teamId: number, limit = 10): Promise<PastMatchSummary[]> {
  const raw = await psGet<RawMatch[]>("/csgo/matches/past", {
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
