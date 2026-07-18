import { store } from "../state/store";
import { useStore } from "./useStore";
import { Sidebar } from "./Sidebar";
import { Board } from "../features/board/Board";
import { ChallengeOverlay } from "../features/challenge/ChallengeOverlay";
import { StatusPill } from "../features/status/StatusPill";
import { ChargePips } from "../features/status/ChargePips";
import { Toasts } from "../features/status/Toasts";

/** Layout and composition. No data logic — every panel owns its own. */
export function App() {
  useStore();
  const me = store.me;

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">
          <span className="mark" aria-hidden />
          <h1>Tessera</h1>
          <p className="tag">claim / steal / hold — live, shared</p>
        </div>

        <div className="bar-right">
          {me && (
            <div className="me">
              <span className="swatch" style={{ background: me.color }} />
              <span className="me-name">{me.name}</span>
              <ChargePips />
            </div>
          )}
          <StatusPill />
        </div>
      </header>

      <main className="main">
        <Board />
        <Sidebar />
      </main>

      <ChallengeOverlay />
      <Toasts />
    </div>
  );
}
