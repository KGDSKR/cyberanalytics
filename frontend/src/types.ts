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
