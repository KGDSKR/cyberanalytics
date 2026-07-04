import type { FastifyBaseLogger } from "fastify";
import { produceAnalysis } from "./analysis-service.js";
import { activeAiProvider, hasPandascore } from "./config.js";
import { hasGithubStore, listPredictions } from "./github-store.js";
import { fetchMatches } from "./pandascore.js";
import type { Game, Match } from "./types.js";

/**
 * Автопрогнозы: сервер сам генерирует анализ (и фиксирует прогноз) для всех
 * матчей, стартующих в ближайший час, и для live-матчей без прогноза —
 * вкладка «Точность» покрывает все матчи, а не только открытые пользователем.
 * Бонус: пользователь открывает такой матч — анализ уже готов.
 */
const CYCLE_MS = 10 * 60_000; // период обхода
const HORIZON_MS = 60 * 60_000; // прогнозируем матчи, стартующие в ближайший час
const MAX_PER_CYCLE = 6; // бережём дневные лимиты бесплатного Gemini
const PAUSE_BETWEEN_MS = 20_000; // и минутные тоже

const GAMES: Game[] = ["cs2", "dota2"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tick(log: FastifyBaseLogger): Promise<void> {
  if (!hasPandascore() || activeAiProvider() === "none" || !hasGithubStore()) return;

  const predicted = new Set((await listPredictions()).map((p) => p.matchId));

  const lists = await Promise.allSettled(
    GAMES.flatMap((g) => [fetchMatches(g, "running"), fetchMatches(g, "upcoming")])
  );
  const matches = lists
    .filter((r): r is PromiseFulfilledResult<Match[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);

  const now = Date.now();
  const targets = matches
    .filter(
      (m) =>
        m.teams.length === 2 &&
        !predicted.has(m.id) &&
        (m.status === "live" || Date.parse(m.beginAt) - now < HORIZON_MS)
    )
    // сначала те, что стартуют раньше — им прогноз нужнее
    .sort((a, b) => a.beginAt.localeCompare(b.beginAt))
    .slice(0, MAX_PER_CYCLE);

  for (const m of targets) {
    try {
      await produceAnalysis(m, log);
      log.info(`auto-predict: ${m.name} (${m.game}, ${m.status})`);
    } catch (err) {
      log.error(err, `auto-predict failed: ${m.name}`);
    }
    await sleep(PAUSE_BETWEEN_MS);
  }
}

export function startAutoPredict(log: FastifyBaseLogger): void {
  // первый обход — через 2 минуты после старта, чтобы не мешать холодному запуску
  setTimeout(() => void tick(log).catch((err) => log.error(err, "auto-predict tick")), 2 * 60_000);
  setInterval(() => void tick(log).catch((err) => log.error(err, "auto-predict tick")), CYCLE_MS);
  log.info("auto-predict: enabled (every 10 min, horizon 1h)");
}
