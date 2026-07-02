import type { FastifyInstance } from "fastify";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateAnalysis, type AnalysisContext } from "./ai.js";
import { cacheGet, cacheSet } from "./cache.js";
import { activeAiProvider, config, hasPandascore } from "./config.js";
import { mockMatches } from "./mock-data.js";
import { fetchMatchById, fetchMatches, fetchTeamRecentMatches } from "./pandascore.js";
import { validateInitData } from "./telegram.js";
import type { Game, Match, PastMatchSummary } from "./types.js";

// Кэш короткий: у live-матчей меняется счёт
const MATCHES_TTL_MS = 30_000;
const GAMES: Game[] = ["cs2", "dota2"];

export async function registerRoutes(app: FastifyInstance) {
  // Защита API: проверяем подпись Telegram, если включено
  app.addHook("onRequest", async (req, reply) => {
    if (!config.requireTgAuth) return;
    if (!req.url.startsWith("/api/")) return;
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
    } else {
      matches = mockMatches();
    }
    cacheSet("matches", matches, MATCHES_TTL_MS);
    return { matches, demo: !hasPandascore() };
  });

  app.post<{ Body: { matchId: number } }>("/api/analyze", async (req, reply) => {
    const matchId = Number(req.body?.matchId);
    if (!Number.isFinite(matchId)) {
      return reply.code(400).send({ error: "matchId is required" });
    }

    // Готовый анализ переиспользуем (и он же пригодится для проверки точности постфактум)
    const file = join(config.dataDir, "analyses", `${matchId}.json`);
    let saved: { analysis: string; demo: boolean; match?: Match } | null = null;
    try {
      saved = JSON.parse(await readFile(file, "utf8"));
    } catch {
      /* нет сохранённого */
    }

    const match = (await findMatch(matchId)) ?? saved?.match;
    if (!match) return reply.code(404).send({ error: "Match not found" });

    // Для live-матча анализ устаревает при смене счёта — тогда пересчитываем
    const savedIsFresh =
      saved !== null && !(match.status === "live" && saved.match?.score !== match.score);
    if (saved && savedIsFresh) {
      return { analysis: saved.analysis, cached: true, demo: saved.demo };
    }

    const ctx = await buildContext(match);
    const analysis = await generateAnalysis(ctx);
    const demo = activeAiProvider() === "none";

    await mkdir(join(config.dataDir, "analyses"), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({ matchId, match, analysis, demo, createdAt: new Date().toISOString() }, null, 2),
      "utf8"
    );

    return { analysis, cached: false, demo };
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

  return { match, recentByTeam, headToHead, dataSource: "pandascore" };
}
