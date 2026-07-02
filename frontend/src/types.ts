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
