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
import { setDesktopTitle } from "../../lib/desktopAuth";
import FocusMode from "./FocusMode";
import Mailbox from "./Mailbox";

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

  function toggleHamburger() {
    setOpenMenu(open ? null : "hamburger");
  }

  /** Used on nav links that can point at the page already showing — skips the redundant navigation/remount instead of reloading a page you're already on. */
  function goTo(e, href) {
    setOpenMenu(null);
    if (href === pathname) e.preventDefault();
  }

  /** Hard browser navigation for the dropdown menu items — `router.push` (Next's client-side router) was confirmed not actually changing the URL even though the click itself was registering fine, so this bypasses the client router entirely and navigates the same way typing a URL and hitting Enter would. Costs a full page reload instead of an instant client-side swap, but it cannot silently no-op the way the router apparently was. */
  function navTo(href) {
    setOpenMenu(null);
    if (href !== pathname) window.location.href = href;
  }

  // TopNav mounts on every signed-in page, so this is the one place that
  // reliably covers "the app is open" for the online/offline presence
  // heartbeat (see lib/presence.js).
  useEffect(() => {
    if (!user?.uid) return;
    return startPresenceHeartbeat(user.uid);
  }, [user?.uid]);

  // Desktop app window title: default back to plain "Blueprint" on every
  // page except the project page, which overrides this with the project
  // name once it loads (see app/project/[id]/page.js). No-ops outside the
  // Electron shell. Keyed on pathname so navigating away from a project
  // (whose page set a custom title) resets it here instead of leaving a
  // stale project name in the title bar.
  useEffect(() => {
    setDesktopTitle();
  }, [pathname]);

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
      document.body.classList.toggle("sharp-corners", prefs.cornerStyle === "sharp");
      document.body.classList.toggle("sidebar-right", prefs.sidebarSide === "right");
      document.body.classList.toggle("always-show-msg-times", Boolean(prefs.alwaysShowTimestamps));
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
      document.body.classList.remove("reduce-motion", "compact-mode", "light-mode", "sharp-corners", "sidebar-right", "always-show-msg-times");
      document.body.style.zoom = "";
    };
  }, [user?.uid]);

  // Auto-away (Preferences → Notifications → Presence): switches focusMode
  // to "away" after N idle minutes, and back to "available" the moment
  // there's activity again — but only ever touches focusMode if IT was the
  // one that set "away"; manually picking Focusing/In a meeting/Away
  // yourself is never overridden or auto-reverted by this. TopNav mounts on
  // every signed-in page, so this is the one place that can track "activity
  // anywhere in the app" without every page wiring its own listeners.
  useEffect(() => {
    if (!user?.uid) return;
    let idleTimer = null;
    let autoAwaySetByUs = false;
    let minutes = 0;

    function armTimer() {
      if (idleTimer) clearTimeout(idleTimer);
      if (!minutes) return;
      idleTimer = setTimeout(async () => {
        try {
          const { setDoc, doc: fdoc, getDoc } = await import("firebase/firestore");
          const ref = fdoc(db, "profiles", user.uid);
          const snap = await getDoc(ref);
          const current = snap.data()?.focusMode || "available";
          if (current === "available") {
            await setDoc(ref, { focusMode: "away" }, { merge: true });
            autoAwaySetByUs = true;
          }
        } catch (err) {
          console.error("Couldn't set auto-away:", err);
        }
      }, minutes * 60 * 1000);
    }

    function onActivity() {
      if (autoAwaySetByUs) {
        autoAwaySetByUs = false;
        import("firebase/firestore").then(({ setDoc, doc: fdoc }) =>
          setDoc(fdoc(db, "profiles", user.uid), { focusMode: "available" }, { merge: true }).catch(() => {})
        );
      }
      armTimer();
    }

    const unsubPrefs = onSnapshot(doc(db, "profiles", user.uid), (snap) => {
      minutes = Number(snap.data()?.preferences?.autoAwayMinutes) || 0;
      armTimer();
    });

    const events = ["mousemove", "keydown", "click", "scroll"];
    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));

    return () => {
      unsubPrefs();
      if (idleTimer) clearTimeout(idleTimer);
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
    };
  }, [user?.uid]);

  async function handleSignOut() {
    setOpenMenu(null);
    await signOut(auth);
    window.location.href = "/";
  }

  return (
    <>
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
            onClick={toggleHamburger}
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
            onClick={toggleHamburger}
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
            <button type="button" className="shell-nav-menu-item" onClick={() => navTo("/")}>
              Home
            </button>
            <button type="button" className="shell-nav-menu-item" onClick={() => navTo("/profile")}>
              Profile
            </button>
            <button type="button" className="shell-nav-menu-item" onClick={() => navTo("/account")}>
              Preferences
            </button>
            {extraLink && (
              <button type="button" className="shell-nav-menu-item" onClick={() => navTo(extraLink.href)}>
                {extraLink.label}
              </button>
            )}
            <button type="button" className="shell-nav-menu-item danger" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
    <Mailbox user={user} />
    </>
  );
}
