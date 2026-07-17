import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { findRepoRoot } from "../config/paths";

/**
 * Static hosting for the built frontend.
 *
 * The same process serves the bundle and the WebSocket, so the client always
 * talks to /ws on its own origin. One deploy, no CORS, and no chance of the page
 * and the socket disagreeing about which host they're on — the single most
 * common way a WebSocket app that worked on localhost breaks once deployed.
 *
 * The path is *found*, not hardcoded relative to this file: in dev this module
 * sits at backend/src/http/static.ts, but the bundle collapses to
 * backend/dist/main.js, and those are different depths. A single `../../..`
 * cannot be right in both — see config/paths.
 */
const WEB_DIST = join(findRepoRoot(dirname(fileURLToPath(import.meta.url))), "frontend/dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

export function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  if (!existsSync(WEB_DIST)) {
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("Frontend not built. Run: npm run build");
    return;
  }

  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
  // normalize + prefix check keeps ../../etc/passwd out of the filesystem.
  const candidate = join(WEB_DIST, normalize(urlPath));
  const safe = candidate.startsWith(WEB_DIST) ? candidate : WEB_DIST;

  // SPA fallback: any unmatched path is the app's own route, not a 404.
  const file =
    existsSync(safe) && statSync(safe).isFile() ? safe : join(WEB_DIST, "index.html");

  if (!existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }

  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    // Vite fingerprints asset filenames, so those are immutable and cached hard.
    // The HTML shell is `no-store` — never cached at all. `no-cache` (revalidate)
    // wasn't enough in practice: with a long-lived tab, a soft reload could still
    // be served the old shell, which then references the old asset hashes, and
    // the whole new build silently fails to appear. `no-store` guarantees every
    // navigation fetches the current shell and therefore the current assets.
    "cache-control": file.endsWith("index.html")
      ? "no-store, must-revalidate"
      : "public, max-age=31536000, immutable",
  });
  createReadStream(file).pipe(res);
}
