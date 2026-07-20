import { store } from "../state/store";
import { useStore } from "./useStore";
import { Sidebar } from "./Sidebar";
import { Board } from "../features/board/Board";
import { ChallengeOverlay } from "../features/challenge/ChallengeOverlay";
import { WinnerOverlay } from "../features/winner/WinnerOverlay";
import { RulesPanel } from "../features/status/RulesPanel";
import { OnboardingModal } from "../features/onboarding/OnboardingModal";
import { Spotlight } from "../features/onboarding/Spotlight";
import { StatusPill } from "../features/status/StatusPill";
import { ChargePips } from "../features/status/ChargePips";
import { Toasts } from "../features/status/Toasts";

/** Layout and composition. No data logic — every panel owns its own. */
export function App() {
  useStore();
  const me = store.me;

  const toggleRules = () => {
    store.rulesOpen = !store.rulesOpen;
    store.bump();
  };
  const closeRules = () => {
    store.rulesOpen = false;
    store.bump();
  };
  const editProfile = () => {
    store.onboarding = true;
    store.bump();
  };

  return (
    <div className="app">
      <header className="bar">
        <div className="bar-left">
          <div className="brand">
            <span className="mark" aria-hidden />
            <h1>Tessera</h1>
            <p className="tag">claim / steal / hold</p>
          </div>

          <div className="hiw">
            <button
              className={"hiw-pill" + (store.rulesOpen ? " is-on" : "")}
              onClick={toggleRules}
              aria-expanded={store.rulesOpen}
            >
              How it works
            </button>
            {store.rulesOpen && (
              <div className="rules-popover" role="dialog" aria-label="How it works">
                <RulesPanel />
              </div>
            )}
          </div>
        </div>

        <div className="bar-right">
          {me && (
            <button className="me" onClick={editProfile} title="Edit your name and colour">
              <span className="swatch" style={{ background: me.color }} />
              <span className="me-name">{me.name}</span>
              <ChargePips />
            </button>
          )}
          <StatusPill />
        </div>
      </header>

      <main className="main">
        <Board />
        <Sidebar />
      </main>

      {store.rulesOpen && <div className="popover-backdrop" onClick={closeRules} />}
      {store.onboarding && <OnboardingModal />}
      {store.spotlight && <Spotlight />}
      <ChallengeOverlay />
      <WinnerOverlay />
      <Toasts />
    </div>
  );
}
