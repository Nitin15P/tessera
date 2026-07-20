import { useState } from "react";
import { store } from "../../state/store";
import { useStore } from "../../app/useStore";
import { sendChat } from "../../net/socket";

/** How many lines the ticker shows at once. As a new one arrives the oldest rolls
 *  off the top, so chat stays a compact strip pinned to the sidebar bottom. */
const VISIBLE = 5;

/**
 * The chatbox — a rolling ticker.
 *
 * Only the last few lines are ever on screen, anchored to the bottom just above
 * the input; older ones fall away as new ones arrive. Each line wears its sender's
 * colour, the same their tiles do. Pinned to the bottom of the sidebar so Online
 * and Leaderboard keep the room above.
 */
export function ChatPanel() {
  useStore();
  const [draft, setDraft] = useState("");
  const lines = store.chat.slice(-VISIBLE);

  const submit = () => {
    sendChat(draft);
    setDraft("");
  };

  return (
    <section className="panel chat">
      <h2>Chat</h2>

      <div className="chat-log">
        {lines.length === 0 && <p className="chat-empty">Quiet in here.</p>}
        {lines.map((line) => (
          <p className="chat-line" key={line.id}>
            <span className="chat-name" style={{ color: line.from.color }}>
              {line.from.name}
            </span>{" "}
            <span className="chat-text">{line.text}</span>
          </p>
        ))}
      </div>

      <div className="chat-input">
        <input
          value={draft}
          maxLength={200}
          placeholder="say something…"
          aria-label="Send a chat message"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </div>
    </section>
  );
}
