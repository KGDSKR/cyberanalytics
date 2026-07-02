import type { Match } from "./types.js";

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

/** Демо-матчи, пока не подключён PandaScore. */
export function mockMatches(): Match[] {
  return [
    {
      id: 900001,
      name: "NAVI vs G2",
      beginAt: hoursFromNow(3),
      league: "IEM",
      serie: "Katowice 2026",
      tournament: "Playoffs",
      bestOf: 3,
      teams: [
        { id: 1, name: "Natus Vincere", acronym: "NAVI", imageUrl: null },
        { id: 2, name: "G2 Esports", acronym: "G2", imageUrl: null },
      ],
    },
    {
      id: 900002,
      name: "Spirit vs FaZe",
      beginAt: hoursFromNow(6),
      league: "BLAST Premier",
      serie: "Spring Finals",
      tournament: "Group A",
      bestOf: 3,
      teams: [
        { id: 3, name: "Team Spirit", acronym: "SPIRIT", imageUrl: null },
        { id: 4, name: "FaZe Clan", acronym: "FAZE", imageUrl: null },
      ],
    },
    {
      id: 900003,
      name: "Vitality vs MOUZ",
      beginAt: hoursFromNow(27),
      league: "ESL Pro League",
      serie: "Season 23",
      tournament: "Round of 16",
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
  return `> ⚠️ **Демо-режим.** Это пример анализа: ключи PandaScore и Claude API ещё не подключены. После подключения здесь будет настоящий ИИ-анализ на актуальной статистике.

## 🎯 Прогноз победы

| Команда | Вероятность |
|---|---|
| **${a.name}** | **58%** |
| **${b.name}** | **42%** |

## 📈 Форма команд

**${a.name}** выиграли 7 из последних 10 карт. Уверенно смотрятся на Mirage и Ancient, провалили последнюю игру на Nuke.

**${b.name}** нестабильны: чередуют яркие победы с осечками против андердогов. 5 побед в 10 последних матчах.

## ⭐ Ключевые игроки

- **${a.acronym ?? a.name}**: снайпер в отличной форме — рейтинг 1.25 за последний месяц.
- **${b.acronym ?? b.name}**: капитан тащит клатчи, но энтри-фрагер просел (0.98).

## 🔄 Личные встречи

За последний год команды сыграли 4 раза: 3–1 в пользу ${a.name}. Последняя встреча закончилась 2:1 на мейджоре.

## ⚡ Факторы риска

- У ${b.name} недавно сменился тренер — возможны нестандартные пики карт.
- ${a.name} играют второй матч за день — усталость может сказаться в третьей карте.

## 👀 На что смотреть

Пистолетные раунды: ${a.name} выигрывают 68% пистолеток — если тренд сохранится, они заберут ранний темп. Следите за пиком карт: Nuke — единственная карта, где ${b.name} явные фавориты.`;
}
