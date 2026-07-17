import { start } from "./app";

/**
 * The process boundary, and nothing else.
 *
 * Everything interesting is in app.ts. This exists to own the things that are
 * genuinely about being a process: signals, and dying loudly when boot fails.
 */
const app = await start();

const stop = (signal: string) => {
  void app
    .shutdown(signal)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[boot] unclean shutdown:", err);
      process.exit(1);
    });
};

// SIGTERM is what a container runtime sends before SIGKILL; draining here is the
// difference between clients reconnecting smoothly and them all erroring at once.
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
