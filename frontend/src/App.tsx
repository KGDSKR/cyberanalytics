import { useEffect, useState } from "react";
import { getMatches } from "./api";
import AnalysisView from "./components/AnalysisView";
import MatchCard from "./components/MatchCard";
import PastMatches from "./components/PastMatches";
import type { Game, Match } from "./types";

type Tab = "all" | Game;
type View = "current" | "past";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "cs2", label: "CS2" },
  { id: "dota2", label: "Dota 2" },
];

export default function App() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Match | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [view, setView] = useState<View>("current");

  useEffect(() => {
    getMatches()
      .then((res) => {
        setMatches(res.matches);
        setDemo(res.demo);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, []);

  if (selected) {
    return <AnalysisView match={selected} onBack={() => setSelected(null)} />;
  }

  const filtered = tab === "all" ? matches : matches.filter((m) => m.game === tab);
  const liveMatches = filtered.filter((m) => m.status === "live");
  const upcoming = filtered.filter((m) => m.status === "upcoming");

  return (
    <div className="app">
      <header className="header">
        <div className="header__logo">
          CYBER<span className="header__slash">//</span>ANALYTICS
        </div>
        <div className="header__badge">AI</div>
      </header>
      <p className="header__tagline">ИИ-аналитика матчей CS2 и Dota 2</p>

      <div className="view-switch">
        <button
          className={`view-switch__btn${view === "current" ? " view-switch__btn--active" : ""}`}
          onClick={() => setView("current")}
        >
          Матчи
        </button>
        <button
          className={`view-switch__btn${view === "past" ? " view-switch__btn--active" : ""}`}
          onClick={() => setView("past")}
        >
          Прошедшие
        </button>
      </div>

      {view === "past" ? (
        <PastMatches />
      ) : (
      <>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? " tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {demo && <div className="demo-banner">Демо-данные — API ещё не подключён</div>}
      {loading && <div className="loader"><div className="loader__ring" /></div>}
      {error && <div className="error">{error}</div>}

      {liveMatches.length > 0 && (
        <>
          <div className="section-label section-label--live">Идут сейчас</div>
          <div className="match-list">
            {liveMatches.map((m, i) => (
              <MatchCard key={m.id} match={m} index={i} onClick={() => setSelected(m)} />
            ))}
          </div>
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <div className="section-label">Предстоящие</div>
          <div className="match-list">
            {upcoming.map((m, i) => (
              <MatchCard key={m.id} match={m} index={i} onClick={() => setSelected(m)} />
            ))}
          </div>
        </>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="empty">Матчей не найдено</div>
      )}
      </>
      )}
    </div>
  );
}
