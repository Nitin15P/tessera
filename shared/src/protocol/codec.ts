/**
 * Board encoding.
 *
 * The whole 1500-tile board is a Uint16Array of owner indices — 3KB — which
 * base64s to ~4KB and travels as one string inside the snapshot. The alternative
 * (an array of {cell, color} objects) is roughly 50KB of mostly repeated hex.
 *
 * Both runtimes have `btoa`/`atob`: browsers natively, Node since v16. So this
 * file is genuinely shared rather than reimplemented per side, which is the
 * point — an encoder and decoder that can disagree is a decoder that will.
 */

export function encodeGrid(grid: Uint16Array): string {
  const bytes = new Uint8Array(grid.buffer, grid.byteOffset, grid.byteLength);
  let bin = "";
  // Chunked: String.fromCharCode(...xs) blows the argument limit on large inputs,
  // and this is meant to keep working if the board grows.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function decodeGrid(b64: string): Uint16Array<ArrayBuffer> {
  const bin = atob(b64);
  // Allocate the ArrayBuffer up front rather than borrowing one from a view: it
  // keeps the buffer type concrete (not ArrayBufferLike), so the decoded grid is
  // assignable wherever a plain Uint16Array is expected.
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Uint16Array(buf);
}
