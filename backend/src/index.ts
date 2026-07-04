import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { startAutoPredict } from "./auto-predict.js";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";

const app = Fastify({ logger: true });

await app.register(fastifyCors, { origin: true });
// Защита квот Gemini/PandaScore от спама: общий лимит на IP,
// на /api/analyze — отдельный жёсткий (задан в конфиге роута)
await app.register(fastifyRateLimit, {
  max: 60,
  timeWindow: "1 minute",
  errorResponseBuilder: () => ({
    statusCode: 429,
    error: "Слишком много запросов — подожди минуту",
  }),
});
await registerRoutes(app);

// В проде отдаём собранный фронтенд той же нодой
const frontendDist = resolve(import.meta.dirname, "../../frontend/dist");
if (existsSync(frontendDist)) {
  await app.register(fastifyStatic, { root: frontendDist });
}

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// «Будильник»: free-тариф Render усыпляет сервис после ~15 минут без входящего
// трафика. Пингуем свой публичный адрес каждые 10 минут — трафик идёт через
// прокси Render и сбрасывает таймер сна. RENDER_EXTERNAL_URL задаёт сам Render.
const externalUrl = process.env.RENDER_EXTERNAL_URL;
if (externalUrl) {
  setInterval(() => {
    fetch(`${externalUrl}/api/health`).catch(() => {});
  }, 10 * 60_000);
  app.log.info(`keep-alive: ping ${externalUrl}/api/health every 10 min`);
}

// Автопрогнозы на все матчи ближайшего часа — для вкладки «Точность»
startAutoPredict(app.log);
