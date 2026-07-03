import { useEffect, useState } from "react";
import { getAccuracy } from "../api";
import type { AccuracyResponse } from "../types";
import { GAME_LABEL } from "./MatchCard";

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

const STATUS_LABEL: Record<string, { icon: string; text: string; cls: string }> = {
  correct: { icon: "✅", text: "сбылся", cls: "acc-row--correct" },
  wrong: { icon: "❌", text: "не сбылся", cls: "acc-row--wrong" },
  pending: { icon: "⏳", text: "матч не завершён", cls: "" },
  canceled: { icon: "🚫", text: "матч отменён", cls: "" },
};

export default function AccuracyView() {
  const [data, setData] = useState<AccuracyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAccuracy()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="loader"><div className="loader__ring" /></div>;

  const { summary, items } = data;

  return (
    <div>
      <div className="acc-summary">
        <div className="acc-summary__big">
          {summary.accuracy !== null ? `${summary.accuracy}%` : "—"}
        </div>
        <div className="acc-summary__caption">точность прогнозов</div>
        <div className="acc-summary__details">
          {summary.decided > 0
            ? `верных ${summary.correct} из ${summary.decided} завершённых · всего прогнозов: ${summary.total}`
            : summary.total > 0
              ? `прогнозов: ${summary.total} — все ждут завершения матчей`
              : "прогнозов пока нет — сгенерируй анализ любого матча"}
        </div>
      </div>

      <div className="match-list">
        {items.map((it) => {
          const s = STATUS_LABEL[it.status]!;
          return (
            <div className={`match-card acc-row ${s.cls}`} key={it.matchId}>
              <div className="match-card__meta">
                <span className="match-card__league">
                  <span className="game-chip">{GAME_LABEL[it.game]}</span>
                  {it.teams.join(" vs ")}
                </span>
                <span>{dateFmt.format(new Date(it.createdAt))}</span>
              </div>
              <div className="acc-row__body">
                <div>
                  Прогноз: <b>{it.pickedName}</b> ({it.pickedProb}%)
                  {it.statusAtPrediction === "live" && (
                    <span className="acc-row__note"> · дан в live при {it.scoreAtPrediction}</span>
                  )}
                </div>
                <div className="acc-row__result">
                  {s.icon}{" "}
                  {it.status === "correct" || it.status === "wrong"
                    ? `${it.finalScore} — победил ${it.winnerName ?? "?"}`
                    : s.text}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
