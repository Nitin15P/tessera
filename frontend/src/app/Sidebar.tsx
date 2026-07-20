import { PresencePanel } from "../features/presence/PresencePanel";
import { LeaderboardPanel } from "../features/leaderboard/LeaderboardPanel";
import { ChatPanel } from "../features/chat/ChatPanel";

/** Layout only. Each panel owns its own data and subscription. Presence and
 *  standings take the top and scroll when the room is crowded; the compact chat
 *  ticker is pinned to the bottom. */
export function Sidebar() {
  return (
    <aside className="side">
      <div className="side-stats">
        <PresencePanel />
        <LeaderboardPanel />
      </div>
      <ChatPanel />
    </aside>
  );
}
