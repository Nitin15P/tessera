import { useEffect, useRef } from "react";
import { Renderer } from "./renderer/Renderer";
import { store } from "../../state/store";
import { claim, requestChallenge, sendCursor } from "../../net/socket";

/**
 * The canvas mount, and the only place DOM events become game intent.
 *
 * This component renders exactly once. Everything visible inside the canvas is
 * driven by the Renderer's own rAF loop reading the store — React is not in the
 * paint path at all, which is the point of choosing canvas.
 *
 * Accessibility, stated plainly rather than quietly skipped: a canvas is opaque
 * to screen readers. The board is unusable without sight, and the honest fix is
 * a parallel keyboard/ARIA grid, which is real work this project doesn't do.
 * The label below describes the board's state but not its contents. Known gap,
 * consciously accepted, and the price of the rendering approach.
 */
export function Board() {
  const ref = useRef<HTMLCanvasElement>(null);
  const rend = useRef<Renderer | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const r = new Renderer(canvas);
    rend.current = r;
    r.start();

    // ResizeObserver rather than window.resize: the board is laid out by its
    // container, which can change without the window doing anything.
    const ro = new ResizeObserver(() => r.resize());
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    return () => {
      r.stop();
      ro.disconnect();
      rend.current = null;
    };
  }, []);

  const locate = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = rend.current;
    if (!r) return null;
    const box = e.currentTarget.getBoundingClientRect();
    return { r, px: e.clientX - box.left, py: e.clientY - box.top };
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const hit = locate(e);
    if (!hit) return;
    store.hover = hit.r.cellAt(hit.px, hit.py);
    const [nx, ny] = hit.r.normalize(hit.px, hit.py);
    // Throttled to 20Hz inside sendCursor; pointermove fires far faster.
    if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) sendCursor(nx, ny);
  };

  const onClick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const hit = locate(e);
    if (!hit) return;
    const cell = hit.r.cellAt(hit.px, hit.py);
    if (cell === null) return;

    // The only branch in the whole interaction: free land settles in one round
    // trip, owned land has to be earned.
    if (store.confirmed[cell] === 0) claim(cell);
    else if (store.confirmed[cell] !== store.me?.idx) requestChallenge(cell);
  };

  return (
    <div className="board">
      <canvas
        ref={ref}
        className="board-canvas"
        onPointerMove={onMove}
        onPointerDown={onClick}
        onPointerLeave={() => (store.hover = null)}
        role="img"
        aria-label="Shared tile board. Not readable by screen readers. See README."
      />
    </div>
  );
}
