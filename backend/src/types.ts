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
  league: string;
  serie: string;
  tournament: string;
  bestOf: number | null;
  teams: Team[];
}

export interface PastMatchSummary {
  opponentName: string;
  won: boolean;
  score: string;
  beginAt: string;
}
