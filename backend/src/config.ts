import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// .env лежит в корне репозитория, а процесс запускается из backend/
loadEnv({ path: resolve(import.meta.dirname, "../../.env") });

export const config = {
  port: Number(process.env.PORT ?? 3000),
  pandascoreToken: process.env.PANDASCORE_TOKEN ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "claude-opus-4-8",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  requireTgAuth: (process.env.REQUIRE_TG_AUTH ?? "false") === "true",
  dataDir: resolve(import.meta.dirname, "../../data"),
};

export const hasPandascore = () => config.pandascoreToken.length > 0;
export const hasAnthropic = () => config.anthropicApiKey.length > 0;
