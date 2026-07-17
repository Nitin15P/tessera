import { PresencePanel } from "../features/presence/PresencePanel";
import { LeaderboardPanel } from "../features/leaderboard/LeaderboardPanel";
import { RulesPanel } from "../features/status/RulesPanel";

/** Layout only. Each panel owns its own data and subscription. */
export function Sidebar() {
  return (
    <aside className="side">
      <PresencePanel />
      <LeaderboardPanel />
      <RulesPanel />
    </aside>
  );
}
