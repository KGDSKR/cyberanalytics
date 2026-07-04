import type { FastifyBaseLogger } from "fastify";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractPrediction, generateAnalysis, type AnalysisContext } from "./ai.js";
import { activeAiProvider, config, hasPandascore } from "./config.js";
import { fetchLiveDraft } from "./dota-live.js";
import { savePredictionOnce, type PredictionRecord } from "./github-store.js";
import { fetchTeamRecentMatches } from "./pandascore.js";
import type { Match, PastMatchSummary } from "./types.js";

/** Собирает контекст матча (форма, h2h, live-драфт) для промпта ИИ. */
export async function buildContext(match: Match): Promise<AnalysisContext> {
  if (!hasPandascore()) {
    return { match, recentByTeam: {}, headToHead: [], dataSource: "none" };
  }

  const recentByTeam: Record<string, PastMatchSummary[]> = {};
  await Promise.all(
    match.teams.map(async (team) => {
      recentByTeam[team.name] = await fetchTeamRecentMatches(match.game, team.id).catch(() => []);
    })
  );

  // Личные встречи: матчи первой команды, где соперником была вторая
  const [teamA, teamB] = match.teams;
  const headToHead =
    teamA && teamB
      ? (recentByTeam[teamA.name] ?? []).filter((m) => m.opponentName === teamB.name)
      : [];

  // Для идущего матча Dota 2 — подтягиваем драфт текущей карты
  const liveDraft =
    match.game === "dota2" && match.status === "live" && teamA && teamB
      ? await fetchLiveDraft(teamA.name, teamB.name).catch(() => null)
      : null;

  return { match, recentByTeam, headToHead, liveDraft, dataSource: "pandascore" };
}

/**
 * Полный цикл: контекст → генерация → сохранение анализа на диск
 * и прогноза в GitHub. Используется и роутом /api/analyze, и автопрогнозами.
 */
export async function produceAnalysis(
  match: Match,
  log: FastifyBaseLogger
): Promise<{ analysis: string; demo: boolean }> {
  const ctx = await buildContext(match);
  const { text: analysis, probs } = extractPrediction(await generateAnalysis(ctx));
  const demo = activeAiProvider() === "none";

  await mkdir(join(config.dataDir, "analyses"), { recursive: true });
  await writeFile(
    join(config.dataDir, "analyses", `${match.id}.json`),
    JSON.stringify(
      { matchId: match.id, match, analysis, demo, createdAt: new Date().toISOString() },
      null,
      2
    ),
    "utf8"
  );

  // Фиксируем прогноз для трекинга точности (первый прогноз — окончательный)
  if (probs && !demo && match.teams.length === 2) {
    const rec: PredictionRecord = {
      matchId: match.id,
      game: match.game,
      createdAt: new Date().toISOString(),
      statusAtPrediction: match.status,
      scoreAtPrediction: match.score,
      teams: match.teams.map((t) => ({ id: t.id, name: t.name })),
      probs,
    };
    savePredictionOnce(rec).catch((err) => log.error(err, "prediction save failed"));
  }

  return { analysis, demo };
}
