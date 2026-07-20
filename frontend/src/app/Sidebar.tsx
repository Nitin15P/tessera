import { PresencePanel } from "../features/presence/PresencePanel";
import { LeaderboardPanel } from "../features/leaderboard/LeaderboardPanel";
import { ChatPanel } from "../features/chat/ChatPanel";

/** Layout only. Each panel owns its own data and subscription. Presence and
 *  standings sit at natural height; chat grows to fill the rest. */
export function Sidebar() {
  return (
    <aside className="side">
      <PresencePanel />
      <LeaderboardPanel />
      <ChatPanel />
    </aside>
  );
}
