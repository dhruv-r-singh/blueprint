"use client";

// Lightweight online/offline presence — no Realtime Database in this
// project (only Firestore), and Firestore has no built-in "disconnect"
// detection, so this uses the standard workaround: while the app is open,
// periodically write a timestamp to the user's own public profile doc.
// Anyone viewing that profile treats "updated in the last ONLINE_THRESHOLD_MS"
// as online. Not instant on tab-close (no heartbeat = shows offline only
// after the threshold passes), but needs no extra Firebase product.

import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

const HEARTBEAT_MS = 25_000;
export const ONLINE_THRESHOLD_MS = 45_000;

/**
 * Call once per signed-in session (e.g. from TopNav, which mounts on every
 * protected page). Returns a cleanup function.
 */
export function startPresenceHeartbeat(uid) {
  if (!uid || typeof document === "undefined") return () => {};
  const ref = doc(db, "profiles", uid);
  const beat = () => setDoc(ref, { lastActiveAt: serverTimestamp() }, { merge: true }).catch(() => {});

  beat();
  const interval = setInterval(beat, HEARTBEAT_MS);

  function onVisible() {
    if (document.visibilityState === "visible") beat();
  }
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", beat);

  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", beat);
  };
}

/** `lastActiveAt` is a Firestore Timestamp (or millis number, or nullish). */
export function isOnline(lastActiveAt) {
  if (!lastActiveAt) return false;
  const ms = typeof lastActiveAt.toMillis === "function" ? lastActiveAt.toMillis() : lastActiveAt;
  return Date.now() - ms < ONLINE_THRESHOLD_MS;
}

/** Human "last seen" string for offline users. */
export function lastSeenLabel(lastActiveAt) {
  if (!lastActiveAt) return "Never active";
  const ms = typeof lastActiveAt.toMillis === "function" ? lastActiveAt.toMillis() : lastActiveAt;
  const diffMin = Math.round((Date.now() - ms) / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
