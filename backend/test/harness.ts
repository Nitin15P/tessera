import WebSocket from "ws";
import { decodeGrid, type ServerMsg } from "@tessera/shared/protocol";

/**
 * Shared test rig.
 *
 * All three tests drive the app the way a real client does — over a socket, with
 * no access to internals. That's deliberate: a test that reached into the module
 * graph could pass while the actual wire behaviour was broken, and the wire is
 * the thing being claimed.
 */

export const WS_URL = process.env["TEST_WS"] ?? "ws://localhost:8080/ws";
export const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";

export const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
export const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ClaimReply {
  ok: boolean;
  cell: number;
  reason?: string;
  /** The server's bucket count, piggybacked on every reply. */
  charges?: number;
}

export interface Challenge {
  cell: number;
  /** Tray index of the odd one out, computed from the tray the server sent. */
  answer: number;
}

export interface Rig {
  ws: WebSocket;
  /** This socket's player index, from `welcome`. */
  idx: number;
  replies: ClaimReply[];
  /** cell -> owner, as this client currently believes. The convergence check. */
  view: Map<number, number>;
  /** The most recent challenge tray, already solved. */
  challenge: Challenge | null;
  close(): void;
}

/**
 * Solve an odd-one-out tray the way a client (or a bot) would: the answer never
 * came over the wire, so find the shape whose look is unique. This is also the
 * honest demonstration that the puzzle is not cheat-proof — the cooldown/bucket
 * is the real backstop, not the tray.
 */
export function solveTray(tray: { type: string; hue: number; rot: number }[]): number {
  const sig = (s: { type: string; hue: number; rot: number }) => `${s.type}|${s.hue}|${s.rot}`;
  const counts = new Map<string, number>();
  for (const s of tray) counts.set(sig(s), (counts.get(sig(s)) ?? 0) + 1);
  return tray.findIndex((s) => counts.get(sig(s)) === 1);
}

/**
 * Connect and resolve once the snapshot lands.
 *
 * No token is sent, so every rig is a brand-new player — which matters: if they
 * shared an identity, one player's cooldown would mask another's rejection and
 * make a broken result look correct.
 */
export function connect(url = WS_URL): Promise<Rig> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const rig: Rig = {
      ws,
      idx: 0,
      replies: [],
      view: new Map(),
      challenge: null,
      close: () => ws.close(),
    };

    const timeout = setTimeout(() => reject(new Error(`connect timeout: ${url}`)), 8000);

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMsg;

      switch (msg.t) {
        case "welcome":
          rig.idx = msg.you.idx;
          break;
        case "snapshot": {
          // Track the board from snapshots too, exactly as the real client does
          // (it decodes the grid into its board). This matters after a reset,
          // when the server re-syncs everyone with a fresh snapshot rather than
          // a patch — a harness that only watched patches would miss it and
          // wrongly report divergence.
          rig.view.clear();
          const grid = decodeGrid(msg.grid);
          for (let i = 0; i < grid.length; i++) {
            if (grid[i] !== 0) rig.view.set(i, grid[i]!);
          }
          clearTimeout(timeout);
          resolve(rig);
          break;
        }
        case "claimResult":
          rig.replies.push({
            ok: msg.ok,
            cell: msg.cell,
            ...(msg.reason ? { reason: msg.reason } : {}),
            ...(typeof msg.charges === "number" ? { charges: msg.charges } : {}),
          });
          break;
        case "patch":
          for (const [cell, owner] of msg.cells) rig.view.set(cell, owner);
          break;
        case "challenge":
          rig.challenge = { cell: msg.cell, answer: solveTray(msg.tray) };
          break;
      }
    });

    ws.on("error", reject);
  });
}

export const send = (rig: Rig, msg: unknown): void => rig.ws.send(JSON.stringify(msg));

/** Prints a checklist and exits non-zero if anything failed. */
export function report(checks: [label: string, pass: boolean][]): never {
  console.log("");
  let failed = 0;
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? green("PASS") : red("FAIL")}  ${label}`);
    if (!pass) failed++;
  }
  console.log(failed ? red(`\n  ${failed} check(s) failed\n`) : green("\n  all checks passed\n"));
  process.exit(failed ? 1 : 0);
}
