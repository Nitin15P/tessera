import { store } from "../../state/store";
import { useStore } from "../../app/useStore";

const LABEL = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
} as const;

/**
 * Connection state, always visible.
 *
 * In an app whose entire premise is "you are seeing what everyone else sees",
 * the single most important thing to be honest about is when you aren't. A
 * silently dead socket showing a frozen board is the worst outcome available, so
 * this never hides.
 */
export function StatusPill() {
  useStore();
  return (
    <span className={`pill pill-${store.status}`}>
      <i className="led" />
      {LABEL[store.status]}
    </span>
  );
}
