"use client";

// Slack-style status/focus picker. Purely informational — doesn't mute
// notifications or change app behavior — but gives teammates a quick signal
// next to your presence dot about whether now's a good time to ping you.

import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";

export const FOCUS_MODES = [
  { key: "available", label: "Available", color: "#5fbf8f" },
  { key: "focusing", label: "Focusing", color: "#c46fd8" },
  { key: "meeting", label: "In a meeting", color: "#6fa8d8" },
  { key: "away", label: "Away", color: "#97989f" },
];

/** Looks up a focus mode's { key, label, color } — returns null for "available" or unset, since that's the default/no-badge state. */
export function focusModeInfo(key) {
  if (!key || key === "available") return null;
  return FOCUS_MODES.find((m) => m.key === key) || null;
}

// `open`/`onOpenChange` are optional — pass them (as TopNav does) so this
// dropdown and the hamburger nav menu can share one "which menu is open"
// switch and never both be open at once. Falls back to fully-internal state
// if a caller doesn't need that coordination.
export default function FocusMode({ user, open: openProp, onOpenChange }) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = controlled ? onOpenChange : setOpenState;
  const [mode, setMode] = useState("available");
  const ref = useRef(null);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(doc(db, "profiles", user.uid), (snap) => {
      setMode(snap.data()?.focusMode || "available");
    });
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function pick(key) {
    setOpen(false);
    if (!user?.uid) return;
    setDoc(doc(db, "profiles", user.uid), { focusMode: key }, { merge: true }).catch((err) =>
      console.error("Couldn't save focus mode:", err)
    );
  }

  if (!user) return null;
  const current = FOCUS_MODES.find((m) => m.key === mode) || FOCUS_MODES[0];

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "transparent",
          border: "1px solid var(--s-border)",
          borderRadius: 999,
          padding: "4px 10px 4px 8px",
          cursor: "pointer",
          color: "var(--s-text-2)",
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 11.5,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: current.color, flex: "none" }} />
        {current.label}
      </button>
      {open && (
        <div
          className="shell-composer-menu"
          style={{ position: "absolute", top: "calc(100% + 6px)", bottom: "auto", right: 0, left: "auto", width: "max-content", minWidth: 170 }}
        >
          {FOCUS_MODES.map((m) => (
            <div key={m.key} className="shell-proj-row" onClick={() => pick(m.key)} style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: m.color, flex: "none" }} />
              {m.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
