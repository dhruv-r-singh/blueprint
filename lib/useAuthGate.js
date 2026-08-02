"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";

/**
 * Hard auth gate for every page except "/" and "/join/[code]" (which are
 * themselves sign-in entry points, so they're allowed to render before a
 * user exists). Pass the `user` value from your own onAuthStateChanged
 * listener — undefined while Firebase is still checking, null once it's
 * confirmed there's no one signed in, or the user object.
 *
 * The moment we know for sure nobody's signed in, this bounces to "/" (the
 * sign-in screen). Callers are expected to render nothing but a blank
 * shell while `user` is undefined or null — see the `if (!user) return
 * <div className="shell" />;` pattern used on every protected page — so no
 * page content is ever visible pre-auth, not even for a frame.
 *
 * Also watches profiles/{uid}.disabled — set from the Danger zone on
 * /account — and bounces to /account/disabled the moment it's true, on
 * every gated page. That page is itself NOT gated by this hook (it does its
 * own lighter auth check) to avoid a redirect loop.
 */
export function useAuthGate(user) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (user === null) router.replace("/");
  }, [user, router]);

  useEffect(() => {
    if (!user || pathname === "/account/disabled") return;
    const unsub = onSnapshot(doc(db, "profiles", user.uid), (snap) => {
      if (snap.exists() && snap.data().disabled) {
        router.replace("/account/disabled");
      }
    });
    return () => unsub();
  }, [user, pathname, router]);
}
