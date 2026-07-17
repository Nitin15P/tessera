import { store } from "../../state/store";
import { useStore } from "../../app/useStore";

/**
 * Who's here.
 *
 * Reads the server's list rather than deriving one from cursors: someone who
 * hasn't moved their mouse is still in the room, and a presence list that only
 * knows about movement would quietly lose them.
 */
export function PresencePanel() {
  useStore();

  const online = store.online
    .map((idx) => store.playerAt(idx))
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return (
    <section className="panel">
      <h2>
        Online <span className="count">{online.length}</span>
      </h2>
      <ul className="people">
        {online.map((p) => (
          <li key={p.idx} className={p.idx === store.me?.idx ? "is-me" : ""}>
            <span className="dot" style={{ background: p.color }} />
            <span className="who">{p.name}</span>
            {p.idx === store.me?.idx && <span className="you">you</span>}
          </li>
        ))}
        {online.length === 0 && <li className="empty">Just you so far</li>}
      </ul>
    </section>
  );
}
