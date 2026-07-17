import { store } from "../../../../state/store";
import type { Viewport } from "../geometry";
import type { CellChange } from "./BoardLayer";

const GAP = 1;
const RADIUS = 2;
const RIPPLE_LIFE = 420;
const STAMP_LIFE = 200;

interface Effect {
  cell: number;
  born: number;
  color: string;
}

/**
 * Everything drawn *over* the settled board: our own guesses, the claim effects,
 * and the hover affordance.
 *
 * Grouped together because they share one property — none of them are truth.
 * They are what this browser is hoping, animating, or pointing at. The board
 * underneath is the server's word; everything in this file is ours.
 */
export class OverlayLayer {
  private ripples: Effect[] = [];
  private stamps: Effect[] = [];

  constructor(private vp: Viewport) {}

  /**
   * A tile changing hands gets two effects: a "stamp" (the tile punches in
   * slightly oversized and settles to exactly the base, so the handoff to the
   * cached board layer is seamless) and an expanding ripple. Together they make
   * a claim feel like it *lands* rather than just appearing.
   */
  spawnClaimEffects(changes: CellChange[], now: number): void {
    for (const c of changes) {
      this.ripples.push({ cell: c.cell, born: now, color: c.color });
      this.stamps.push({ cell: c.cell, born: now, color: c.color });
    }
  }

  /** Call inside a context already translated to the board origin. */
  draw(ctx: CanvasRenderingContext2D, now: number): void {
    this.drawStamps(ctx, now);
    this.drawPending(ctx, now);
    this.drawRipples(ctx, now);
    this.drawHover(ctx, now);
  }

  /**
   * The tile punches in: drawn oversized and settling to 1.0, where it exactly
   * matches the tile the board layer already painted underneath, so it vanishes
   * without a seam. A brief white flash on top of that reads as impact.
   */
  private drawStamps(ctx: CanvasRenderingContext2D, now: number): void {
    if (this.stamps.length === 0) return;
    this.stamps = this.stamps.filter((s) => now - s.born < STAMP_LIFE);

    for (const s of this.stamps) {
      const t = (now - s.born) / STAMP_LIFE;
      const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic — smooth settle, no bounce
      // A restrained punch: 14% oversized settling to exactly 1.0, where it meets
      // the tile the board layer already painted underneath and vanishes without
      // a seam. Subtlety is the Apple part — you feel it more than you see it.
      const scale = 1.14 - 0.14 * ease;

      const [ox, oy] = this.vp.originOf(s.cell);
      const size = this.vp.cell - GAP;
      const cx = ox + size / 2;
      const cy = oy + size / 2;
      const s2 = size * scale;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.roundRect(-s2 / 2, -s2 / 2, s2, s2, Math.min(RADIUS + 1, s2 / 4));
      ctx.fill();
      // A brief soft lift in brightness rather than a white flash — reads as the
      // tile catching light, not a strobe.
      ctx.globalAlpha = (1 - ease) * 0.28;
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Our guesses, painted over the truth.
   *
   * Deliberately translucent and breathing: the UI should look like it is
   * *hoping*, not asserting. If the server disagrees this simply vanishes and
   * the real owner is already underneath — no rollback, no flicker of a wrong
   * value. That is the whole reason confirmed and pending are separate arrays.
   */
  private drawPending(ctx: CanvasRenderingContext2D, now: number): void {
    if (store.pending.size === 0) return;
    const pulse = 0.55 + 0.2 * Math.sin(now / 180);

    for (const [cell, p] of store.pending) {
      const [x, y] = this.vp.originOf(cell);
      const s = this.vp.cell - GAP;

      ctx.globalAlpha = pulse;
      ctx.fillStyle = store.playerAt(p.playerIdx)?.color ?? "#888";
      ctx.beginPath();
      ctx.roundRect(x, y, s, s, Math.min(RADIUS, s / 4));
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private drawRipples(ctx: CanvasRenderingContext2D, now: number): void {
    if (this.ripples.length === 0) return;
    this.ripples = this.ripples.filter((r) => now - r.born < RIPPLE_LIFE);

    for (const r of this.ripples) {
      const t = (now - r.born) / RIPPLE_LIFE;
      const ease = 1 - (1 - t) * (1 - t);
      const [cx, cy] = this.vp.centerOf(r.cell);

      ctx.globalAlpha = (1 - ease) * 0.5;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(1, this.vp.cell * 0.12 * (1 - ease));
      ctx.beginPath();
      ctx.arc(cx, cy, this.vp.cell * (0.4 + ease * 1.6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /**
   * The hover affordance: what a click will do, before you commit to it.
   *
   * Your colour on free land, white on a steal, dimmed when you have no charge
   * to spend. The state that used to need a countdown ring here now lives in the
   * pips — with a bucket there is usually nothing to wait for, so drawing a timer
   * on every hover would be inventing tension the game no longer has.
   */
  private drawHover(ctx: CanvasRenderingContext2D, now: number): void {
    const cell = store.hover;
    if (cell === null) return;

    const [x, y] = this.vp.originOf(cell);
    const s = this.vp.cell - GAP;
    const owned = store.confirmed[cell]! !== 0;
    const empty = !store.canClaim(Date.now());

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = empty
      ? "rgba(255,255,255,0.16)"
      : owned
        ? "rgba(255,255,255,0.85)"
        : (store.me?.color ?? "#fff");
    // Stops breathing when you can't act: a pulsing outline reads as an
    // invitation, and inviting a click that will be refused is a small lie.
    ctx.globalAlpha = empty ? 0.4 : 0.55 + 0.25 * Math.sin(now / 220);
    ctx.beginPath();
    ctx.roundRect(x - 1, y - 1, s + 2, s + 2, Math.min(RADIUS + 1, s / 3));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
