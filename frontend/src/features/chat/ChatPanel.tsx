import { useEffect, useRef, useState } from "react";
import { store } from "../../state/store";
import { useStore } from "../../app/useStore";
import { sendChat } from "../../net/socket";

/**
 * The chatbox.
 *
 * Fills the sidebar below the leaderboard: a scrolling log that sticks to the
 * newest line, and an input pinned at the bottom. Each line wears its sender's
 * colour, the same colour their tiles do, so who's talking reads at a glance.
 */
export function ChatPanel() {
  useStore();
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  // Keep the log pinned to the newest line as messages arrive.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [store.chat.length]);

  const submit = () => {
    sendChat(draft);
    setDraft("");
  };

  return (
    <section className="panel chat">
      <h2>Chat</h2>

      <div className="chat-log" ref={logRef}>
        {store.chat.length === 0 && <p className="chat-empty">Quiet in here.</p>}
        {store.chat.map((line, i) => (
          <p className="chat-line" key={`${line.at}-${i}`}>
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
