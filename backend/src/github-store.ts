import { cacheGet, cacheSet } from "./cache.js";
import type { Game } from "./types.js";

/**
 * Постоянное хранилище прогнозов — ветка `data` GitHub-репозитория.
 * Диск на бесплатном Render эфемерный (стирается при деплое), а GitHub вечен.
 */
const GH = "https://api.github.com";
const BRANCH = "data";

const repo = () => process.env.GITHUB_REPO ?? "KGDSKR/cyberanalytics";
const token = () => process.env.GITHUB_TOKEN ?? "";
export const hasGithubStore = () => token().length > 0;

function ghHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "cyberanalytics",
  };
}

/** Запись прогноза — фиксируется один раз при первой генерации анализа. */
export interface PredictionRecord {
  matchId: number;
  game: Game;
  createdAt: string;
  statusAtPrediction: "upcoming" | "live";
  scoreAtPrediction: string | null;
  teams: { id: number; name: string }[];
  probs: [number, number]; // вероятности победы в порядке teams
}

async function ensureBranch(): Promise<void> {
  if (cacheGet("gh-branch-ok")) return;
  const ref = await fetch(`${GH}/repos/${repo()}/git/ref/heads/${BRANCH}`, { headers: ghHeaders() });
  if (ref.status === 404) {
    const main = await fetch(`${GH}/repos/${repo()}/git/ref/heads/main`, { headers: ghHeaders() });
    if (!main.ok) throw new Error(`GitHub main ref ${main.status}`);
    const sha = ((await main.json()) as { object: { sha: string } }).object.sha;
    const created = await fetch(`${GH}/repos/${repo()}/git/refs`, {
      method: "POST",
      headers: ghHeaders(),
      body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha }),
    });
    if (!created.ok) throw new Error(`GitHub create branch ${created.status}`);
  } else if (!ref.ok) {
    throw new Error(`GitHub ref ${ref.status}`);
  }
  cacheSet("gh-branch-ok", true, 24 * 3_600_000);
}

/** Сохранить прогноз, если его ещё нет (первый прогноз — окончательный). */
export async function savePredictionOnce(rec: PredictionRecord): Promise<void> {
  if (!hasGithubStore()) return;
  await ensureBranch();
  const path = `predictions/${rec.matchId}.json`;
  const existing = await fetch(`${GH}/repos/${repo()}/contents/${path}?ref=${BRANCH}`, {
    headers: ghHeaders(),
  });
  if (existing.ok) return; // уже есть — не перезаписываем

  const res = await fetch(`${GH}/repos/${repo()}/contents/${path}`, {
    method: "PUT",
    headers: ghHeaders(),
    body: JSON.stringify({
      message: `prediction: match ${rec.matchId}`,
      branch: BRANCH,
      content: Buffer.from(JSON.stringify(rec, null, 2)).toString("base64"),
    }),
  });
  if (!res.ok) throw new Error(`GitHub save prediction ${res.status}`);
  cacheSet("predictions-list", undefined as unknown, 1); // сбросить кэш списка
}

/** Все сохранённые прогнозы. */
export async function listPredictions(): Promise<PredictionRecord[]> {
  if (!hasGithubStore()) return [];
  const cached = cacheGet<PredictionRecord[]>("predictions-list");
  if (cached) return cached;

  const dir = await fetch(`${GH}/repos/${repo()}/contents/predictions?ref=${BRANCH}`, {
    headers: ghHeaders(),
  });
  if (dir.status === 404) return [];
  if (!dir.ok) throw new Error(`GitHub list predictions ${dir.status}`);
  const files = (await dir.json()) as { download_url: string; name: string }[];

  const records: PredictionRecord[] = [];
  await Promise.all(
    files
      .filter((f) => f.name.endsWith(".json"))
      .map(async (f) => {
        try {
          const res = await fetch(f.download_url, { headers: ghHeaders() });
          if (res.ok) records.push((await res.json()) as PredictionRecord);
        } catch {
          /* пропускаем битый файл */
        }
      })
  );
  cacheSet("predictions-list", records, 5 * 60_000);
  return records;
}
