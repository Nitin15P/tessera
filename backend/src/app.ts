import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { TARGET_TO_WIN } from "@tessera/shared/protocol";
import { env } from "./config/env";
import { health, serveStatic } from "./http";
import { open, heartbeat, ticker, broadcaster, control } from "./realtime";
import { boardRepo, closeRedis, leaderboardRepo } from "./db/redis";
import { closePostgres, isEnabled, migrate } from "./db/postgres";
import * as board from "./services/board.service";
import * as players from "./services/player.service";
import * as eventLog from "./services/eventLog.service";
import * as bot from "./services/bot.service";

/**
 * Wiring.
 *
 * Separate from main.ts so the composition can be started and stopped by a test
 * without a process boundary, and so the bootstrap sequence is readable in one
 * screen rather than inferred from import side effects.
 */

export interface App {
  server: Server;
  wss: WebSocketServer;
  shutdown: (reason: string) => Promise<void>;
}

export async function start(): Promise<App> {
  // Order is load-bearing.
  if (isEnabled()) {
    // Schema before anything writes. Fatal on failure: a schema we can't reason
    // about is worse than not starting.
    await migrate();
    // Realign the index allocator with history before a single player can be
    // minted with an index history already refers to.
    await players.reconcileIdxAllocator();
  }

  await players.warm();
  // Wire the reset-resync hook before hydrating, so a re-hydrate can re-sync
  // clients. (Kept as a callback to avoid a circular import between the board
  // service and the broadcaster.)
  board.setResyncHandler(() => broadcaster.resyncAll());
  // The board must hydrate before the first socket is accepted.
  await board.hydrate("initial");
  // Listen for game events (a race won, the board reset) on the control channel,
  // so this instance turns them into client messages. After hydrate, so the
  // subscriber connection is live.
  await control.start();

  // Self-heal a wedged race. A proper win zeroes the board the instant a score
  // reaches the target, so no leaderboard score should ever sit at or above it at
  // boot. If one does, an older build won a race but never reset it (it required
  // landing on *exactly* the target and so could stick above it) — clear it, or the
  // board stays frozen forever. The `>=` win check keeps this from recurring; this
  // mops up state left by a build that predated the fix. Cheap: one ZSet read.
  const [leader] = await leaderboardRepo.top(1);
  if (leader && leader.score >= TARGET_TO_WIN) {
    console.warn(
      `[boot] leaderboard wedged (top score ${leader.score} >= target ${TARGET_TO_WIN}) — resetting`,
    );
    await boardRepo.resetGame();
    await board.hydrate("reset");
  }

  // The resident bot shows as online only while it is actually playing; presence
  // pulls that through this provider so it never has to import the bot directly.
  broadcaster.setBotPresence(() => bot.presenceIdx());
  // Start the bot last: it needs identity, the board mirror, and the control
  // channel all live before it takes its first turn.
  await bot.start();

  eventLog.start();
  ticker.start();

  const server = createServer((req, res) => {
    if (req.url === "/healthz") return health(res);
    serveStatic(req, res);
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  const stopHeartbeat = heartbeat.start(wss);

  wss.on("connection", (ws, req) => {
    void open(ws, req).catch((err) => {
      console.error("[ws] handshake failed:", err);
      ws.close(1011, "internal error");
    });
  });

  const shutdown = async (reason: string): Promise<void> => {
    console.log(`[boot] ${reason} — draining`);
    stopHeartbeat();
    await bot.stop();
    ticker.stop();
    // 1001 "going away" tells clients this is expected, so they reconnect with
    // backoff rather than treating it as an error.
    for (const ws of wss.clients) ws.close(1001, "server restarting");
    server.close();
    await eventLog.stop();
    await closePostgres();
    await closeRedis();
  };

  await new Promise<void>((resolve) => server.listen(env.port, resolve));

  console.log(`[boot] tessera on :${env.port} (ws at /ws)`);
  console.log(`[boot] durable log: ${isEnabled() ? "on" : "off"}`);

  return { server, wss, shutdown };
}
