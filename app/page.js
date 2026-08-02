"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { collection, query, where, getDocs, doc, setDoc } from "firebase/firestore";
import { auth, db, googleProvider, githubProvider, linkedinProvider, firebaseConfigured } from "../lib/firebase";
import { describeAuthError } from "../lib/authErrors";
import { integrationsDocPath, saveGoogleCredential, saveGithubCredential } from "../lib/integrations";

export default function Page() {
  const router = useRouter();
  const [pending, setPending] = useState(null);
  const [error, setError] = useState("");
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    if (!firebaseConfigured) {
      setUser(null);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  // Once signed in, skip the dashboard entirely — go straight into the
  // most recent project, or straight into project creation if there isn't one yet.
  //
  // Deliberately NOT using orderBy() + limit() here: that combined with the
  // where("memberIds", ...) filter requires a Firestore composite index. If
  // that index doesn't exist, the query throws, lands in the catch block
  // below, and silently sends everyone to /create — even people who already
  // have projects. Fetching all of the user's projects (cheap; a person has
  // at most a handful) and sorting client-side avoids depending on an index
  // that may not have been created in the Firebase console.
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const q = query(collection(db, "projects"), where("memberIds", "array-contains", user.uid));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          projects.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
          router.replace(`/project/${projects[0].id}`);
        } else {
          router.replace("/create");
        }
      } catch (err) {
        console.error("Redirect lookup failed:", err);
        setError("Couldn't load your projects — " + (err.code || err.message || "try again"));
      }
    })();
  }, [user, router]);

  async function handleSignIn(kind) {
    if (!firebaseConfigured) return;
    setError("");
    setPending(kind);
    try {
      const provider =
        kind === "google" ? googleProvider : kind === "github" ? githubProvider : linkedinProvider;
      const result = await signInWithPopup(auth, provider);

      // Piggyback the Drive/GitHub access token off this same sign-in —
      // see lib/integrations.js. Non-fatal if it fails; sign-in itself
      // already succeeded.
      try {
        const saveFn = (patch) => setDoc(doc(db, ...integrationsDocPath(result.user.uid)), patch, { merge: true });
        if (kind === "google") await saveGoogleCredential(result, saveFn);
        else if (kind === "github") await saveGithubCredential(result, saveFn);
      } catch (err) {
        console.error("Couldn't save Drive/GitHub credential:", err);
      }
    } catch (err) {
      const msg = describeAuthError(err);
      if (msg) setError(msg);
    } finally {
      setPending(null);
    }
  }

  async function handleSignOut() {
    setError("");
    try {
      await signOut(auth);
    } catch (err) {
      setError("Sign-out failed — " + (err.code || "try again"));
    }
  }

  return (
    <div className="shell">
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div className="shell-card" style={{ width: "100%", maxWidth: 420 }}>
          {user ? (
            <>
              <div className="brand-wordmark" style={{ fontSize: 30, marginBottom: 6 }}>
                Blueprint
              </div>
              <div style={{ color: "var(--s-text-2)", fontSize: 14, marginBottom: 24 }}>
                Taking you in…
              </div>
              {error && <p className="notice">{error}</p>}
              <button className="shell-auth-btn" onClick={handleSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <div className="brand-wordmark" style={{ fontSize: 30, marginBottom: 6 }}>
                Blueprint
              </div>
              <div style={{ color: "var(--s-text-2)", fontSize: 14, marginBottom: 26 }}>
                Find the team for what you&rsquo;re building.
              </div>

              {!firebaseConfigured && <p className="notice">Auth isn&rsquo;t configured yet.</p>}
              {error && <p className="notice">{error}</p>}

              <button
                className="shell-auth-btn"
                onClick={() => handleSignIn("google")}
                disabled={!firebaseConfigured || pending !== null}
              >
                <svg width="20" height="20" viewBox="0 0 18 18">
                  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.85 2.09-1.81 2.73v2.27h2.92c1.71-1.57 2.69-3.88 2.69-6.64z" />
                  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.17l-2.92-2.27c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34C2.44 15.98 5.48 18 9 18z" />
                  <path fill="#FBBC05" d="M3.97 10.71A5.4 5.4 0 013.68 9c0-.59.1-1.17.29-1.71V4.96H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.04l3.01-2.33z" />
                  <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
                </svg>
                {pending === "google" ? "Signing in…" : "Continue with Google"}
              </button>

              <button
                className="shell-auth-btn"
                onClick={() => handleSignIn("github")}
                disabled={!firebaseConfigured || pending !== null}
              >
                <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                {pending === "github" ? "Signing in…" : "Continue with GitHub"}
              </button>

              <button
                className="shell-auth-btn"
                onClick={() => handleSignIn("linkedin")}
                disabled={!firebaseConfigured || pending !== null}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#0A66C2">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
                {pending === "linkedin" ? "Signing in…" : "Continue with LinkedIn"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
