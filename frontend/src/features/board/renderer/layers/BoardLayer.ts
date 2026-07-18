import { CELL_COUNT } from "@tessera/shared/protocol";
import { BOARD_BG, UNCLAIMED_COLOR } from "@tessera/shared/domain";
import { store } from "../../../../state/store";
import type { Viewport } from "../geometry";

const GAP = 1;
const RADIUS = 0; // sharp tiles — the whole design language is hard-edged squares

/** A tile that just changed hands, worth a ripple. */
export interface CellChange {
  cell: number;
  color: string;
}

/**
 * The settled board, cached on an offscreen canvas.
 *
 * Drawn once, then only where tiles change. At 1500 tiles a full repaint every
 * frame would honestly be fine — this is the architecture the app would need at
 * 50,000, and the reason canvas was worth choosing at all. Cost tracks *what
 * changed*, not how big the board is.
 *
 * Changes are found by diffing against a shadow copy rather than by subscribing
 * to the socket. 1500 integer compares per frame is nothing, and it keeps
 * rendering completely decoupled from how state arrives — this layer cannot miss
 * an update, because it never has to be told about one.
 */
export class BoardLayer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private shadow = new Uint16Array(CELL_COUNT);

  constructor(private vp: Viewport) {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { alpha: false })!;
  }

  resize(): void {
    this.canvas.width = Math.floor(this.vp.boardW * this.vp.dpr);
    this.canvas.height = Math.floor(this.vp.boardH * this.vp.dpr);
    this.ctx.setTransform(this.vp.dpr, 0, 0, this.vp.dpr, 0, 0);

    // Geometry changed, so the cache is meaningless. Force a full repaint by
    // making every shadow entry disagree with any possible owner.
    this.shadow.fill(0xffff);
    this.ctx.fillStyle = BOARD_BG;
    this.ctx.fillRect(0, 0, this.vp.boardW, this.vp.boardH);
  }

  colorOf(owner: number): string {
    if (owner === 0) return UNCLAIMED_COLOR;
    return store.playerAt(owner)?.color ?? "#3a3d47";
  }

  /** Repaint changed tiles; report the ones worth celebrating. */
  sync(): CellChange[] {
    const grid = store.confirmed;
    const changes: CellChange[] = [];

    for (let i = 0; i < CELL_COUNT; i++) {
      const owner = grid[i]!;
      if (owner === this.shadow[i]) continue;

      // A repaint forced by a resize isn't a claim and shouldn't ripple.
      if (this.shadow[i] !== 0xffff && owner !== 0) {
        changes.push({ cell: i, color: this.colorOf(owner) });
      }
      this.shadow[i] = owner;
      this.paint(i, owner);
    }
    return changes;
  }

  private paint(cell: number, owner: number): void {
    const [x, y] = this.vp.originOf(cell);
    const s = this.vp.cell - GAP;

    this.ctx.fillStyle = BOARD_BG;
    this.ctx.fillRect(x, y, this.vp.cell, this.vp.cell);

    this.ctx.fillStyle = this.colorOf(owner);
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, s, s, Math.min(RADIUS, s / 4));
    this.ctx.fill();
  }
}
