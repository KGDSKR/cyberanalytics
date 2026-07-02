import { marked } from "marked";
import { useEffect, useState } from "react";
import { analyzeMatch } from "../api";
import type { Match } from "../types";
import { TeamBadge } from "./MatchCard";

const LOADING_PHRASES = [
  "Собираю статистику команд…",
  "Сравниваю форму и составы…",
  "Изучаю личные встречи…",
  "Взвешиваю факторы риска…",
  "Формулирую прогноз…",
];

export default function AnalysisView({ match, onBack }: { match: Match; onBack: () => void }) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phrase, setPhrase] = useState(0);

  useEffect(() => {
    const bb = window.Telegram?.WebApp?.BackButton;
    bb?.show();
    bb?.onClick(onBack);
    return () => {
      bb?.offClick(onBack);
      bb?.hide();
    };
  }, [onBack]);

  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setPhrase((p) => (p + 1) % LOADING_PHRASES.length), 2500);
    return () => clearInterval(t);
  }, [loading]);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await analyzeMatch(match.id);
      setAnalysis(res.analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось получить анализ");
    } finally {
      setLoading(false);
    }
  }

  const [a, b] = match.teams;

  return (
    <div className="analysis">
      <button className="back-btn" onClick={onBack}>← Матчи</button>

      <div className="analysis__header">
        <div className="analysis__teams">
          <TeamBadge {...a} />
          <span className="vs vs--big">VS</span>
          <TeamBadge {...b} />
        </div>
        <div className="analysis__league">{match.league} · {match.serie || match.tournament}</div>
      </div>

      {!analysis && !loading && (
        <div className="analysis__cta">
          <button className="primary-btn" onClick={run} disabled={loading}>
            ⚡ Сгенерировать ИИ-анализ
          </button>
          {error && <div className="error">{error}</div>}
        </div>
      )}

      {loading && (
        <div className="loader">
          <div className="loader__ring" />
          <div className="loader__text">{LOADING_PHRASES[phrase]}</div>
          <div className="loader__hint">Глубокий анализ занимает до минуты</div>
        </div>
      )}

      {analysis && (
        <>
          <article
            className="analysis__body"
            dangerouslySetInnerHTML={{ __html: marked.parse(analysis) as string }}
          />
          <a
            className="betboom-btn"
            href="https://betboom.ru/sport/esports"
            target="_blank"
            rel="noreferrer"
          >
            Коэффициенты на Betboom ↗
          </a>
          <div className="disclaimer">
            Анализ сгенерирован ИИ и не является финансовой рекомендацией. 18+
          </div>
        </>
      )}
    </div>
  );
}
