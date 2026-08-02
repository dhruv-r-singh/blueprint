"use client";

// Single consolidated nav used on every signed-in page, replacing the
// scattered per-page back-links/settings-gear/profile-chip combos that used
// to differ from page to page. One hamburger menu, same options everywhere:
// Home, Profile, Account settings, Sign out — plus whatever single
// page-specific action (if any) is passed in via `extraLink`.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { startPresenceHeartbeat } from "../../lib/presence";

export default function TopNav({ user, extraLink }) {
  const [open, setOpen] = useState(false);
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

  async function handleSignOut() {
    setOpen(false);
    await signOut(auth);
    router.push("/");
  }

  return (
    <div className="shell-topbar">
      <Link href="/" className="brand-wordmark" style={{ fontSize: 18, textDecoration: "none" }}>
        Blueprint
      </Link>

      <div className="shell-topbar-right" style={{ marginLeft: "auto", position: "relative" }} ref={ref}>
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

        {user && (
          <span className="shell-avatar" style={{ marginLeft: 10 }} onClick={() => setOpen((v) => !v)}>
            {(user.displayName || user.email || "?")[0]?.toUpperCase()}
          </span>
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
              Account settings
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
