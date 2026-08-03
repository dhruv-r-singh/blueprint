"use client";

// Slack-style status/focus picker. Purely informational — doesn't mute
// notifications or change app behavior — but gives teammates a quick signal
// (via the presence dot's color) about whether now's a good time to ping you.

import { useEffect, useRef, useState } from "react";
import { arrayRemove, arrayUnion, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import ColorPicker from "./ColorPicker";

export const FOCUS_MODES = [
  { key: "available", label: "Available", color: "#5fbf8f" },
  { key: "focusing", label: "Focusing", color: "#c46fd8" },
  { key: "meeting", label: "In a meeting", color: "#6fa8d8" },
  { key: "away", label: "Away", color: "#97989f" },
];

/**
 * Looks up a focus mode's { key, label, color } — returns null for
 * "available" or unset, since that's the default/no-badge state.
 *
 * Custom focuses (created via the panel below) aren't in the shared
 * FOCUS_MODES list — they're personal to whoever made them, stored on their
 * own profiles/{uid}.customFocusModes. So a teammate's browser can't look
 * one up by key alone. Instead, whoever's *currently on* a custom focus has
 * its label/color denormalized straight onto their own profile doc
 * (activeFocusLabel/activeFocusColor, set by pick() below) precisely so any
 * other viewer already reading that profile — via memberProfiles, same as
 * name/avatarUrl — can render it correctly without a second lookup. Pass
 * those two as the 2nd/3rd args wherever you have them.
 */
export function focusModeInfo(key, customLabel, customColor) {
  if (!key || key === "available") return null;
  const builtin = FOCUS_MODES.find((m) => m.key === key);
  if (builtin) return builtin;
  if (key.startsWith("custom:") && customLabel && customColor) {
    return { key, label: customLabel, color: customColor };
  }
  return null;
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
  const [customModes, setCustomModes] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#e0a339");
  const ref = useRef(null);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(doc(db, "profiles", user.uid), (snap) => {
      setMode(snap.data()?.focusMode || "available");
      setCustomModes(snap.data()?.customFocusModes || []);
    });
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    // Only listen while THIS dropdown is actually open. Without this
    // guard, the listener was always active — so any mousedown anywhere
    // else on the page (including on the hamburger nav menu's own
    // buttons, which share the same "which menu is open" state via
    // onOpenChange) got treated as "click outside FocusMode" and closed
    // whichever menu was open, wiping it out between mousedown and
    // mouseup/click and silently swallowing the click before it could
    // ever reach the button being clicked.
    if (!open) return;
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function pick(m) {
    setOpen(false);
    setCreating(false);
    if (!user?.uid) return;
    // Built-ins clear the denormalized custom label/color so a stale one
    // never lingers and gets mistaken for the new selection.
    const isCustom = m.key.startsWith("custom:");
    setDoc(
      doc(db, "profiles", user.uid),
      {
        focusMode: m.key,
        activeFocusLabel: isCustom ? m.label : null,
        activeFocusColor: isCustom ? m.color : null,
      },
      { merge: true }
    ).catch((err) => console.error("Couldn't save focus mode:", err));
  }

  function saveCustom(e) {
    e.preventDefault();
    if (!user?.uid || !newLabel.trim()) return;
    const entry = { key: `custom:${Date.now().toString(36)}`, label: newLabel.trim().slice(0, 24), color: newColor };
    setDoc(doc(db, "profiles", user.uid), { customFocusModes: arrayUnion(entry) }, { merge: true })
      .then(() => pick(entry))
      .catch((err) => console.error("Couldn't save custom focus:", err));
    setNewLabel("");
    setNewColor("#e0a339");
  }

  function deleteCustom(e, entry) {
    e.stopPropagation();
    if (!user?.uid) return;
    setDoc(doc(db, "profiles", user.uid), { customFocusModes: arrayRemove(entry) }, { merge: true }).catch((err) =>
      console.error("Couldn't remove that custom focus:", err)
    );
    if (mode === entry.key) pick(FOCUS_MODES[0]);
  }

  if (!user) return null;
  const allModes = [...FOCUS_MODES, ...customModes];
  const current = allModes.find((m) => m.key === mode) || FOCUS_MODES[0];

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
          style={{ position: "absolute", top: "calc(100% + 6px)", bottom: "auto", right: 0, left: "auto", width: "max-content", minWidth: 200 }}
        >
          {!creating && (
            <>
              {allModes.map((m) => (
                <div key={m.key} className="shell-proj-row" onClick={() => pick(m)} style={{ padding: "8px 10px", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: m.color, flex: "none" }} />
                  <span style={{ flex: 1 }}>{m.label}</span>
                  {m.key.startsWith("custom:") && (
                    <span
                      onClick={(e) => deleteCustom(e, m)}
                      title="Remove this custom focus"
                      style={{ color: "var(--s-text-3)", fontSize: 13, padding: "0 2px", cursor: "pointer" }}
                    >
                      ×
                    </span>
                  )}
                </div>
              ))}
              <div
                className="shell-proj-row"
                onClick={() => setCreating(true)}
                style={{ padding: "8px 10px", whiteSpace: "nowrap", borderTop: "1px solid var(--s-border)", color: "var(--s-amber)" }}
              >
                + Custom focus
              </div>
            </>
          )}
          {creating && (
            <form onSubmit={saveCustom} style={{ padding: 10, width: 220 }} onClick={(e) => e.stopPropagation()}>
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Name, e.g. Deep work"
                autoFocus
                maxLength={24}
                className="shell-input"
                style={{ width: "100%", fontSize: 12.5, padding: "7px 9px", marginBottom: 8 }}
              />
              <ColorPicker value={newColor} onChange={setNewColor} />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button type="submit" disabled={!newLabel.trim()} className="shell-task-add-btn" style={{ fontSize: 11.5, padding: "6px 14px" }}>
                  Create & switch to it
                </button>
                <button type="button" onClick={() => setCreating(false)} className="ghost" style={{ fontSize: 11.5 }}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
