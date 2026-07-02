import { useEffect, useState } from "react";
import { getMatches } from "./api";
import AnalysisView from "./components/AnalysisView";
import MatchCard from "./components/MatchCard";
import type { Match } from "./types";

export default function App() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Match | null>(null);

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

  return (
    <div className="app">
      <header className="header">
        <div className="header__logo">
          CYBER<span className="header__slash">//</span>ANALYTICS
        </div>
        <div className="header__badge">AI</div>
      </header>
      <p className="header__tagline">ИИ-аналитика матчей CS2</p>

      {demo && <div className="demo-banner">Демо-данные — API ещё не подключён</div>}
      {loading && <div className="loader"><div className="loader__ring" /></div>}
      {error && <div className="error">{error}</div>}

      <div className="match-list">
        {matches.map((m, i) => (
          <MatchCard key={m.id} match={m} index={i} onClick={() => setSelected(m)} />
        ))}
      </div>

      {!loading && !error && matches.length === 0 && (
        <div className="empty">Ближайших матчей не найдено</div>
      )}
    </div>
  );
}
