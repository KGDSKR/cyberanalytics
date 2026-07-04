import Anthropic from "@anthropic-ai/sdk";
import { activeAiProvider, config } from "./config.js";
import type { LiveDraft } from "./dota-live.js";
import { mockAnalysis } from "./mock-data.js";
import type { Game, Match, PastMatchSummary } from "./types.js";

const GAME_LABEL: Record<Game, string> = { cs2: "CS2 (Counter-Strike 2)", dota2: "Dota 2" };

const GAME_HINTS: Record<Game, string> = {
  cs2: `- В разделе «Рынки» добавь строку «Тотал раундов на карте» — данных по раундам в статистике нет, поэтому в оценке пиши «нет данных» (не выдумывай).
- Специфика CS2: пул карт и пики, пистолетные раунды. Длинная средняя карта (>40 мин с учётом пауз) — признак равных, затяжных игр.`,
  dota2: `- В разделе «Рынки» ОБЯЗАТЕЛЬНО добавь строку «Тотал по времени карты»: по средним длительностям карт обеих команд предложи порог в минутах и оценку Б/М с вероятностью.
- Добавь строку «Тотал киллов»: если в данных есть live-киллы текущей карты — оцени по ним, иначе пометь «нет данных».
- Специфика Dota 2: короткие карты (<35 мин) = темповый стиль, длинные (>45 мин) = затяжной; учитывай при оценке тотала по времени.
- Если в данных есть live-драфт текущей карты (герои, киллы, золото) — ОБЯЗАТЕЛЬНО учитывай его в «Исходах» и «Рынках»: сила драфта в лейте против темпа, текущее преимущество по золоту/киллам, тайминги пиков. Отдельный раздел с разбором драфта НЕ выводи — только вплетай выводы в вероятности (можно короткими упоминаниями героев в обоснованиях).`,
};

function systemPrompt(game: Game): string {
  return `Ты — количественный аналитик киберспорта сервиса CyberAnalytics. Дисциплина: ${GAME_LABEL[game]}.
Пишешь плотную статистическую сводку матча на русском языке в Markdown.

Стиль — телеграфный: без приветствий, вступлений и заключений, без общих фраз. Каждый тезис подкрепляй числом из предоставленных данных. Чего нет в данных — честно помечай «нет данных», конкретику не выдумывай.

Структура (строго эти разделы):
## 🎯 Исходы
Таблица | Исход | Вероятность |: победа каждой команды (в сумме 100%). Если формат BO3 — добавь строки точного счёта 2:0 / 2:1 / 1:2 / 0:2.
## 📊 Рынки
Таблица | Рынок | Оценка | Обоснование |. Обоснование — одна короткая фраза с цифрами.
Обязательные строки: «Тотал карт 2.5» (Б/М + вероятность), «Фора −1.5 по картам на фаворита» (вероятность).
${GAME_HINTS[game]}
## 📈 Форма
По каждой команде компактный блок: W-L за последние матчи, текущая серия, счёт по картам, средняя длительность карты. После блоков — 1-2 предложения выводов, только с цифрами.
## 🔄 Личные встречи
Счёт противостояния по данным, последние результаты, вывод одной строкой.
## ⚡ Риски
2-4 пункта списком, каждый не длиннее 15 слов.
## 👀 Триггеры
2-3 пункта: конкретный наблюдаемый сигнал по ходу матча → как он сдвигает прогноз.

Правила:
- Вероятности выводи из данных (винрейты, счёт по картам, h2h), проценты между разделами должны быть согласованы (точные счета в сумме дают вероятности побед).
- Если матч live — пересчитай всё с учётом текущего счёта: какие рынки уже закрыты, что осталось в игре.
- Никаких советов по суммам и призывов ставить — только вероятностные оценки рынков.
- Служебное требование: самой последней строкой ответа добавь скрытый комментарий строго вида <!--PRED {"team1": X, "team2": Y}--> где X и Y — целые вероятности победы (в сумме 100) первой и второй команды в порядке их упоминания в задании. Значения должны совпадать с разделом «Исходы». После комментария — ничего.`;
}

/** Вырезает из ответа ИИ служебный прогноз <!--PRED {...}--> для трекинга точности. */
export function extractPrediction(text: string): { text: string; probs: [number, number] | null } {
  const m = text.match(/<!--\s*PRED\s*(\{[^]*?\})\s*-->/);
  if (!m) return { text, probs: null };
  const cleaned = text.replace(m[0], "").trimEnd();
  try {
    const p = JSON.parse(m[1]!) as { team1?: unknown; team2?: unknown };
    const t1 = Number(p.team1);
    const t2 = Number(p.team2);
    if (Number.isFinite(t1) && Number.isFinite(t2) && t1 >= 0 && t2 >= 0) {
      return { text: cleaned, probs: [Math.round(t1), Math.round(t2)] };
    }
  } catch {
    /* битый JSON — прогноз не записываем */
  }
  return { text: cleaned, probs: null };
}

