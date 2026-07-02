import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";

const app = Fastify({ logger: true });

await app.register(fastifyCors, { origin: true });
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
