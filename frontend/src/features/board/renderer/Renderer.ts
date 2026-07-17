import { BOARD_BG } from "@tessera/shared/domain";
import { store } from "../../../state/store";
import { Viewport } from "./geometry";
import { BoardLayer } from "./layers/BoardLayer";
import { CursorLayer } from "./layers/CursorLayer";
import { OverlayLayer } from "./layers/OverlayLayer";

/**
 * The board, composed.
 *
 * React never touches anything under this directory, and nothing under it
 * touches React. The board can change 20 times a second; reconciling a component
 * tree to repaint pixels React cannot see would be pure waste. The renderer
 * reads the store's arrays on its own rAF loop, and that is the whole
 * integration.
 *
 * This file owns the loop and the compositing order, and nothing else. Each
 * layer owns one idea:
 *
 *   BoardLayer    the settled truth, cached, repainted only where it changed
 *   OverlayLayer  guesses, ripples, hover — everything that isn't truth
 *   CursorLayer   other people
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private vp = new Viewport();
  private board: BoardLayer;
  private overlay: OverlayLayer;
  private cursors: CursorLayer;
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.board = new BoardLayer(this.vp);
    this.overlay = new OverlayLayer(this.vp);
    this.cursors = new CursorLayer(this.vp);
    this.resize();
  }

  start(): void {
    const loop = () => {
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    this.vp.measure(parent);

    this.canvas.width = Math.floor(this.vp.width * this.vp.dpr);
    this.canvas.height = Math.floor(this.vp.height * this.vp.dpr);
    this.canvas.style.width = `${this.vp.width}px`;
    this.canvas.style.height = `${this.vp.height}px`;
    this.ctx.setTransform(this.vp.dpr, 0, 0, this.vp.dpr, 0, 0);

    this.board.resize();
  }

  /** Pointer -> tile, for the component that owns the DOM events. */
  cellAt(px: number, py: number): number | null {
    return this.vp.cellAt(px, py);
  }

  normalize(px: number, py: number): [number, number] {
    return this.vp.normalize(px, py);
  }

  private frame(): void {
    const now = performance.now();

    // Guesses expire on a timer as well as on reply — a *reply* can be lost even
    // though a patch can't, and a stranded pending tile would be exactly the
    // divergence the server works so hard to prevent.
    store.sweepPending();

    const changes = this.board.sync();
    this.overlay.spawnClaimEffects(changes, now);

    const { ctx, vp } = this;
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(0, 0, vp.width, vp.height);
    ctx.drawImage(this.board.canvas, vp.ox, vp.oy, vp.boardW, vp.boardH);

    // Overlay draws in board-local space; cursors draw in canvas space.
    ctx.save();
    ctx.translate(vp.ox, vp.oy);
    this.overlay.draw(ctx, now);
    ctx.restore();

    this.cursors.draw(ctx, now);
  }
}
