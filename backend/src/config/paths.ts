import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";

/**
 * Locating the repo root at runtime.
 *
 * This exists because of a bug worth remembering. Paths used to be written as
 * `resolve(import.meta.url, "../../../../frontend/dist")`, which quietly depends
 * on how deep the *current file* sits. In dev, tsx runs the real source tree
 * (`backend/src/http/static.ts` — three levels under backend/). In production,
 * esbuild collapses everything into `backend/dist/main.js` — two levels. The
 * same relative path therefore points at two different places, and the failure
 * only appears once bundled: the server boots, answers /healthz perfectly, and
 * serves "Frontend not built" to every visitor. TypeScript cannot see it, and
 * neither can any test that doesn't fetch a real page.
 *
 * Finding an anchor instead of counting `..` removes the whole class of problem.
 * Both layouts agree on one thing — the workspace root is the directory whose
 * package.json declares the workspaces — so we look for that.
 */

/** Walk up until we find the workspace root package.json. */
export function findRepoRoot(from: string): string {
  let dir = from;
  const { root } = parse(dir);

  while (true) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { workspaces?: unknown };
        // The root manifest is the one declaring workspaces; backend/package.json
        // would otherwise match on the very first step up.
        if (parsed.workspaces) return dir;
      } catch {
        // Unreadable package.json: keep climbing rather than guessing.
      }
    }

    if (dir === root) {
      throw new Error(
        `Could not locate the workspace root above ${from}. ` +
          `Expected a package.json with a "workspaces" field.`,
      );
    }
    dir = dirname(dir);
  }
}
