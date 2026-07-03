import { useEffect, useRef, useState } from "react";
import { getPastDrafts, getPastMatches } from "../api";
import type { Game, PastMatch, PastMapDraft } from "../types";
import { TeamBadge } from "./MatchCard";

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

function fmtDuration(min: number): string {
  if (min <= 0) return "";
  return min >= 60 ? `${Math.floor(min / 60)} ч ${min % 60} мин` : `${min} мин`;
}

function DraftSection({ match }: { match: PastMatch }) {
  const [drafts, setDrafts] = useState<PastMapDraft[] | null | "loading">("loading");

  useEffect(() => {
    getPastDrafts(match)
      .then((r) => setDrafts(r.drafts))
      .catch(() => setDrafts(null));
  }, [match]);

  if (drafts === "loading") {
    return <div className="past-draft__loading">Ищу драфты…</div>;
  }
  if (!drafts || drafts.length === 0) {
    return <div className="past-draft__loading">Драфт не найден в базе OpenDota</div>;
  }
  return (
    <div className="past-draft">
      {drafts.map((d) => (
        <div className="past-draft__map" key={d.map}>
          <div className="past-draft__map-title">
            Карта {d.map} · {fmtDuration(d.durationMin)}
            {d.winnerTeamIndex !== null && (
              <> · ✅ {match.teams[d.winnerTeamIndex]?.acronym ?? match.teams[d.winnerTeamIndex]?.name}</>
            )}
          </div>
          {[0, 1].map((i) => (
            <div className="draft__row" key={i}>
              <span className="draft__team">{match.teams[i]?.acronym ?? match.teams[i]?.name}</span>
              <div className="draft__heroes">
                {d.heroes[i]!.map((h) => (
                  <span className="hero-chip" key={h}>{h}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function PastCard({ match, index }: { match: PastMatch; index: number }) {
  const [showDraft, setShowDraft] = useState(false);
  const [a, b] = match.teams;
  const winnerIdx = match.winnerId === a?.id ? 0 : match.winnerId === b?.id ? 1 : null;

  return (
    <div className="match-card past-card" style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
      <div className="match-card__meta">
        <span className="match-card__league">{match.league}</span>
        <span>{match.beginAt ? dateFmt.format(new Date(match.beginAt)) : ""}</span>
      </div>
      <div className="match-card__teams">
        <div className={winnerIdx === 0 ? "past-winner" : "past-loser"}>
          <TeamBadge {...a} />
        </div>
        <div className="past-score">
          <span className="score">{match.score.replace(":", " : ")}</span>
          {winnerIdx !== null && <span className="past-trophy">🏆 {match.teams[winnerIdx]?.acronym ?? ""}</span>}
        </div>
        <div className={winnerIdx === 1 ? "past-winner" : "past-loser"}>
          <TeamBadge {...b} />
        </div>
      </div>
      <div className="match-card__footer">
        <span>{match.serie || match.tournament}</span>
        {match.totalDurationMin > 0 && <span>⏱ {fmtDuration(match.totalDurationMin)}</span>}
      </div>
      {match.game === "dota2" && (
        <button className="draft-toggle" onClick={() => setShowDraft((v) => !v)}>
          {showDraft ? "Скрыть драфт ▲" : "Показать драфт ▼"}
        </button>
      )}
      {showDraft && <DraftSection match={match} />}
    </div>
  );
}

export default function PastMatches() {
  const [game, setGame] = useState<Game>("cs2");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [league, setLeague] = useState<string | null>(null);
  const [matches, setMatches] = useState<PastMatch[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  // Поиск с задержкой, чтобы не дёргать API на каждую букву
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 500);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    getPastMatches(game, 1, debouncedQ)
      .then((r) => {
        if (seq !== requestSeq.current) return;
        setMatches(r.matches);
        setPage(1);
        setHasMore(r.matches.length >= 50);
      })
      .catch((e) => {
        if (seq !== requestSeq.current) return;
        setError(e instanceof Error ? e.message : "Ошибка загрузки");
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [game, debouncedQ]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const r = await getPastMatches(game, page + 1, debouncedQ);
      setMatches((prev) => [...prev, ...r.matches]);
      setPage((p) => p + 1);
      setHasMore(r.matches.length >= 50);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }

  // Топ турниров из загруженных матчей (по числу матчей)
  const leagueCounts = new Map<string, number>();
  for (const m of matches) {
    if (m.league) leagueCounts.set(m.league, (leagueCounts.get(m.league) ?? 0) + 1);
  }
  const topLeagues = [...leagueCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const visible = league ? matches.filter((m) => m.league === league) : matches;

  return (
    <div>
      <div className="tabs">
        {(["cs2", "dota2"] as Game[]).map((g) => (
          <button
            key={g}
            className={`tab${game === g ? " tab--active" : ""}`}
            onClick={() => { setGame(g); setLeague(null); }}
          >
            {g === "cs2" ? "CS2" : "Dota 2"}
          </button>
        ))}
      </div>

      <input
        className="search"
        type="search"
        placeholder="Поиск по командам…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {!loading && topLeagues.length > 1 && (
        <div className="league-chips">
          <button
            className={`league-chip${league === null ? " league-chip--active" : ""}`}
            onClick={() => setLeague(null)}
          >
            Все турниры
          </button>
          {topLeagues.map(([name, count]) => (
            <button
              key={name}
              className={`league-chip${league === name ? " league-chip--active" : ""}`}
              onClick={() => setLeague(league === name ? null : name)}
            >
              {name} <span className="league-chip__count">{count}</span>
            </button>
          ))}
        </div>
      )}

      {loading && <div className="loader"><div className="loader__ring" /></div>}
      {error && <div className="error">{error}</div>}

      {!loading && (
        <div className="match-list">
          {visible.map((m, i) => (
            <PastCard key={m.id} match={m} index={i} />
          ))}
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="empty">Ничего не найдено</div>
      )}

      {!loading && hasMore && (
        <button className="load-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Загружаю…" : "Показать ещё"}
        </button>
      )}
    </div>
  );
}
