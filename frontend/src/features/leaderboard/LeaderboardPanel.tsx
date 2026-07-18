import { store } from "../../state/store";
import { useStore } from "../../app/useStore";

/**
 * Who's winning.
 *
 * Never computed here. Scores are incremented inside the same atomic script that
 * writes the tile, so the standings cannot drift from the board — if they ever
 * disagreed it would mean the claim itself was broken. This component only draws.
 */
export function LeaderboardPanel() {
  useStore();

  const top = store.top.filter((t) => t.score > 0).slice(0, 8);
  const maxScore = Math.max(1, ...top.map((t) => t.score));

  return (
    <section className="panel">
      <h2>Leaderboard</h2>
      <ul className="ranks">
        {top.map((t, i) => {
          const p = store.playerAt(t.idx);
          if (!p) return null;
          return (
            <li key={t.idx} className={t.idx === store.me?.idx ? "is-me" : ""}>
              <span className="rank">{String(i + 1).padStart(2, "0")}</span>
              <span className="who">{p.name}</span>
              <span className="score">{t.score}</span>
              {/* The bar is the fastest read: shape of the race, not the digits. */}
              <span
                className="bar"
                style={{ width: `${(t.score / maxScore) * 100}%`, background: p.color }}
              />
            </li>
          );
        })}
        {top.length === 0 && <li className="empty">Nobody's claimed a tile yet</li>}
      </ul>
    </section>
  );
}
