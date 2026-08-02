"use client";

// Single consolidated nav used on every signed-in page, replacing the
// scattered per-page back-links/settings-gear/profile-chip combos that used
// to differ from page to page. One hamburger menu, same options everywhere:
// Home, Profile, Preferences, Sign out — plus whatever single
// page-specific action (if any) is passed in via `extraLink`.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { startPresenceHeartbeat } from "../../lib/presence";
import FocusMode from "./FocusMode";

export default function TopNav({ user, extraLink }) {
  const [open, setOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const ref = useRef(null);
  const router = useRouter();

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // TopNav mounts on every signed-in page, so this is the one place that
  // reliably covers "the app is open" for the online/offline presence
  // heartbeat (see lib/presence.js).
  useEffect(() => {
    if (!user?.uid) return;
    return startPresenceHeartbeat(user.uid);
  }, [user?.uid]);

  // TopNav mounts on every signed-in page, so it's also the one place that
  // can apply Appearance/Accessibility preferences (set on /account's
  // "Voice & Video" / "Appearance" / "Accessibility" subpages) app-wide,
  // without every single page needing to read and apply them itself.
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(doc(db, "profiles", user.uid), (snap) => {
      setAvatarUrl(snap.data()?.avatarUrl || "");
      const prefs = snap.data()?.preferences || {};
      document.body.classList.toggle("reduce-motion", Boolean(prefs.reduceMotion));
      document.body.classList.toggle("compact-mode", Boolean(prefs.compactMode));
      // "zoom" isn't standard CSS, but works in Chromium/Electron (this
      // app's primary desktop target) and just no-ops elsewhere — a real
      // rem-based rescale would need every fixed px font-size in the app
      // reworked, which is out of scope for a preference toggle.
      document.body.style.zoom = prefs.largerText ? "1.12" : "";
    });
    return () => {
      unsub();
      document.body.classList.remove("reduce-motion", "compact-mode");
      document.body.style.zoom = "";
    };
  }, [user?.uid]);

  async function handleSignOut() {
    setOpen(false);
    await signOut(auth);
    router.push("/");
  }

  return (
    <div className="shell-topbar">
      <Link href="/" className="shell-topbar-brand brand-wordmark" aria-label="Blueprint home">
        Blueprint
      </Link>

      <div className="shell-topbar-right" ref={ref}>
        {user && <FocusMode user={user} />}

        {user && <span className="shell-topbar-divider" />}

        {user && (
          <button type="button" className="shell-topbar-user" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {avatarUrl || user.photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl || user.photoURL} alt="" className="shell-avatar" />
            ) : (
              <span className="shell-avatar">{(user.displayName || user.email || "?")[0]?.toUpperCase()}</span>
            )}
            <span className="shell-topbar-user-name">{user.displayName || user.email}</span>
            <span style={{ color: "var(--s-text-3)", fontSize: 11 }}>⌄</span>
          </button>
        )}

        {!user && (
          <button
            type="button"
            className="shell-hamburger"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={open}
          >
            <span />
            <span />
            <span />
          </button>
        )}

        {open && (
          <div className="shell-nav-menu" onClick={(e) => e.stopPropagation()}>
            <div className="shell-nav-menu-user">{user?.displayName || user?.email || "Account"}</div>
            <Link href="/" className="shell-nav-menu-item" onClick={() => setOpen(false)}>
              Home
            </Link>
            <Link href="/profile" className="shell-nav-menu-item" onClick={() => setOpen(false)}>
              Profile
            </Link>
            <Link href="/account" className="shell-nav-menu-item" onClick={() => setOpen(false)}>
              Preferences
            </Link>
            {extraLink && (
              <Link href={extraLink.href} className="shell-nav-menu-item" onClick={() => setOpen(false)}>
                {extraLink.label}
              </Link>
            )}
            <button type="button" className="shell-nav-menu-item danger" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
