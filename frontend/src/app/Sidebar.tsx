import { PresencePanel } from "../features/presence/PresencePanel";
import { LeaderboardPanel } from "../features/leaderboard/LeaderboardPanel";

/** Layout only. Each panel owns its own data and subscription. The rules moved to
 *  the top-bar "How it works" pill, so the sidebar is presence + standings. */
export function Sidebar() {
  return (
    <aside className="side">
      <PresencePanel />
      <LeaderboardPanel />
    </aside>
  );
}
