import type { FastifyInstance } from "fastify";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractPrediction, generateAnalysis, type AnalysisContext } from "./ai.js";
import { cacheGet, cacheSet } from "./cache.js";
import { activeAiProvider, config, hasPandascore } from "./config.js";
import { fetchCsRounds } from "./cs-live.js";
import { fetchLiveDraft, fetchPastDrafts } from "./dota-live.js";
import { listPredictions, savePredictionOnce, type PredictionRecord } from "./github-store.js";
import { mockMatches } from "./mock-data.js";
import {
  fetchMatchById,
  fetchMatches,
  fetchMatchResult,
  fetchPastMatches,
  fetchTeamRecentMatches,
  type MatchResult,
} from "./pandascore.js";
import { validateInitData } from "./telegram.js";
import type { Game, Match, PastMatch, PastMatchSummary } from "./types.js";

// Кэш короткий: у live-матчей меняется счёт
const MATCHES_TTL_MS = 30_000;
const GAMES: Game[] = ["cs2", "dota2"];

export async function registerRoutes(app: FastifyInstance) {
  // Защита API: проверяем подпись Telegram, если включено
  app.addHook("onRequest", async (req, reply) => {
    if (!config.requireTgAuth) return;
    if (!req.url.startsWith("/api/")) return;
    if (req.url === "/api/health") return; // health-check хостинга, ничего секретного
    const initData = req.headers["x-telegram-init-data"];
    if (typeof initData !== "string" || !validateInitData(initData, config.telegramBotToken)) {
      return reply.code(401).send({ error: "Invalid Telegram init data" });
    }
  });

  app.get("/api/health", async () => ({
    ok: true,
    pandascore: hasPandascore(),
    ai: activeAiProvider(),
    model: activeAiProvider() === "gemini" ? config.geminiModel : config.aiModel,
  }));

  app.get("/api/matches", async () => {
    const cached = cacheGet<Match[]>("matches");
    if (cached) return { matches: cached, demo: !hasPandascore() };

    let matches: Match[];
    if (hasPandascore()) {
      // 4 списка параллельно: live + предстоящие для каждой игры.
      // Если какой-то запрос упал — показываем остальные, а не ошибку.
      const results = await Promise.allSettled(
        GAMES.flatMap((g) => [fetchMatches(g, "running"), fetchMatches(g, "upcoming")])
      );
      matches = results
        .filter((r): r is PromiseFulfilledResult<Match[]> => r.status === "fulfilled")
        .flatMap((r) => r.value);
      for (const r of results) {
        if (r.status === "rejected") app.log.error(r.reason, "PandaScore list failed");
      }
      if (matches.length === 0 && results.every((r) => r.status === "rejected")) {
        return { matches: mockMatches(), demo: true };
      }
      // live первыми, дальше по времени начала
      matches.sort((m1, m2) => {
        if (m1.status !== m2.status) return m1.status === "live" ? -1 : 1;
        return m1.beginAt.localeCompare(m2.beginAt);
      });
      // Раунды текущей карты для live CS2 (bo3.gg); сбой источника не роняет список
      await Promise.all(
        matches
          .filter((m) => m.game === "cs2" && m.status === "live" && m.teams.length === 2)
          .map(async (m) => {
            const live = await fetchCsRounds(m.teams[0]!.name, m.teams[1]!.name).catch(() => null);
            if (live) {
              m.roundScore = `${live.rounds[0]}:${live.rounds[1]}`;
              m.mapName = live.mapName;
            }
          })
      );
    } else {
      matches = mockMatches();
    }
    cacheSet("matches", matches, MATCHES_TTL_MS);
    return { matches, demo: !hasPandascore() };
  });

  // Прошедшие матчи: постранично, с поиском
  app.get<{ Querystring: { game?: string; page?: string; q?: string; league?: string } }>(
    "/api/past",
    async (req, reply) => {
      const game = (req.query.game === "dota2" ? "dota2" : "cs2") as Game;
      const page = Math.max(1, Number(req.query.page) || 1);
      const q = (req.query.q ?? "").trim().slice(0, 60);
      const leagueId = Number(req.query.league) || 0;
      if (!hasPandascore()) return { matches: [], demo: true };

      const key = `past:${game}:${page}:${q.toLowerCase()}:${leagueId}`;
      const cached = cacheGet<PastMatch[]>(key);
      if (cached) return { matches: cached, demo: false };

      try {
        const matches = await fetchPastMatches(game, page, q, leagueId || undefined);
        cacheSet(key, matches, 5 * 60_000);
        return { matches, demo: false };
      } catch (err) {
        app.log.error(err, "past matches failed");
        return reply.code(502).send({ error: "Не удалось загрузить прошедшие матчи" });
      }
    }
  );

  // Драфты завершённого матча Dota 2 (все карты серии)
  app.post<{ Body: { match: PastMatch } }>("/api/past-draft", async (req, reply) => {
    const match = req.body?.match;
    if (!match?.id || match.game !== "dota2" || !Array.isArray(match.teams)) {
      return reply.code(400).send({ error: "match (dota2) is required" });
    }
    const drafts = await fetchPastDrafts(match).catch(() => null);
    return { drafts };
  });

  // Live-драфт текущей карты (Dota 2): для плашки в интерфейсе
  app.get<{ Querystring: { matchId: string } }>("/api/draft", async (req) => {
    const matchId = Number(req.query.matchId);
    if (!Number.isFinite(matchId)) return { draft: null };
    const match = await findMatch(matchId);
    if (!match || match.game !== "dota2" || match.status !== "live") return { draft: null };
    const [a, b] = match.teams;
    if (!a || !b) return { draft: null };
    const draft = await fetchLiveDraft(a.name, b.name).catch(() => null);
    return { draft };
  });

  app.post<{ Body: { matchId: number } }>(
    "/api/analyze",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const matchId = Number(req.body?.matchId);
    if (!Number.isFinite(matchId)) {
      return reply.code(400).send({ error: "matchId is required" });
    }

    // Готовый анализ переиспользуем (и он же пригодится для проверки точности постфактум)
    const file = join(config.dataDir, "analyses", `${matchId}.json`);
    let saved: { analysis: string; demo: boolean; match?: Match; createdAt?: string } | null = null;
    try {
      saved = JSON.parse(await readFile(file, "utf8"));
    } catch {
      /* нет сохранённого */
    }

    const match = (await findMatch(matchId)) ?? saved?.match;
    if (!match) return reply.code(404).send({ error: "Match not found" });

    // Live-анализ устаревает при смене счёта или через 10 минут (драфт/золото меняются)
    const LIVE_ANALYSIS_TTL_MS = 10 * 60_000;
    const savedIsFresh =
      saved !== null &&
      (match.status !== "live" ||
        (saved.match?.score === match.score &&
          Date.now() - new Date(saved.createdAt ?? 0).getTime() < LIVE_ANALYSIS_TTL_MS));
    if (saved && savedIsFresh) {
      return { analysis: saved.analysis, cached: true, demo: saved.demo };
    }

    const ctx = await buildContext(match);
    const { text: analysis, probs } = extractPrediction(await generateAnalysis(ctx));
    const demo = activeAiProvider() === "none";

    await mkdir(join(config.dataDir, "analyses"), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({ matchId, match, analysis, demo, createdAt: new Date().toISOString() }, null, 2),
      "utf8"
    );

    // Фиксируем прогноз для трекинга точности (первый прогноз — окончательный)
    if (probs && !demo && match.teams.length === 2) {
      const rec: PredictionRecord = {
        matchId,
        game: match.game,
        createdAt: new Date().toISOString(),
        statusAtPrediction: match.status,
        scoreAtPrediction: match.score,
        teams: match.teams.map((t) => ({ id: t.id, name: t.name })),
        probs,
      };
      savePredictionOnce(rec).catch((err) => app.log.error(err, "prediction save failed"));
    }

    return { analysis, cached: false, demo };
    }
  );

  // Проверка точности прогнозов: сверяем сохранённые прогнозы с итогами матчей
  app.get("/api/accuracy", async () => {
    const preds = await listPredictions();
    const items = await Promise.all(
      preds.map(async (p) => {
        let result: MatchResult | null = cacheGet<MatchResult>(`result:${p.matchId}`) ?? null;
        if (!result && hasPandascore()) {
          result = await fetchMatchResult(p.matchId).catch(() => null);
          if (result) {
            // завершённый матч не изменится — кэшируем надолго, идущий — коротко
            const ttl = result.status === "finished" || result.status === "canceled" ? 24 * 3_600_000 : 5 * 60_000;
            cacheSet(`result:${p.matchId}`, result, ttl);
          }
        }

        const picked = p.probs[0] >= p.probs[1] ? 0 : 1;
        const pickedTeam = p.teams[picked];
        let status: "pending" | "correct" | "wrong" | "canceled" = "pending";
        let finalScore: string | null = null;
        let winnerName: string | null = null;

        if (result?.status === "canceled") status = "canceled";
        else if (result?.status === "finished") {
          status = result.winnerId === pickedTeam?.id ? "correct" : "wrong";
          finalScore = p.teams
            .map((t) => result.scores.find((s) => s.teamId === t.id)?.score ?? 0)
            .join(":");
          winnerName = p.teams.find((t) => t.id === result.winnerId)?.name ?? null;
        }

        return {
          matchId: p.matchId,
          game: p.game,
          createdAt: p.createdAt,
          teams: p.teams.map((t) => t.name),
          probs: p.probs,
          pickedName: pickedTeam?.name ?? "",
          pickedProb: p.probs[picked],
          statusAtPrediction: p.statusAtPrediction,
          scoreAtPrediction: p.scoreAtPrediction,
          status,
          finalScore,
          winnerName,
        };
      })
    );

    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const decided = items.filter((i) => i.status === "correct" || i.status === "wrong");
    const correct = decided.filter((i) => i.status === "correct").length;
    return {
      summary: {
        total: items.length,
        decided: decided.length,
        correct,
        accuracy: decided.length > 0 ? Math.round((correct / decided.length) * 100) : null,
      },
      items,
    };
  });
}

async function findMatch(matchId: number): Promise<Match | undefined> {
  const cached = cacheGet<Match[]>("matches");
  const fromCache = cached?.find((m) => m.id === matchId);
  if (fromCache) return fromCache;

  if (!hasPandascore()) return mockMatches().find((m) => m.id === matchId);

  try {
    return await fetchMatchById(matchId);
  } catch {
    return undefined;
  }
}

async function buildContext(match: Match): Promise<AnalysisContext> {
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
