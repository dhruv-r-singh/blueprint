"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

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
 */
export function useAuthGate(user) {
  const router = useRouter();
  useEffect(() => {
    if (user === null) router.replace("/");
  }, [user, router]);
}
