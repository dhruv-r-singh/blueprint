"use client";

// The actual sign-in form — split out from "/" so that route can be a
// proper marketing/intro page instead (see app/page.js). Landing here
// happens either by clicking "Get started" on the intro page, or directly
// (bookmarked link, etc). Once signed in, this hands off to "/" itself,
// which already knows how to route a signed-in user into their most recent
// project / onboarding / project creation — no need to duplicate that
// lookup here too.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithCustomToken,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
} from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, db, googleProvider, githubProvider, microsoftProvider, firebaseConfigured } from "../../lib/firebase";
import { describeAuthError } from "../../lib/authErrors";
import { integrationsDocPath, saveGoogleCredential, saveGithubCredential, savePublicIdentity } from "../../lib/integrations";
import { isDesktopApp, startDesktopSignIn } from "../../lib/desktopAuth";
import MfaChallenge from "../components/MfaChallenge";

export default function SignInPage() {
  const router = useRouter();
  const [pending, setPending] = useState(null);
  const [error, setError] = useState("");
  const [user, setUser] = useState(undefined);
  const [mfaError, setMfaError] = useState(null);
  const [lastKind, setLastKind] = useState(null);

  // Email/password sign-in — a plain form alongside the OAuth buttons above,
  // not a separate page. "signin" shows a sign-in form; "signup" adds a name
  // field and creates an account instead.
  const [authMode, setAuthMode] = useState("signin"); // signin | signup
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (!firebaseConfigured) {
      setUser(null);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  // Already signed in (e.g. bookmarked this page, or just finished a sign-in
  // below) — "/" handles the actual project/onboarding routing.
  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  async function handleSignedInResult(result, kind) {
    try {
      const saveFn = (patch) => setDoc(doc(db, ...integrationsDocPath(result.user.uid)), patch, { merge: true });
      const savePublicFn = (patch) => setDoc(doc(db, "profiles", result.user.uid), patch, { merge: true });
      if (kind === "google") await saveGoogleCredential(result, saveFn);
      else if (kind === "github") await saveGithubCredential(result, saveFn, savePublicFn);
      await savePublicIdentity(result.user.uid, result.user, savePublicFn);
    } catch (err) {
      console.error("Couldn't save Drive/GitHub credential:", err);
    }
  }

  async function handleSignIn(kind) {
    if (!firebaseConfigured) return;
    setError("");
    setPending(kind);
    // Inside the desktop shell, Google/GitHub/Microsoft sign-in happens in
    // the user's real browser instead of an embedded popup — see
    // lib/desktopAuth.js for why (the old embedded-popup approach got the
    // app flagged as malware). app/desktop-auth/page.js picks the flow back
    // up once it completes.
    if ((kind === "google" || kind === "github" || kind === "microsoft") && isDesktopApp()) {
      startDesktopSignIn(kind);
      return;
    }
    try {
      const provider = kind === "google" ? googleProvider : kind === "github" ? githubProvider : microsoftProvider;
      const result = await signInWithPopup(auth, provider);
      await handleSignedInResult(result, kind);
    } catch (err) {
      if (err.code === "auth/multi-factor-auth-required") {
        setLastKind(kind);
        setMfaError(err);
        return;
      }
      const msg = describeAuthError(err);
      if (msg) setError(msg);
    } finally {
      setPending(null);
    }
  }

  /** Email/password sign-in or account creation — no popup, no provider, works fine inside the desktop shell as-is since it's just a form on our own already-loaded page. */
  async function handleEmailAuth(e) {
    e.preventDefault();
    if (!firebaseConfigured) return;
    setError("");
    setResetSent(false);
    setEmailBusy(true);
    try {
      let result;
      if (authMode === "signup") {
        result = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name.trim()) await updateProfile(result.user, { displayName: name.trim() });
        sendEmailVerification(result.user).catch(() => {});
      } else {
        result = await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      await handleSignedInResult(result, "password");
    } catch (err) {
      if (err.code === "auth/multi-factor-auth-required") {
        setLastKind("password");
        setMfaError(err);
        return;
      }
      setError(describeAuthError(err, authMode === "signup" ? "Sign-up" : "Sign-in"));
    } finally {
      setEmailBusy(false);
    }
  }

  async function handleForgotPassword() {
    if (!firebaseConfigured) return;
    if (!email.trim()) {
      setError('Enter your email above, then click "Forgot password?" again.');
      return;
    }
    setError("");
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetSent(true);
    } catch (err) {
      setError(describeAuthError(err, "Password reset"));
    }
  }

  // LinkedIn doesn't go through Firebase's built-in OIDC provider (see
  // app/api/auth/linkedin/start/route.js for why) — instead it's a full
  // page redirect out to our own API route and back, landing here with
  // either a `linkedinToken` (a Firebase custom token to sign in with) or
  // a `linkedinError` in the URL.
  function handleLinkedInClick() {
    if (!firebaseConfigured) return;
    setPending("linkedin");
    window.location.href = "/api/auth/linkedin/start?return=/signin";
  }

  useEffect(() => {
    if (!firebaseConfigured) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("linkedinToken");
    const linkedinError = params.get("linkedinError");
    if (!token && !linkedinError) return;

    window.history.replaceState(null, "", window.location.pathname);

    if (linkedinError) {
      setError(linkedinError);
      return;
    }
    setPending("linkedin");
    signInWithCustomToken(auth, token)
      .then((result) => handleSignedInResult(result, "linkedin"))
      .catch((err) => {
        const msg = describeAuthError(err);
        setError(msg || "LinkedIn sign-in failed.");
      })
      .finally(() => setPending(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseConfigured]);

  async function handleMfaResolved(result) {
    setMfaError(null);
    await handleSignedInResult(result, lastKind);
  }

  if (mfaError) {
    return (
      <div className="shell">
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <MfaChallenge
            error={mfaError}
            onResolved={handleMfaResolved}
            onCancel={() => {
              setMfaError(null);
              signOut(auth).catch(() => {});
            }}
          />
        </div>
      </div>
    );
  }

  // Signed-in visitors here are mid-redirect (see the effect above) — show
  // nothing rather than a flash of the sign-in form.
  if (user) return <div className="shell" />;

  return (
    <div className="shell">
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div className="shell-card" style={{ width: "100%", maxWidth: 420 }}>
          <Link href="/" className="brand-wordmark" style={{ fontSize: 30, marginBottom: 6, display: "block", textDecoration: "none", color: "var(--s-text)" }}>
            Blueprint
          </Link>
          <div style={{ color: "var(--s-text-2)", fontSize: 14, marginBottom: 26 }}>
            Find the team for what you&rsquo;re building.
          </div>

          {!firebaseConfigured && <p className="notice">Auth isn&rsquo;t configured yet.</p>}
          {error && <p className="notice">{error}</p>}

          <form onSubmit={handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {authMode === "signup" && (
              <input
                type="text"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="shell-input"
                style={{ width: "100%", padding: 10, fontFamily: "inherit", fontSize: 14 }}
              />
            )}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="shell-input"
              style={{ width: "100%", padding: 10, fontFamily: "inherit", fontSize: 14 }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={authMode === "signup" ? "new-password" : "current-password"}
              className="shell-input"
              style={{ width: "100%", padding: 10, fontFamily: "inherit", fontSize: 14 }}
            />
            {authMode === "signin" && (
              <button
                type="button"
                onClick={handleForgotPassword}
                className="ghost"
                style={{ fontSize: 12, alignSelf: "flex-end", padding: 0 }}
              >
                Forgot password?
              </button>
            )}
            {resetSent && (
              <p style={{ fontSize: 12, color: "var(--s-text-2)" }}>Check your email for a reset link.</p>
            )}
            <button
              type="submit"
              className="shell-auth-btn primary"
              disabled={!firebaseConfigured || pending !== null || emailBusy}
            >
              {emailBusy
                ? authMode === "signup" ? "Creating account…" : "Signing in…"
                : authMode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setAuthMode(authMode === "signup" ? "signin" : "signup");
              setError("");
              setResetSent(false);
            }}
            className="ghost"
            style={{ fontSize: 12.5, marginTop: 12, width: "100%", textAlign: "center" }}
          >
            {authMode === "signup" ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0 16px" }}>
            <div style={{ flex: 1, height: 1, background: "var(--s-border)" }} />
            <span style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "var(--s-border)" }} />
          </div>

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
            onClick={() => handleSignIn("microsoft")}
            disabled={!firebaseConfigured || pending !== null}
          >
            <svg width="20" height="20" viewBox="0 0 23 23">
              <rect x="1" y="1" width="10" height="10" fill="#F25022" />
              <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
              <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
              <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
            </svg>
            {pending === "microsoft" ? "Signing in…" : "Continue with Microsoft"}
          </button>

          <button
            className="shell-auth-btn"
            onClick={handleLinkedInClick}
            disabled={!firebaseConfigured || pending !== null}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#0A66C2">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
            {pending === "linkedin" ? "Signing in…" : "Continue with LinkedIn"}
          </button>
        </div>
      </div>
    </div>
  );
}
