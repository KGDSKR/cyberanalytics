import type { Match } from "../types";

const timeFmt = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const prefix = isToday ? "сегодня" : isTomorrow ? "завтра" : dateFmt.format(d);
  return `${prefix}, ${timeFmt.format(d)}`;
}

export function TeamBadge({ name, acronym, imageUrl }: { name: string; acronym: string | null; imageUrl: string | null }) {
  const label = acronym ?? name.slice(0, 4).toUpperCase();
  return (
    <div className="team">
      {imageUrl ? (
        <img className="team-logo" src={imageUrl} alt="" loading="lazy" />
      ) : (
        <div className="team-logo team-logo--placeholder">{label.slice(0, 2)}</div>
      )}
      <span className="team-name">{name}</span>
    </div>
  );
}

export default function MatchCard({ match, index, onClick }: { match: Match; index: number; onClick: () => void }) {
  const [a, b] = match.teams;
  return (
    <button className="match-card" style={{ animationDelay: `${index * 60}ms` }} onClick={onClick}>
      <div className="match-card__meta">
        <span className="match-card__league">{match.league}</span>
        <span className="match-card__time">{whenLabel(match.beginAt)}</span>
      </div>
      <div className="match-card__teams">
        <TeamBadge {...a} />
        <span className="vs">VS</span>
        <TeamBadge {...b} />
      </div>
      <div className="match-card__footer">
        <span>{match.serie || match.tournament}</span>
        {match.bestOf ? <span className="bo-chip">BO{match.bestOf}</span> : null}
      </div>
    </button>
  );
}
