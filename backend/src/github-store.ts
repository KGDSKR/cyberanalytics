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

/**
 * Сетевые сбои к GitHub бывают (например, разовый ConnectTimeout) — раньше
 * такие файлы прогнозов тихо пропускались и процент точности занижался
 * без единого следа в логах. Теперь: 3 попытки с паузой + громкий console.error,
 * если файл так и не прочитался.
 */
async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, { headers: ghHeaders() });
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastErr;
}

/** Параллельно, но с ограничением — не бьём GitHub сотнями одновременных запросов. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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

  const dir = await fetchWithRetry(`${GH}/repos/${repo()}/contents/predictions?ref=${BRANCH}`);
  if (dir.status === 404) return [];
  if (!dir.ok) throw new Error(`GitHub list predictions ${dir.status}`);
  const files = (await dir.json()) as { download_url: string; name: string }[];
  const jsonFiles = files.filter((f) => f.name.endsWith(".json"));

  let failed = 0;
  const fetched = await mapWithConcurrency(jsonFiles, 15, async (f) => {
    try {
      const res = await fetchWithRetry(f.download_url);
      if (res.ok) return (await res.json()) as PredictionRecord;
      failed++;
      console.error(`predictions: ${f.name} — HTTP ${res.status}`);
    } catch (e) {
      failed++;
      console.error(`predictions: ${f.name} — ${(e as Error).message}`);
    }
    return null;
  });
  const records = fetched.filter((r): r is PredictionRecord => r !== null);

  if (failed > 0) {
    console.error(
      `predictions: ${failed}/${jsonFiles.length} файлов не прочитались — процент точности может быть занижен`
    );
  } else {
    // Кэшируем только полный, без потерь список — если что-то не прочиталось,
    // следующий запрос честно попробует заново, а не залипнет на неполных данных.
    cacheSet("predictions-list", records, 5 * 60_000);
  }
  return records;
}
