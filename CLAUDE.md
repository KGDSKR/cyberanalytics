# CyberAnalytics — Telegram Mini App

Отвечай по-русски. Пользователь (Вилли) — контент-креатор, не программист: делегирует всю
техническую часть полностью («ты мои руки», роль Claude — техлид с полной автономией).
Объясняй, что куда класть и что нажимать, давай решения сразу и по шагам.

## Что это

Мини-приложение Telegram: ИИ-аналитика киберспортивных матчей CS2 (позже Dota 2).
Пользователь видит список ближайших матчей, жмёт на матч → Claude генерирует анализ
(прогноз победы, форма, составы, личные встречи, риски). Справочно — ссылка на Betboom.
Анализ информационный, не букмекерский сервис: дисклеймер «не финансовая рекомендация, 18+».

## Архитектура

npm workspaces, две части:

- **`backend/`** — Node.js 22 + Fastify + TypeScript (запуск через tsx, без сборки).
  Прячет ключи API, отдаёт REST: `GET /api/matches`, `POST /api/analyze {matchId}`,
  `GET /api/health`. В проде также раздаёт статику `frontend/dist`.
  - `pandascore.ts` — клиент PandaScore (CS2 = слаг `csgo` в их API).
  - `ai.ts` — Claude API (`@anthropic-ai/sdk`), модель из env `AI_MODEL`
    (по умолчанию `claude-opus-4-8`), adaptive thinking. Без ключа → мок-анализ.
  - `telegram.ts` — HMAC-проверка `initData` (включается `REQUIRE_TG_AUTH=true`).
  - Готовые анализы сохраняются в `data/analyses/{matchId}.json` — задел под
    метрику «точность прогнозов постфактум».
- **`frontend/`** — React + Vite + TypeScript. Тёмная киберспортивная тема
  (фон #0b0e14, акцент #c4f82a, шрифты Russo One + Manrope — оба с кириллицей).
  Telegram WebApp API подключён через `<script>` в index.html (без npm-SDK).
  Markdown анализа рендерится через `marked`.

## Ключевые правила

- **Ключи только в `.env`** (в корне, gitignored). Никогда не коммитить и не зашивать в код.
- **Демо-режим**: без ключей всё работает на моках (`backend/src/mock-data.ts`) —
  фронт показывает баннер «Демо-данные». Это осознанное поведение, не баг.
- Guardrail в промпте ИИ: никаких советов по ставкам и суммам — не убирать.
- PandaScore free tier: 1000 запросов/час — кэш матчей 60 сек в `cache.ts` обязателен.

## Команды

```bash
cd /d D:\cyberanalytics
npm install          # один раз, ставит оба workspace
npm run dev          # backend :3000 + vite :5173 (открывать http://localhost:5173)
npm run build        # прод-сборка фронтенда в frontend/dist
npm run start        # прод: backend раздаёт API + собранный фронт на :3000
```

## Тест в Telegram (когда дойдём)

Mini App требует HTTPS: локально — туннель `cloudflared tunnel --url http://localhost:3000`
(сначала `npm run build`), полученный URL прописать у @BotFather → Bot Settings → Menu Button /
Mini App. Хостинг для продакшена ещё не выбран.

## Статус (2026-07-02)

MVP-каркас готов и работает в демо-режиме. Ждём от Вилли: токен PandaScore,
ключ Anthropic (или решение в пользу Gemini — тогда добавить провайдера в `ai.ts`),
бот от @BotFather. Betboom-коэффициенты: публичного API нет, пока только ссылка;
вопрос о партнёрском API открыт.
