import { inBounds } from "@tessera/shared/domain";
import { TRAY_SIZE } from "@tessera/shared/protocol";
import type { ClientMsg } from "@tessera/shared/protocol";
import type { Middleware } from "./types";

/**
 * Parse and validate, once, at the edge.
 *
 * Everything past this point may assume `ctx.msg` is a well-formed ClientMsg
 * with in-range fields. Handlers previously each re-checked `inBounds`, which
 * meant the guarantee was only as good as the least careful handler — and a new
 * handler was one forgotten check away from a silent Uint16Array write at a
 * fractional index.
 *
 * The rule: the boundary validates, the interior trusts. TypeScript types say
 * nothing at runtime about data that arrived over a socket; this is where a
 * `ClientMsg` stops being a hopeful cast and starts being true.
 */

const isFiniteNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Structural check per message type. Anything unrecognised is dropped. */
function validate(msg: unknown): msg is ClientMsg {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;

  switch (m["t"]) {
    case "claim":
    case "challenge":
      return isFiniteNum(m["req"]) && isFiniteNum(m["cell"]) && inBounds(m["cell"]);

    case "solve":
      return (
        isFiniteNum(m["req"]) &&
        isFiniteNum(m["cell"]) &&
        inBounds(m["cell"]) &&
        Number.isInteger(m["idx"]) &&
        (m["idx"] as number) >= 0 &&
        (m["idx"] as number) < TRAY_SIZE
      );

    case "cursor":
      // Normalised board coordinates. Out-of-range means a bug or a probe;
      // either way it isn't drawn.
      return (
        isFiniteNum(m["x"]) &&
        isFiniteNum(m["y"]) &&
        m["x"] >= 0 &&
        m["x"] <= 1 &&
        m["y"] >= 0 &&
        m["y"] <= 1
      );

    case "setProfile":
      // Only the shape is checked here — the name and colour are cleaned and
      // range-clamped in the handler (sanitizeName / sanitizeColor), since "a
      // string" is all the boundary can honestly assert about untrusted text.
      return typeof m["name"] === "string" && typeof m["color"] === "string";

    case "chat":
      // Shape only; sanitised, capped and profanity-masked in the handler.
      return typeof m["text"] === "string";

    case "ping":
      return true;

    default:
      return false;
  }
}

export const parseAndValidate: Middleware = (ctx, next) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(ctx.raw);
  } catch {
    return; // malformed input isn't worth a round trip
  }

  if (!validate(parsed)) return;

  ctx.msg = parsed;
  return next();
};
