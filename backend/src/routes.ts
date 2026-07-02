import type { FastifyInstance } from "fastify";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateAnalysis, type AnalysisContext } from "./ai.js";
import { cacheGet, cacheSet } from "./cache.js";
import { config, hasAnthropic, hasPandascore } from "./config.js";
import { mockMatches } from "./mock-data.js";
import { fetchMatchById, fetchTeamRecentMatches, fetchUpcomingMatches } from "./pandascore.js";
import { validateInitData } from "./telegram.js";
import type { Match, PastMatchSummary } from "./types.js";

const MATCHES_TTL_MS = 60_000;

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
    ai: hasAnthropic(),
    model: config.aiModel,
  }));

  app.get("/api/matches", async (_req, reply) => {
    const cached = cacheGet<Match[]>("matches");
    if (cached) return { matches: cached, demo: !hasPandascore() };

    let matches: Match[];
    if (hasPandascore()) {
      try {
        matches = await fetchUpcomingMatches();
      } catch (err) {
        app.log.error(err, "PandaScore failed, falling back to mock");
        return reply.code(200).send({ matches: mockMatches(), demo: true });
      }
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
    try {
      const saved = JSON.parse(await readFile(file, "utf8"));
      return { analysis: saved.analysis, cached: true, demo: saved.demo };
    } catch {
      /* нет сохранённого — генерируем */
    }

    const match = await findMatch(matchId);
    if (!match) return reply.code(404).send({ error: "Match not found" });

    const ctx = await buildContext(match);
    const analysis = await generateAnalysis(ctx);
    const demo = !hasAnthropic();

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
      recentByTeam[team.name] = await fetchTeamRecentMatches(team.id).catch(() => []);
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
