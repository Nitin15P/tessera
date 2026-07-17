import { CELL_COUNT, GRID_W } from "../protocol/constants";

/**
 * Grid geometry. Pure, total, and shared — the server validates cell indices
 * with the same functions the client uses to produce them, so the two can't
 * develop different opinions about what a valid tile is.
 */

export const cellOf = (x: number, y: number): number => y * GRID_W + x;

export const xOf = (cell: number): number => cell % GRID_W;

export const yOf = (cell: number): number => Math.floor(cell / GRID_W);

/**
 * Guards the wire. `Number.isInteger` matters as much as the range check: JSON
 * will happily deliver 4.5, NaN, or 1e99 as a "cell", and a Uint16Array write at
 * a fractional index fails silently rather than loudly.
 */
export const inBounds = (cell: number): boolean =>
  Number.isInteger(cell) && cell >= 0 && cell < CELL_COUNT;
