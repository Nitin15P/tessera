import { useEffect, useState } from "react";
import { store } from "../../state/store";

/**
 * The one guided moment: after picking a name, dim the page and spotlight the
 * "How it works" pill so a first-time player knows where the rules are, then open
 * them on dismiss.
 *
 * The dimming is a single element sized to the pill with an enormous spread
 * box-shadow — everything outside the element darkens, the element itself stays a
 * clear "hole". Mounted only while `store.spotlight` is true; it reads the pill's
 * live position on mount (and on resize) so the hole tracks it.
 */
export function Spotlight() {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = document.querySelector(".hiw-pill");
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const dismiss = () => {
    store.spotlight = false;
    store.rulesOpen = true; // reveal the rules they were just pointed at
    store.bump();
  };

  if (!rect) return null;

  const pad = 7;

  return (
    <div className="spotlight" onClick={dismiss}>
      <div
        className="spotlight-hole"
        style={{
          left: rect.left - pad,
          top: rect.top - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
        }}
      />
      <div className="spotlight-caption" style={{ top: rect.bottom + 16, right: 16 }}>
        <p className="spotlight-text">New here? The rules live here.</p>
        <button type="button" className="spotlight-got">
          Got it
        </button>
      </div>
    </div>
  );
}
