import { store } from "../../../../state/store";
import type { Viewport } from "../geometry";

/**
 * Other people.
 *
 * Positions arrive at 20Hz; drawing them raw looks like a slideshow. Each cursor
 * chases its target with an exponential ease, so 20 updates a second become 60
 * frames of smooth movement.
 *
 * This is the cheapest thing in the app and the first thing anyone notices — it
 * is what makes the board feel inhabited rather than merely shared. Worth its own
 * layer for that reason alone: it's the only part of the render that is about
 * people rather than state.
 */
export class CursorLayer {
  constructor(private vp: Viewport) {}

  private lastFrame = 0;

  /** Call with an untranslated context — cursors are positioned in canvas space. */
  draw(ctx: CanvasRenderingContext2D, now: number): void {
    ctx.font = "500 10px 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";
    ctx.textBaseline = "middle";

    // Genuinely frame-rate independent: the smoothing is a function of elapsed
    // time, not frame count, so the glide looks the same at 60fps and 30. The
    // exponential reaches ~63% of the remaining gap every `tau` ms. tau=70 gives
    // a soft ~150ms catch-up to each 20Hz update — a glide, not a snap. (The old
    // constant worked out to ~87%/frame, which snapped.)
    const dt = this.lastFrame ? Math.min(now - this.lastFrame, 100) : 16;
    this.lastFrame = now;
    const alpha = 1 - Math.exp(-dt / 70);

    for (const [idx, c] of store.cursors) {
      if (idx === store.me?.idx) continue;

      const player = store.playerAt(idx);
      if (!player) continue;

      c.x += (c.tx - c.x) * alpha;
      c.y += (c.ty - c.y) * alpha;

      const px = this.vp.ox + c.x * this.vp.boardW;
      const py = this.vp.oy + c.y * this.vp.boardH;

      this.drawArrow(ctx, px, py, player.color);
      this.drawLabel(ctx, px, py, player.name, player.color);
    }
  }

  private drawArrow(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    color: string,
  ): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, py + 12);
    ctx.lineTo(px + 3.5, py + 8.8);
    ctx.lineTo(px + 8, py + 8.4);
    ctx.closePath();
    ctx.fill();
  }

  private drawLabel(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    name: string,
    color: string,
  ): void {
    const w = ctx.measureText(name).width;

    // A hard-edged tag, no rounding — same language as the tiles.
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = color;
    ctx.fillRect(px + 9, py + 9, w + 10, 15);
    ctx.globalAlpha = 1;

    // Dark ink on the player's colour: the muted palette stays light enough that
    // near-black reads on every one of the sixteen, which white would not.
    ctx.fillStyle = "#141414";
    ctx.fillText(name, px + 14, py + 17);
  }
}
