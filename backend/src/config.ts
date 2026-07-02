import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// .env лежит в корне репозитория, а процесс запускается из backend/
loadEnv({ path: resolve(import.meta.dirname, "../../.env") });

export const config = {
  port: Number(process.env.PORT ?? 3000),
  pandascoreToken: process.env.PANDASCORE_TOKEN ?? "",
  aiProvider: process.env.AI_PROVIDER ?? "auto",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "claude-opus-4-8",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
  steamApiKey: process.env.STEAM_API_KEY ?? "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  requireTgAuth: (process.env.REQUIRE_TG_AUTH ?? "false") === "true",
  dataDir: resolve(import.meta.dirname, "../../data"),
};

export const hasPandascore = () => config.pandascoreToken.length > 0;

export type AiProvider = "gemini" | "claude" | "none";

/** Какой ИИ реально доступен с учётом настроек и наличия ключей. */
export function activeAiProvider(): AiProvider {
  const pref = config.aiProvider.toLowerCase();
  if (pref === "gemini" && config.geminiApiKey) return "gemini";
  if (pref === "claude" && config.anthropicApiKey) return "claude";
  // auto или указанный провайдер без ключа — берём что есть
  if (config.geminiApiKey) return "gemini";
  if (config.anthropicApiKey) return "claude";
  return "none";
}