export interface AnalysisContext {
  match: Match;
  recentByTeam: Record<string, PastMatchSummary[]>;
  headToHead: PastMatchSummary[];
  liveDraft?: LiveDraft | null;
  dataSource: "pandascore" | "none";
}

/** Агрегаты считаем в коде — арифметику модели не доверяем. */
function teamAggregates(matches: PastMatchSummary[]): string {
  if (matches.length === 0) return "- данных нет";
  const wins = matches.filter((m) => m.won).length;
  const losses = matches.length - wins;
  let mapsW = 0;
  let mapsL = 0;
  let deciders = 0;
  const durations: number[] = [];
  for (const m of matches) {
    const [a, b] = m.score.split(":").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      mapsW += a!;
      mapsL += b!;
      if (a! + b! >= 3) deciders++;
    }
    durations.push(...m.gameDurationsMin);
  }
  const first = matches[0]!.won;
  let streak = 0;
  for (const m of matches) {
    if (m.won === first) streak++;
    else break;
  }
  const avgDur = durations.length
    ? (durations.reduce((s, x) => s + x, 0) / durations.length).toFixed(1)
    : null;
  const winrate = Math.round((wins / matches.length) * 100);
  const mapWinrate = mapsW + mapsL > 0 ? Math.round((mapsW / (mapsW + mapsL)) * 100) : 0;
  return [
    `- Матчи: ${wins}-${losses} (винрейт ${winrate}%), текущая серия: ${first ? "W" : "L"}${streak}`,
    `- Карты: ${mapsW}-${mapsL} (${mapWinrate}%), матчей в 3+ карты: ${deciders} из ${matches.length}`,
    avgDur !== null
      ? `- Средняя длительность карты: ${avgDur} мин (по ${durations.length} картам)`
      : "- Длительности карт: нет данных",
  ].join("\n");
}

function matchLine(m: PastMatchSummary, withOpponent: boolean): string {
  const dur = m.gameDurationsMin.length > 0 ? `, карты по ${m.gameDurationsMin.join("/")} мин` : "";
  const vs = withOpponent ? ` vs ${m.opponentName}` : "";
  return `- ${m.won ? "✅" : "❌"} ${m.score}${vs} (${m.beginAt.slice(0, 10)}${dur})`;
}

function buildUserPrompt(ctx: AnalysisContext): string {
  const { match } = ctx;
  const lines: string[] = [
    `Проанализируй матч ${GAME_LABEL[match.game]}: **${match.teams[0]?.name}** vs **${match.teams[1]?.name}**.`,
    `Турнир: ${match.league} ${match.serie} — ${match.tournament}. Формат: BO${match.bestOf ?? "?"}. Начало: ${match.beginAt}.`,
  ];
  if (match.status === "live") {
    lines.push(`⚠️ Матч уже идёт! Текущий счёт по картам/играм: ${match.score ?? "неизвестен"} (в порядке команд выше).`);
    if (match.roundScore) {
      lines.push(
        `Текущая карта${match.mapName ? ` (${match.mapName})` : ""} — счёт по раундам: ${match.roundScore}. Учитывай это в вероятностях (карта до 13 раундов).`
      );
    }
  }
  if (ctx.liveDraft) {
    const d = ctx.liveDraft;
    const [a, b] = match.teams;
    lines.push(
      "",
      `### Live-данные текущей карты${d.gameTimeMin !== null ? ` (минута ${d.gameTimeMin})` : " (карта только началась)"}:`,
      `- Драфт ${a?.name}: ${d.heroes[0].join(", ") || "драфт ещё идёт"}`,
      `- Драфт ${b?.name}: ${d.heroes[1].join(", ") || "драфт ещё идёт"}`,
      d.kills !== null ? `- Киллы: ${d.kills[0]}:${d.kills[1]}` : "- Киллы: данных ещё нет",
      d.goldLead !== null
        ? `- Золото: ${d.goldLead >= 0 ? `+${d.goldLead} у ${a?.name}` : `+${-d.goldLead} у ${b?.name}`}`
        : "- Золото: нет данных"
    );
  }
  lines.push("");
  if (ctx.dataSource === "pandascore") {
    lines.push("Данные PandaScore по последним матчам (новые сверху). Счёт всегда с точки зрения самой команды.");
    for (const [teamName, matches] of Object.entries(ctx.recentByTeam)) {
      lines.push(`\n### ${teamName} — агрегаты:`);
      lines.push(teamAggregates(matches));
      if (matches.length > 0) {
        lines.push("Матчи:");
        for (const m of matches) lines.push(matchLine(m, true));
      }
    }
    if (ctx.headToHead.length > 0) {
      const h2hWins = ctx.headToHead.filter((m) => m.won).length;
      lines.push(
        `\n### Личные встречи (с точки зрения ${match.teams[0]?.name}): ${h2hWins}-${ctx.headToHead.length - h2hWins}`
      );
      for (const m of ctx.headToHead) lines.push(matchLine(m, false));
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
