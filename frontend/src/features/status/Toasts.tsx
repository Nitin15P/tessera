import { store } from "../../state/store";
import { useStore } from "../../app/useStore";

/**
 * Rejections, surfaced quietly.
 *
 * Every one of these is the server saying no — losing a race, clicking through a
 * cooldown, missing the odd shape. They're deliberately small and short-lived:
 * being told "someone got there first" is part of playing, not an error to
 * apologise for.
 */
export function Toasts() {
  useStore();
  if (store.toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {store.toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
