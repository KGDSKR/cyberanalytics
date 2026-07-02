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
  beginAt: string;
  game: Game;
  status: "upcoming" | "live";
  score: string | null;
  league: string;
  serie: string;
  tournament: string;
  bestOf: number | null;
  teams: Team[];
}

export interface MatchesResponse {
  matches: Match[];
  demo: boolean;
}

export interface AnalyzeResponse {
  analysis: string;
  cached: boolean;
  demo: boolean;
}

export interface PastMatch {
  id: number;
  game: Game;
  name: string;
  beginAt: string;
  league: string;
  serie: string;
  tournament: string;
  teams: Team[];
  winnerId: number | null;
  score: string;
  mapDurationsMin: number[];
  totalDurationMin: number;
}

export interface PastMapDraft {
  map: number;
  durationMin: number;
  winnerTeamIndex: 0 | 1 | null;
  heroes: [string[], string[]];
}

export interface PastResponse {
  matches: PastMatch[];
  demo: boolean;
}

export interface PastDraftResponse {
  drafts: PastMapDraft[] | null;
}

export interface LiveDraft {
  gameTimeMin: number;
  kills: [number, number];
  goldLead: number | null;
  heroes: [string[], string[]];
  source: "steam" | "opendota";
}

export interface DraftResponse {
  draft: LiveDraft | null;
}
