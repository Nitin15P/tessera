import { useSyncExternalStore } from "react";
import { store } from "../state/store";

/**
 * Subscribe to the store's *slow* channel.
 *
 * The board deliberately does not go through here. Presence, leaderboard,
 * connection status and the open challenge change a few times a second at most
 * and belong in React; tiles change 20 times a second and belong on the canvas.
 * Two update rates, two mechanisms — this is the seam between them.
 */
export const useStore = (): number =>
  useSyncExternalStore(store.subscribe, store.getVersion);
