import { GRID_H, GRID_W } from "@tessera/shared/protocol";

/**
 * Board geometry: the one place that knows how a tile index becomes pixels.
 *
 * Extracted because four separate draw routines were each doing
 * `(cell % GRID_W) * this.cell` inline. That's fine until one of them is wrong,
 * and then it's a bug you find by squinting at a screenshot. Now the mapping
 * exists once and every layer asks the same object.
 */
export class Viewport {
  /** Tile size in CSS pixels, snapped to whole pixels so edges stay crisp. */
  cell = 0;
  /** Board origin within the canvas (it's centred). */
  ox = 0;
  oy = 0;
  boardW = 0;
  boardH = 0;
  /** Capped at 2 — beyond that the extra pixels are invisible and the fill cost
   *  is real. */
  dpr = 1;
  width = 0;
  height = 0;

  /**
   * Measure the *content* box, not the border box. The canvas is laid out inside
   * the parent's padding, so measuring the outer box sizes the board to space it
   * isn't allowed to occupy and pushes it off the bottom of the screen.
   */
  measure(parent: HTMLElement): void {
    const cs = getComputedStyle(parent);
    this.width =
      parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    this.height =
      parent.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cell = Math.max(4, Math.floor(Math.min(this.width / GRID_W, this.height / GRID_H)));
    this.boardW = this.cell * GRID_W;
    this.boardH = this.cell * GRID_H;
    this.ox = Math.floor((this.width - this.boardW) / 2);
    this.oy = Math.floor((this.height - this.boardH) / 2);
  }

  /** Top-left of a tile, in board-local pixels. */
  originOf(cell: number): [x: number, y: number] {
    return [(cell % GRID_W) * this.cell, Math.floor(cell / GRID_W) * this.cell];
  }

  centerOf(cell: number): [x: number, y: number] {
    const [x, y] = this.originOf(cell);
    return [x + this.cell / 2, y + this.cell / 2];
  }

  /** Pointer position (CSS px, canvas-relative) -> tile index, or null. */
  cellAt(px: number, py: number): number | null {
    const x = Math.floor((px - this.ox) / this.cell);
    const y = Math.floor((py - this.oy) / this.cell);
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return null;
    return y * GRID_W + x;
  }

  /** Board-normalised (0..1), so a cursor lands in the same place on a laptop
   *  and a 4K monitor. */
  normalize(px: number, py: number): [number, number] {
    return [(px - this.ox) / this.boardW, (py - this.oy) / this.boardH];
  }
}
