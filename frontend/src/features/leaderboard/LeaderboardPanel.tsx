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
  // Bars fill toward the win, not toward the current leader — so a full bar means
  // the race is over. The [NN] in the header is the goal everyone is chasing.
  const target = Math.max(1, store.target);

  return (
    <section className="panel">
      <h2>
        Leaderboard <span className="count">{String(store.target).padStart(2, "0")}</span>
      </h2>
      <ul className="ranks">
        {top.map((t, i) => {
          const p = store.playerAt(t.idx);
          if (!p) return null;
          return (
            <li key={t.idx}>
              <span className="rank">{String(i + 1).padStart(2, "0")}</span>
              <span className="who">{p.name}</span>
              <span className="score">{t.score}</span>
              {/* The bar is the fastest read: how close this player is to winning.
                  True colour, full strength, with a soft glow of the same colour so
                  it reads at a glance instead of hiding behind the text. */}
              <span
                className="rank-bar"
                style={{
                  width: `${Math.min(100, (t.score / target) * 100)}%`,
                  background: p.color,
                  boxShadow: `0 0 9px -1px ${p.color}`,
                }}
              />
            </li>
          );
        })}
        {top.length === 0 && <li className="empty">Nobody's claimed a tile yet</li>}
      </ul>
    </section>
  );
}
