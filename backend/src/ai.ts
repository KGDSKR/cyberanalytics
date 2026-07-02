import Anthropic from "@anthropic-ai/sdk";
import { activeAiProvider, config } from "./config.js";
import { mockAnalysis } from "./mock-data.js";
import type { Game, Match, PastMatchSummary } from "./types.js";

const GAME_LABEL: Record<Game, string> = { cs2: "CS2 (Counter-Strike 2)", dota2: "Dota 2" };

const GAME_HINTS: Record<Game, string> = {
  cs2: "Для CS2 учитывай специфику: пул карт и пики, пистолетные раунды, роль снайпера, форма на конкретных картах.",
  dota2: "Для Dota 2 учитывай специфику: драфты и пул героев, стиль игры (темповый/затяжной), роль керри и мидера, патч.",
};

function systemPrompt(game: Game): string {
  return `Ты — профессиональный аналитик киберспорта сервиса CyberAnalytics. Дисциплина: ${GAME_LABEL[game]}.
Твоя задача — написать глубокий, но читабельный анализ матча на русском языке в Markdown.

Структура ответа (строго эти разделы, с эмодзи в заголовках):
## 🎯 Прогноз победы — таблица с вероятностями победы каждой команды в процентах (в сумме 100%)
## 📈 Форма команд — как команды выглядят в последних матчах
## ⭐ Ключевые игроки — кто может решить исход (если данных об игроках нет — оцени по командным результатам и общеизвестной информации, честно это оговорив)
## 🔄 Личные встречи — история противостояния по предоставленным данным
## ⚡ Факторы риска — что может сломать прогноз
## 👀 На что смотреть — 2-3 конкретных совета зрителю

Правила:
- Опирайся в первую очередь на предоставленные данные; общие знания используй осторожно и помечай как контекст.
- ${GAME_HINTS[game]}
- Если матч уже идёт (live) — учти текущий счёт в прогнозе.
- Если данных мало, честно скажи об этом и снизь уверенность прогноза.
- Пиши живо и конкретно, без воды. Проценты — реалистичные, не 50/50 без причины.
- Не давай советов по ставкам и суммам. Это информационный анализ для зрителей.`;
}

export interface AnalysisContext {
  match: Match;
  recentByTeam: Record<string, PastMatchSummary[]>;
  headToHead: PastMatchSummary[];
  dataSource: "pandascore" | "none";
}

function buildUserPrompt(ctx: AnalysisContext): string {
  const { match } = ctx;
  const lines: string[] = [
    `Проанализируй матч ${GAME_LABEL[match.game]}: **${match.teams[0]?.name}** vs **${match.teams[1]?.name}**.`,
    `Турнир: ${match.league} ${match.serie} — ${match.tournament}. Формат: BO${match.bestOf ?? "?"}. Начало: ${match.beginAt}.`,
  ];
  if (match.status === "live") {
    lines.push(`⚠️ Матч уже идёт! Текущий счёт по картам/играм: ${match.score ?? "неизвестен"} (в порядке команд выше).`);
  }
  lines.push("");
  if (ctx.dataSource === "pandascore") {
    lines.push("Данные PandaScore (последние матчи каждой команды, новые сверху):");
    for (const [teamName, matches] of Object.entries(ctx.recentByTeam)) {
      lines.push(`\n${teamName}:`);
      if (matches.length === 0) lines.push("- данных нет");
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

async function generateWithClaude(system: string, user: string): Promise<string> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: config.aiModel,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: user }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Модель отклонила запрос (refusal)");
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  if (!text.trim()) throw new Error("Пустой ответ Claude");
  return text;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

/** Запасные модели: новые Gemini на бесплатном тарифе часто отвечают 503 (high demand). */
const GEMINI_FALLBACKS = ["gemini-3-flash-preview", "gemini-2.5-flash"];

async function geminiCall(model: string, system: string, user: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": config.geminiApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: 16384, temperature: 0.7 },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Gemini(${model}) ${res.status}: ${body.slice(0, 200)}`);
    (err as Error & { retriable?: boolean }).retriable = res.status === 429 || res.status >= 500;
    throw err;
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: GeminiPart[] } }[];
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");

  if (!text.trim()) throw new Error(`Пустой ответ Gemini (${model})`);
  return text;
}

async function generateWithGemini(system: string, user: string): Promise<string> {
  const models = [...new Set([config.geminiModel, ...GEMINI_FALLBACKS])];
  let lastError: unknown;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await geminiCall(model, system, user);
      } catch (err) {
        lastError = err;
        if (!(err as { retriable?: boolean }).retriable) throw err;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  throw lastError;
}

export async function generateAnalysis(ctx: AnalysisContext): Promise<string> {
  const provider = activeAiProvider();
  if (provider === "none") {
    // Демо-режим: имитируем задержку генерации
    await new Promise((r) => setTimeout(r, 1500));
    return mockAnalysis(ctx.match);
  }

  const system = systemPrompt(ctx.match.game);
  const user = buildUserPrompt(ctx);
  return provider === "gemini"
    ? generateWithGemini(system, user)
    : generateWithClaude(system, user);
}
