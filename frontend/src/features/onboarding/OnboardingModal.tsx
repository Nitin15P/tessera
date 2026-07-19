import { useEffect, useState } from "react";
import { PALETTE, sanitizeColor } from "@tessera/shared/domain";
import { store } from "../../state/store";
import { useStore } from "../../app/useStore";
import { setProfile } from "../../net/socket";

const ONBOARDED_KEY = "tessera:onboarded";
const presets = PALETTE as readonly string[];

/**
 * First-visit onboarding: make your identity before you touch the board.
 *
 * Mounted only while `store.onboarding` is true, so its local state is fresh each
 * time it opens (first visit, or later from the name chip). The name and colour
 * are optimistic — sent on "Enter" and echoed back sanitised by the server. On a
 * genuine first visit it hands off to the spotlight so the player meets the rules.
 */
export function OnboardingModal() {
  const me = store.me;
  const [name, setName] = useState(me?.name ?? "");
  const [color, setColor] = useState<string>(me?.color ?? presets[0]!);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        store.onboarding = false;
        store.bump();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!me) return null;

  const isPreset = presets.includes(color);
  const finalName = name.trim() || me.name;

  const submit = () => {
    // First visit is the only time we run the rules spotlight afterwards — a
    // returning player editing their name has already met the rules.
    const firstVisit = !localStorage.getItem(ONBOARDED_KEY);
    setProfile(finalName, color);
    if (firstVisit) {
      store.spotlight = true;
      store.bump();
    }
  };

  return (
    <div className="scrim scrim-soft">
      <div className="profile" role="dialog" aria-label="Choose your name and colour">
        <span className="profile-eyebrow">Welcome to Tessera</span>
        <h2 className="profile-title">Make it yours</h2>

        <label className="profile-field">
          <span className="profile-label">Name</span>
          <input
            className="profile-input"
            value={name}
            maxLength={20}
            placeholder={me.name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </label>

        <div className="profile-field">
          <span className="profile-label">Colour</span>
          <div className="swatch-grid">
            {presets.map((c) => (
              <button
                key={c}
                type="button"
                className={"swatch" + (c === color ? " is-on" : "")}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`Colour ${c}`}
              />
            ))}
            <label
              className={"swatch swatch-custom" + (!isPreset ? " is-on" : "")}
              style={!isPreset ? { background: color } : undefined}
              title="Any colour — kept readable on the board"
            >
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(sanitizeColor(e.target.value))}
              />
              {isPreset && <span className="swatch-plus" aria-hidden>+</span>}
            </label>
          </div>
        </div>

        <div className="profile-preview">
          <span className="swatch preview-swatch" style={{ background: color }} aria-hidden />
          <span className="profile-preview-name" style={{ color }}>
            {finalName}
          </span>
        </div>

        <button type="button" className="profile-enter" onClick={submit}>
          Enter the board
        </button>
      </div>
    </div>
  );
}
