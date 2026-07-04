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
  roundScore: string | null;
  mapName: string | null;
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
  leagueId: number | null;
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

export interface AccuracyItem {
  matchId: number;
  game: Game;
  createdAt: string;
  teams: string[];
  probs: [number, number];
  pickedName: string;
  pickedProb: number;
  statusAtPrediction: "upcoming" | "live";
  scoreAtPrediction: string | null;
  status: "pending" | "correct" | "wrong" | "canceled";
  finalScore: string | null;
  winnerName: string | null;
}

export interface AccuracyResponse {
  summary: { total: number; decided: number; correct: number; accuracy: number | null };
  items: AccuracyItem[];
}

export interface LiveDraft {
  gameTimeMin: number | null;
  kills: [number, number] | null;
  goldLead: number | null;
  delayMin: number | null;
  heroes: [string[], string[]];
  source: "steam" | "opendota";
}

export interface DraftResponse {
  draft: LiveDraft | null;
}
