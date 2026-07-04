export type Game = "cs2" | "dota2";

export interface Team {
  id: number;
  name: string;
  acronym: string | null;
  imageUrl: string | null;
}

export interface Match {
  id: number;
  name: string;
  beginAt: string; // ISO 8601
  game: Game;
  status: "upcoming" | "live";
  score: string | null; // текущий счёт по картам для live, например "1:0"
  roundScore: string | null; // CS2 live: раунды текущей карты, например "7:11"
  mapName: string | null; // CS2 live: текущая карта, например "Ancient"
  league: string;
  serie: string;
  tournament: string;
  bestOf: number | null;
  teams: Team[];
}

/** Завершённый матч для вкладки «Прошедшие». */
export interface PastMatch {
  id: number;
  game: Game;
  name: string;
  beginAt: string;
  league: string;
  leagueId: number | null;
  serie: string;
  tournament: string;
  teams: Team[];
  winnerId: number | null;
  score: string; // по картам в порядке teams: "2:1"
  mapDurationsMin: number[];
  totalDurationMin: number;
}

/** Драфт одной карты завершённого матча Dota 2. */
export interface PastMapDraft {
  map: number;
  durationMin: number;
  winnerTeamIndex: 0 | 1 | null; // индекс в match.teams
  heroes: [string[], string[]]; // в порядке match.teams
}

export interface PastMatchSummary {
  opponentName: string;
  won: boolean;
  score: string; // по картам, с точки зрения команды: "2:1"
  beginAt: string;
  gameDurationsMin: number[]; // длительности сыгранных карт в минутах
}
