import Anthropic from "@anthropic-ai/sdk";
import { config, hasAnthropic } from "./config.js";
import { mockAnalysis } from "./mock-data.js";
import type { Match, PastMatchSummary } from "./types.js";

const SYSTEM_PROMPT = `Ты — профессиональный аналитик киберспорта (CS2) сервиса CyberAnalytics.
Твоя задача — написать глубокий, но читабельный анализ предстоящего матча на русском языке в Markdown.

Структура ответа (строго эти разделы, с эмодзи в заголовках):
## 🎯 Прогноз победы — таблица с вероятностями победы каждой команды в процентах (в сумме 100%)
## 📈 Форма команд — как команды выглядят в последних матчах
## ⭐ Ключевые игроки — кто может решить исход (если данных об игроках нет — оцени по командным результатам и общеизвестной информации, честно это оговорив)
## 🔄 Личные встречи — история противостояния по предоставленным данным
## ⚡ Факторы риска — что может сломать прогноз
## 👀 На что смотреть — 2-3 конкретных совета зрителю

Правила:
- Опирайся в первую очередь на предоставленные данные; общие знания используй осторожно и помечай как контекст.
- Если данных мало, честно скажи об этом и снизь уверенность прогноза.
- Пиши живо и конкретно, без воды. Проценты — реалистичные, не 50/50 без причины.
- Не давай советов по ставкам и суммам. Это информационный анализ для зрителей.`;

export interface AnalysisContext {
  match: Match;
  recentByTeam: Record<string, PastMatchSummary[]>;
  headToHead: PastMatchSummary[];
  dataSource: "pandascore" | "none";
}

function buildUserPrompt(ctx: AnalysisContext): string {
  const { match } = ctx;
  const lines: string[] = [
    `Проанализируй матч CS2: **${match.teams[0]?.name}** vs **${match.teams[1]?.name}**.`,
    `Турнир: ${match.league} ${match.serie} — ${match.tournament}. Формат: BO${match.bestOf ?? "?"}. Начало: ${match.beginAt}.`,
    "",
  ];
  if (ctx.dataSource === "pandascore") {
    lines.push("Данные PandaScore (последние матчи каждой команды, новые сверху):");
    for (const [teamName, matches] of Object.entries(ctx.recentByTeam)) {
      lines.push(`\n${teamName}:`);
      for (const m of matches) {
        lines.push(`- ${m.won ? "✅ победа" : "❌ поражение"} vs ${m.opponentName} (${m.score}) — ${m.beginAt.slice(0, 10)}`);
      }
    }
    if (ctx.headToHead.length > 0) {
      lines.push(`\nЛичные встречи (с точки зрения ${match.teams[0]?.name}):`);
      for (const m of ctx.headToHead) {
        lines.push(`- ${m.won ? "✅ победа" : "❌ поражение"} (${m.score}) — ${m.beginAt.slice(0, 10)}`);
      }
    } else {
      lines.push("\nЛичных встреч в предоставленных данных не найдено.");
    }
  } else {
    lines.push("Статистика недоступна (API не подключён) — сделай осторожный анализ на общих знаниях о командах и явно оговори ограничения.");
  }
  return lines.join("\n");
}

export async function generateAnalysis(ctx: AnalysisContext): Promise<string> {
  if (!hasAnthropic()) {
    // Демо-режим: имитируем задержку генерации
    await new Promise((r) => setTimeout(r, 1500));
    return mockAnalysis(ctx.match);
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: config.aiModel,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(ctx) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Модель отклонила запрос (refusal)");
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  if (!text.trim()) throw new Error("Пустой ответ модели");
  return text;
}
