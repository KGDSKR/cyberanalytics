import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useState } from "react";
import { analyzeMatch, getDraft } from "../api";
import type { LiveDraft, Match } from "../types";
import { TeamBadge } from "./MatchCard";

const LOADING_PHRASES = [
  "Собираю статистику команд…",
  "Сравниваю форму и составы…",
  "Изучаю личные встречи…",
  "Взвешиваю факторы риска…",
  "Формулирую прогноз…",
];

function DraftBlock({ match, draft }: { match: Match; draft: LiveDraft }) {
  const [a, b] = match.teams;
  const gold = draft.goldLead;
  return (
    <div className="draft">
      <div className="draft__meta">
        <span><span className="live-dot" /> {draft.gameTimeMin}-я мин</span>
        <span>Киллы {draft.kills[0]}:{draft.kills[1]}</span>
        {gold !== null && gold !== 0 && (
          <span className="draft__gold">
            +{(Math.abs(gold) / 1000).toFixed(1)}k 🪙 {gold > 0 ? a?.acronym ?? a?.name : b?.acronym ?? b?.name}
          </span>
        )}
      </div>
      {[0, 1].map((i) => (
        <div className="draft__row" key={i}>
          <span className="draft__team">{match.teams[i]?.acronym ?? match.teams[i]?.name}</span>
          <div className="draft__heroes">
            {draft.heroes[i]!.length > 0
              ? draft.heroes[i]!.map((h) => <span className="hero-chip" key={h}>{h}</span>)
              : <span className="draft__pending">драфт идёт…</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AnalysisView({ match, onBack }: { match: Match; onBack: () => void }) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phrase, setPhrase] = useState(0);
  const [draft, setDraft] = useState<LiveDraft | null>(null);

  useEffect(() => {
    if (match.game !== "dota2" || match.status !== "live") return;
    let stopped = false;
    const load = () => getDraft(match.id).then((r) => { if (!stopped) setDraft(r.draft); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { stopped = true; clearInterval(t); };
  }, [match]);

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

      {draft && <DraftBlock match={match} draft={draft} />}

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
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(analysis) as string) }}
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
