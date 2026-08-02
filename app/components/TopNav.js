"use client";

// Single consolidated nav used on every signed-in page, replacing the
// scattered per-page back-links/settings-gear/profile-chip combos that used
// to differ from page to page. One hamburger menu, same options everywhere:
// Home, Profile, Preferences, Sign out — plus whatever single
// page-specific action (if any) is passed in via `extraLink`.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { startPresenceHeartbeat } from "../../lib/presence";
import FocusMode from "./FocusMode";

/** Picks black or white text for a given hex background, via standard relative-luminance. */
function contrastInk(hex) {
  const clean = (hex || "").replace("#", "");
  if (clean.length !== 6) return "#17181a";
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.45 ? "#17181a" : "#ffffff";
}

export default function TopNav({ user, extraLink }) {
  // Single switch for "which of the two topbar dropdowns is open" — the
  // status/focus picker (FocusMode) and this hamburger/account menu — so
  // opening one always closes the other instead of both stacking up.
  const [openMenu, setOpenMenu] = useState(null); // null | "hamburger" | "status"
  const open = openMenu === "hamburger";
  const [avatarUrl, setAvatarUrl] = useState("");
  const ref = useRef(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpenMenu(null);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  /** Used on nav links that can point at the page already showing — skips the redundant navigation/remount instead of reloading a page you're already on. */
  function goTo(e, href) {
    setOpenMenu(null);
    if (href === pathname) e.preventDefault();
  }

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
      document.body.classList.toggle("light-mode", prefs.theme === "light");
      // "zoom" isn't standard CSS, but works in Chromium/Electron (this
      // app's primary desktop target) and just no-ops elsewhere — a real
      // rem-based rescale would need every fixed px font-size in the app
      // reworked, which is out of scope for a preference toggle.
      document.body.style.zoom = prefs.largerText ? "1.12" : "";

      // Accent color — .shell{} in globals.css declares --s-amber directly
      // on itself as the theme default, which beats any override set on an
      // ancestor (body/:root) no matter how it's set. Setting the property
      // via inline style on the .shell element ITSELF is the one thing that
      // outranks that, so that's where a custom accent gets applied.
      const shellEl = document.querySelector(".shell");
      if (shellEl) {
        if (prefs.accentColor) {
          shellEl.style.setProperty("--s-amber", prefs.accentColor);
          shellEl.style.setProperty("--s-amber-2", prefs.accentColor);
          shellEl.style.setProperty("--s-amber-ink", contrastInk(prefs.accentColor));
        } else {
          shellEl.style.removeProperty("--s-amber");
          shellEl.style.removeProperty("--s-amber-2");
          shellEl.style.removeProperty("--s-amber-ink");
        }
      }
    });
    return () => {
      unsub();
      document.body.classList.remove("reduce-motion", "compact-mode", "light-mode");
      document.body.style.zoom = "";
    };
  }, [user?.uid]);

  async function handleSignOut() {
    setOpenMenu(null);
    await signOut(auth);
    router.push("/");
  }

  return (
    <div className="shell-topbar">
      <Link
        href="/"
        className="shell-topbar-brand brand-wordmark"
        aria-label="Blueprint home"
        onClick={(e) => goTo(e, "/")}
      >
        Blueprint
      </Link>

      <div className="shell-topbar-right" ref={ref}>
        {user && (
          <FocusMode user={user} open={openMenu === "status"} onOpenChange={(v) => setOpenMenu(v ? "status" : null)} />
        )}

        {user && <span className="shell-topbar-divider" />}

        {user && (
          <button
            type="button"
            className="shell-topbar-user"
            data-tour="account-menu"
            onClick={() => setOpenMenu(open ? null : "hamburger")}
            aria-expanded={open}
          >
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
            onClick={() => setOpenMenu(open ? null : "hamburger")}
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
            <Link href="/" className="shell-nav-menu-item" onClick={(e) => goTo(e, "/")}>
              Home
            </Link>
            <Link href="/profile" className="shell-nav-menu-item" onClick={(e) => goTo(e, "/profile")}>
              Profile
            </Link>
            <Link href="/account" className="shell-nav-menu-item" onClick={(e) => goTo(e, "/account")}>
              Preferences
            </Link>
            {extraLink && (
              <Link href={extraLink.href} className="shell-nav-menu-item" onClick={(e) => goTo(e, extraLink.href)}>
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
