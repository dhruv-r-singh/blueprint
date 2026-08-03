"use client";

// Landing page for the desktop shell's Google/GitHub OAuth handoff — see
// lib/desktopAuth.js for the full story. electron/main.js navigates the
// app's window here (via blueprint://auth-callback) once sign-in or
// "Connect" finishes in the user's real browser, carrying either:
//   - ?token=<firebase custom token>&next=<path>   (fresh sign-in)
//   - ?linked=google|github&next=<path>            (connected from /account)
//   - ?error=<message>                             (something went wrong)
// This page's only job is to finish that handoff and get out of the way.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { describeAuthError } from "../../lib/authErrors";

export default function DesktopAuthPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const linked = params.get("linked");
    const oauthError = params.get("error");
    const next = params.get("next") || "/";

    if (token) {
      signInWithCustomToken(auth, token)
        .then(() => router.replace(next))
        .catch((err) => setError(describeAuthError(err) || "Sign-in failed — try again."));
      return;
    }
    if (linked) {
      router.replace(`${next}?linked=${linked}`);
      return;
    }
    if (oauthError) {
      setError(oauthError);
      return;
    }
    router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="shell">
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div className="shell-card" style={{ width: "100%", maxWidth: 420, textAlign: "center" }}>
          {error ? (
            <>
              <p className="notice" style={{ marginBottom: 16 }}>{error}</p>
              <a href="/signin" className="shell-auth-btn primary" style={{ textDecoration: "none", display: "inline-flex" }}>
                Back to sign in
              </a>
            </>
          ) : (
            <div style={{ color: "var(--s-text-2)", fontSize: 14 }}>Finishing sign-in…</div>
          )}
        </div>
      </div>
    </div>
  );
}
