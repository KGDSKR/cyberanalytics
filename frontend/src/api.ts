import type {
  AnalyzeResponse,
  DraftResponse,
  Game,
  MatchesResponse,
  PastDraftResponse,
  PastMatch,
  PastResponse,
} from "./types";

function tgHeaders(): Record<string, string> {
  const initData = window.Telegram?.WebApp?.initData;
  return initData ? { "x-telegram-init-data": initData } : {};
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Ошибка ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function getMatches(): Promise<MatchesResponse> {
  const res = await fetch("/api/matches", { headers: tgHeaders() });
  return handle<MatchesResponse>(res);
}

export async function getPastMatches(game: Game, page: number, q: string): Promise<PastResponse> {
  const params = new URLSearchParams({ game, page: String(page) });
  if (q) params.set("q", q);
  const res = await fetch(`/api/past?${params}`, { headers: tgHeaders() });
  return handle<PastResponse>(res);
}

export async function getPastDrafts(match: PastMatch): Promise<PastDraftResponse> {
  const res = await fetch("/api/past-draft", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...tgHeaders() },
    body: JSON.stringify({ match }),
  });
  return handle<PastDraftResponse>(res);
}

export async function getDraft(matchId: number): Promise<DraftResponse> {
  const res = await fetch(`/api/draft?matchId=${matchId}`, { headers: tgHeaders() });
  return handle<DraftResponse>(res);
}

export async function analyzeMatch(matchId: number): Promise<AnalyzeResponse> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...tgHeaders() },
    body: JSON.stringify({ matchId }),
  });
  return handle<AnalyzeResponse>(res);
}

// Типизация Telegram WebApp (минимально необходимая)
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready: () => void;
        expand: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        BackButton?: {
          show: () => void;
          hide: () => void;
          onClick: (cb: () => void) => void;
          offClick: (cb: () => void) => void;
        };
      };
    };
  }
}
