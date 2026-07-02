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
  score: string | null; // текущий счёт для live, например "1:0"
  league: string;
  serie: string;
  tournament: string;
  bestOf: number | null;
  teams: Team[];
}

export interface PastMatchSummary {
  opponentName: string;
  won: boolean;
  score: string; // по картам, с точки зрения команды: "2:1"
  beginAt: string;
  gameDurationsMin: number[]; // длительности сыгранных карт в минутах
}
