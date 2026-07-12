import type { Match } from "./types.js";

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

/** Демо-матчи, пока не подключён PandaScore. */
export function mockMatches(): Match[] {
  return [
    {
      id: 900000,
      name: "Falcons vs Liquid",
      beginAt: hoursFromNow(-1),
      game: "cs2",
      status: "live",
      score: "1:0",
      roundScore: "7:11",
      mapName: "Mirage",
      league: "PGL",
      serie: "Bucharest 2026",
      tournament: "Group B",
      tier: "a",
      prizepool: null,
      bestOf: 3,
      teams: [
        { id: 7, name: "Team Falcons", acronym: "FLCN", imageUrl: null },
        { id: 8, name: "Team Liquid", acronym: "TL", imageUrl: null },
      ],
    },
    {
      id: 900001,
      name: "NAVI vs G2",
      beginAt: hoursFromNow(3),
      game: "cs2",
      status: "upcoming",
      score: null,
      roundScore: null,
      mapName: null,
      league: "IEM",
      serie: "Katowice 2026",
      tournament: "Playoffs",
      tier: "s",
      prizepool: "1,000,000 United States Dollar",
      bestOf: 3,
      teams: [
        { id: 1, name: "Natus Vincere", acronym: "NAVI", imageUrl: null },
        { id: 2, name: "G2 Esports", acronym: "G2", imageUrl: null },
      ],
    },
    {
      id: 900002,
      name: "Spirit vs PARIVISION",
      beginAt: hoursFromNow(6),
      game: "dota2",
      status: "upcoming",
      score: null,
      roundScore: null,
      mapName: null,
      league: "DreamLeague",
      serie: "Season 27",
      tournament: "Group Stage",
      tier: "b",
      prizepool: null,
      bestOf: 3,
      teams: [
        { id: 3, name: "Team Spirit", acronym: "SPIRIT", imageUrl: null },
        { id: 4, name: "PARIVISION", acronym: "PRV", imageUrl: null },
      ],
    },
    {
      id: 900003,
      name: "Vitality vs MOUZ",
      beginAt: hoursFromNow(27),
      game: "cs2",
      status: "upcoming",
      score: null,
      roundScore: null,
      mapName: null,
      league: "ESL Pro League",
      serie: "Season 23",
      tournament: "Round of 16",
      tier: "a",
      prizepool: null,
      bestOf: 3,
      teams: [
        { id: 5, name: "Team Vitality", acronym: "VIT", imageUrl: null },
        { id: 6, name: "MOUZ", acronym: "MOUZ", imageUrl: null },
      ],
    },
  ];
}

export function mockAnalysis(match: Match): string {
  const [a, b] = match.teams;
  return `> ⚠️ **Демо-режим.** Это пример анализа: ключ ИИ ещё не подключён. После подключения здесь будет настоящий ИИ-анализ на актуальной статистике.

## 🎯 Прогноз победы

| Команда | Вероятность |
|---|---|
| **${a.name}** | **58%** |
| **${b.name}** | **42%** |

## 📈 Форма команд

**${a.name}** выиграли 7 из последних 10 карт. Уверенно смотрятся в текущем отрезке сезона, провалили только последнюю игру.

**${b.name}** нестабильны: чередуют яркие победы с осечками против андердогов. 5 побед в 10 последних матчах.

## ⭐ Ключевые игроки

- **${a.acronym ?? a.name}**: лидер команды в отличной форме — рейтинг 1.25 за последний месяц.
- **${b.acronym ?? b.name}**: капитан тащит клатчи, но энтри-фрагер просел (0.98).

## 🔄 Личные встречи

За последний год команды сыграли 4 раза: 3–1 в пользу ${a.name}. Последняя встреча закончилась 2:1.

## ⚡ Факторы риска

- У ${b.name} недавно сменился тренер — возможны нестандартные решения.
- ${a.name} играют второй матч за день — усталость может сказаться в концовке.

## 👀 На что смотреть

Начало матча: ${a.name} отлично открывают игры — если тренд сохранится, они заберут ранний темп. Следите за первыми минутами и стартовыми раундами.

<!--PRED {"team1": 58, "team2": 42}-->`;
}
