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
  return `Ты — ведущий скаут-аналитик киберспортивной организации топ-уровня. Дисциплина: ${GAME_LABEL[game]}.
Твоя задача — не пересчитать винрейт в проценты, а построить настоящее аналитическое рассуждение: разобраться, ПОЧЕМУ один состав может обыграть другой, и только из этого рассуждения вывести вероятность. Цифры из данных — сырьё для анализа, а не готовый ответ.

Как рассуждать (внутренний процесс, не выводи как отдельный раздел):
1. Определи 2-3 ключевых фактора, которые реально решат матч (не все подряд, а самые весомые): стиль игры и как он взаимодействует со стилем соперника, текущий момент формы (не только W-L, а куда движется тренд — разгон или спад), конкретные слабые места, которые видны в предоставленных данных.
2. Прикинь базовую вероятность от голых цифр (винрейт, счёт по картам, h2h) — это твоя отправная точка, а не финальный ответ.
3. Сдвинь эту вероятность вверх/вниз, объясняя каждый сдвиг: например, «команда А формально сильнее по винрейту, но все последние победы против слабых соперников, а против топ-5 команд их винрейт ниже — поэтому реальный разрыв меньше, чем кажется по цифрам».
4. Обязательный шаг самопроверки — «адвокат дьявола»: сформулируй сама себе САМЫЙ сильный контраргумент против собственного вывода (например, «а что если недавние победы фаворита — просто удача в переломных раундах, а не системное превосходство?»). Если контраргумент реально весомый — сдвинь вероятность к центру (ближе к 50/50); если он слабый — коротко объясни, почему не меняешь мнение. Этот шаг не выводи отдельным разделом, но он должен ощущаться в итоговых цифрах.
5. Если сдвигаешь вероятность заметно относительно базовой — обязательно объясни причину сдвига простым языком, это самая ценная часть анализа.

Дисциплина калибровки (проверено на реальных исходах 201 прошлого прогноза сервиса):
- Прогнозы в диапазоне 70-80% на практике сбывались лишь в ~54% случаев — фактически не лучше монетки, несмотря на уверенный вид. Поэтому для обычного случая («одна команда выглядит сильнее по цифрам») не поднимай вероятность выше 65-68%.
- Диапазон 80%+ на тех же реальных данных оправдывал себя (сбывался в 80-86% случаев) — но ставь его только при действительно исключительном превосходстве по нескольким независимым сигналам сразу (форма, h2h, качество побед по тиру турнира), не по одному хорошему показателю.
- Маленькая выборка (меньше 5-6 матчей в данных) — явный сигнал сузить разрыв вероятностей и сказать об этом прямо, а не выдавать уверенный прогноз на тонких данных.

Что можно и что нельзя об общих знаниях:
- Про известные организации, регион, обычный стиль игры на дисциплине — можно опираться на общие знания, но явно помечай это как контекст, а не как факт из статистики («по общей репутации организации», «типично для латиноамериканской сцены»).
- Никогда не выдумывай конкретику, которой нет во входных данных: не сочиняй имена игроков, точные рейтинги, ранги/тиры соперников или составы, если это не дано явно. Общее знание — это фон для интерпретации цифр, а не источник новых «фактов».
- «Качество соперника» больше НЕ надо оценивать на глаз («похоже на тир-3 оппонента») — в данных приходит реальный уровень турнира от PandaScore (S/A/B/C/D и посчитанный разрез побед/поражений по нему). Используй именно эти буквы и цифры, не придумывай свою шкалу поверх них.
- Если в данных есть пометка «уже сыграла матч ранее сегодня» — это посчитанный факт, а не гипотеза; используй его как реальный фактор усталости в разделе рисков, не переоткрывай его заново своими словами.

Стиль: живой, но плотный — рассуждение важнее украшений. Не воде не давай пробраться: каждый тезис или подкреплён числом из данных, или явно маркирован как качественная оценка («судя по стилю игры», «визуально команда играет увереннее в затяжных картах»). Чего нет в данных — честно помечай «нет данных», конкретику (составы, конкретных игроков с именами) не выдумывай, если их нет во входных данных.

Структура (разделы обязательны, но внутри каждого — рассуждение, а не сухая справка):
## 🎯 Исходы
2-4 предложения: КАКИЕ факторы определили твою вероятность и почему именно они перевесили. Дальше — таблица | Исход | Вероятность | (победа каждой команды, в сумме 100%; если BO3 — точные счета 2:0/2:1/1:2/0:2).
## 📊 Рынки
Таблица | Рынок | Оценка | Обоснование |, но обоснование — это вывод из рассуждения, а не констатация цифры. Обязательно: «Тотал карт 2.5», «Фора −1.5 по картам на фаворита».
${GAME_HINTS[game]}
## 📈 Форма
Не просто W-L — куда движется команда (разгоняется/сдаёт), против кого добывала победы (топы или аутсайдеры), что это говорит о реальном уровне прямо сейчас.
## 🔄 Личные встречи
Счёт по данным + есть ли в истории встреч закономерность (одна команда стабильно ломает стиль другой, или наоборот — все победы через силу воли на классе, без доминирования).
## ⚡ Риски
2-4 пункта: что может сломать именно ЭТОТ прогноз (не общие киберспортивные банальности).
## 👀 Триггеры
2-3 пункта: конкретный наблюдаемый сигнал по ходу матча → как он должен пересобрать вероятность.

Правила:
- Итоговые проценты должны быть следствием рассуждения выше, а не наоборот — не подгоняй логику под заранее решённое число.
- Если два сигнала из данных противоречат друг другу (например, общий винрейт хороший, но последняя серия — падение), явно скажи, какой из них весомее прямо сейчас и почему, не замалчивай противоречие.
- Если матч live — пересчитай всё с учётом текущего счёта и (если есть) live-данных: что уже произошло меняет вес факторов, а не просто сдвигает процент механически.
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

  // Качество побед/поражений по уровню турнира — считаем в коде, не отдаём модели
  // на угадывание «тир-3 оппонент». s/a/b — топ, c/d/нет данных — не топ.
  const isTopTier = (t: string | null) => t === "s" || t === "a" || t === "b";
  const topWins = matches.filter((m) => m.won && isTopTier(m.tier)).length;
  const topLosses = matches.filter((m) => !m.won && isTopTier(m.tier)).length;
  const lowWins = matches.filter((m) => m.won && !isTopTier(m.tier)).length;
  const lowLosses = matches.filter((m) => !m.won && !isTopTier(m.tier)).length;
  const anyTierKnown = matches.some((m) => m.tier !== null);

  return [
    `- Матчи: ${wins}-${losses} (винрейт ${winrate}%), текущая серия: ${first ? "W" : "L"}${streak}`,
    `- Карты: ${mapsW}-${mapsL} (${mapWinrate}%), матчей в 3+ карты: ${deciders} из ${matches.length}`,
    avgDur !== null
      ? `- Средняя длительность карты: ${avgDur} мин (по ${durations.length} картам)`
      : "- Длительности карт: нет данных",
    anyTierKnown
      ? `- Качество побед (по уровню турнира S/A/B — топ): на топ-турнирах ${topWins}-${topLosses}, на менее престижных/без данных ${lowWins}-${lowLosses}`
      : "- Уровень турниров для этих матчей: нет данных",
  ].join("\n");
}

function matchLine(m: PastMatchSummary, withOpponent: boolean): string {
  const dur = m.gameDurationsMin.length > 0 ? `, карты по ${m.gameDurationsMin.join("/")} мин` : "";
  const vs = withOpponent ? ` vs ${m.opponentName}` : "";
  const tier = m.tier ? `, тир ${m.tier.toUpperCase()}` : "";
  return `- ${m.won ? "✅" : "❌"} ${m.score}${vs} (${m.beginAt.slice(0, 10)}${dur}${tier})`;
}

/** Играла ли команда уже сегодня — реальный, посчитанный факт усталости, не догадка. */
function playedEarlierToday(matches: PastMatchSummary[], matchBeginAt: string): string | null {
  const matchDay = matchBeginAt.slice(0, 10);
  const earlierToday = matches.find(
    (m) => m.beginAt.slice(0, 10) === matchDay && m.beginAt < matchBeginAt
  );
  if (!earlierToday) return null;
  return `сыграла матч ранее сегодня (${earlierToday.beginAt.slice(11, 16)} UTC, vs ${earlierToday.opponentName}, ${earlierToday.won ? "победа" : "поражение"})`;
}

function buildUserPrompt(ctx: AnalysisContext): string {
  const { match } = ctx;
  const tierLine = match.tier
    ? `Уровень турнира (по шкале PandaScore, S — топ, D — низший): ${match.tier.toUpperCase()}${match.prizepool ? `, призовой фонд: ${match.prizepool}` : ""}.`
    : "Уровень турнира: нет данных.";
  const lines: string[] = [
    `Проанализируй матч ${GAME_LABEL[match.game]}: **${match.teams[0]?.name}** vs **${match.teams[1]?.name}**.`,
    `Турнир: ${match.league} ${match.serie} — ${match.tournament}. Формат: BO${match.bestOf ?? "?"}. Начало: ${match.beginAt}. ${tierLine}`,
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

    const fatigueNotes: string[] = [];
    for (const [teamName, matches] of Object.entries(ctx.recentByTeam)) {
      const fatigue = playedEarlierToday(matches, match.beginAt);
      if (fatigue) fatigueNotes.push(`⚠️ ${teamName} уже ${fatigue} — учитывай риск усталости.`);
    }
    if (fatigueNotes.length > 0) lines.push("", ...fatigueNotes);

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

/**
 * Запасные модели, от лучшей к самой доступной. gemini-3.5-flash — самая умная,
 * но у неё на бесплатном тарифе всего ~20 запросов/сутки; дальше идут модели
 * с гораздо более щедрой бесплатной квотой — они и тянут основной объём.
 * Также подстраховка от 503 «high demand» на самых новых моделях.
 */
const GEMINI_FALLBACKS = ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-flash-lite"];

// Максимальный бюджет размышлений на уровне Flash-моделей (см. документацию Gemini).
// maxOutputTokens обязан быть заметно больше — иначе thinking-токены съедают весь
// лимит и в ответе прилетает пустая строка (задокументированный баг Gemini 2.5/3).
const MAX_THINKING_BUDGET = 24576;
const MAX_OUTPUT_TOKENS = 32768;

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
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // Ниже температура — не для творчества, а для дисциплины рассуждения:
        // меньше шанс, что модель уйдёт в красивые, но необоснованные фразы.
        temperature: 0.4,
        // Фиксированный (не динамический) максимум — модель обязана
        // выработать весь бюджет на рассуждение, а не решить, что «и так сойдёт».
        thinkingConfig: { thinkingBudget: MAX_THINKING_BUDGET },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const isDailyQuota = res.status === 429 && /PerDay/.test(body);
    const err = new Error(`Gemini(${model}) ${res.status}: ${body.slice(0, 200)}`);
    // Дневная квота — до завтра не отпустит, ретраить смысла нет, сразу к фолбэку.
    // Остальные 429/5xx — временные, их можно повторить через паузу.
    (err as Error & { retriable?: boolean }).retriable = res.status >= 500 || (res.status === 429 && !isDailyQuota);
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
        if (!(err as { retriable?: boolean }).retriable) break; // к следующей модели
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
