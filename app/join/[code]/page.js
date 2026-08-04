"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithCustomToken,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
} from "firebase/auth";
import { collection, query, where, getDocs, doc, updateDoc, setDoc, arrayUnion } from "firebase/firestore";
import { auth, db, googleProvider, githubProvider, microsoftProvider } from "../../../lib/firebase";
import { describeAuthError } from "../../../lib/authErrors";
import { integrationsDocPath, saveGoogleCredential, saveGithubCredential, savePublicIdentity } from "../../../lib/integrations";
import { isDesktopApp, startDesktopSignIn } from "../../../lib/desktopAuth";
import MfaChallenge from "../../components/MfaChallenge";

export default function JoinPage() {
  const { code } = useParams();
  const router = useRouter();
  const [user, setUser] = useState(undefined);
  const [status, setStatus] = useState("checking"); // checking | not-found | joining | error
  const [error, setError] = useState("");
  const [project, setProject] = useState(null);
  const [pending, setPending] = useState(null);
  const [mfaError, setMfaError] = useState(null);
  const [lastKind, setLastKind] = useState(null);

  // Email/password sign-in — see app/signin/page.js for the same pattern.
  const [authMode, setAuthMode] = useState("signin"); // signin | signup
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user || !code) return;
    (async () => {
      try {
        const q = query(collection(db, "projects"), where("inviteCode", "==", code));
        const snap = await getDocs(q);
        if (snap.empty) {
          setStatus("not-found");
          return;
        }
        const p = { id: snap.docs[0].id, ...snap.docs[0].data() };
        setProject(p);

        if ((p.memberIds || []).includes(user.uid)) {
          router.replace(`/project/${p.id}`);
          return;
        }

        setStatus("joining");
        await updateDoc(doc(db, "projects", p.id), { memberIds: arrayUnion(user.uid) });
        router.replace(`/project/${p.id}`);
      } catch (err) {
        console.error("Join failed:", err);
        setError("Couldn't join that project. " + (err.code || err.message || "Try again."));
        setStatus("error");
      }
    })();
  }, [user, code, router]);

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
    setError("");
    setPending(kind);
    // See app/signin/page.js / lib/desktopAuth.js — inside the desktop
    // shell, Google/GitHub/Microsoft sign-in happens in the real browser,
    // not an embedded popup, and lands back on this same page via
    // desktop-auth.
    if ((kind === "google" || kind === "github" || kind === "microsoft") && isDesktopApp()) {
      startDesktopSignIn(kind, `/join/${code}`);
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

  /** Email/password sign-in or account creation — see app/signin/page.js. */
  async function handleEmailAuth(e) {
    e.preventDefault();
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

  // LinkedIn doesn't go through Firebase's built-in OIDC provider — see
  // app/api/auth/linkedin/start/route.js for why — it's a full page
  // redirect out and back instead, landing here with either a
  // `linkedinToken` or a `linkedinError` in the URL.
  function handleLinkedInClick() {
    setPending("linkedin");
    window.location.href = `/api/auth/linkedin/start?return=${encodeURIComponent(`/join/${code}`)}`;
  }

  useEffect(() => {
    if (!code) return;
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
  }, [code]);

  async function handleMfaResolved(result) {
    setMfaError(null);
    await handleSignedInResult(result, lastKind);
  }

  if (mfaError) {
    return (
      <div className="shell">
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <MfaChallenge error={mfaError} onResolved={handleMfaResolved} onCancel={() => setMfaError(null)} />
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div className="shell-card" style={{ width: "100%", maxWidth: 420 }}>
          <div className="brand-wordmark" style={{ fontSize: 26, marginBottom: 6 }}>
            Blueprint
          </div>

          {user === undefined && <div style={{ color: "var(--s-text-2)", fontSize: 14 }}>Loading…</div>}

          {user === null && (
            <>
              <div style={{ color: "var(--s-text-2)", fontSize: 14, marginBottom: 22 }}>
                Sign in to accept this invite.
              </div>
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
                <button type="submit" className="shell-auth-btn primary" disabled={pending !== null || emailBusy}>
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

              <button className="shell-auth-btn" onClick={() => handleSignIn("google")} disabled={pending !== null}>
                {pending === "google" ? "Signing in…" : "Continue with Google"}
              </button>
              <button className="shell-auth-btn" onClick={() => handleSignIn("github")} disabled={pending !== null}>
                {pending === "github" ? "Signing in…" : "Continue with GitHub"}
              </button>
              <button className="shell-auth-btn" onClick={() => handleSignIn("microsoft")} disabled={pending !== null}>
                {pending === "microsoft" ? "Signing in…" : "Continue with Microsoft"}
              </button>
              <button className="shell-auth-btn" onClick={handleLinkedInClick} disabled={pending !== null}>
                {pending === "linkedin" ? "Signing in…" : "Continue with LinkedIn"}
              </button>
            </>
          )}

          {user && status === "checking" && (
            <div style={{ color: "var(--s-text-2)", fontSize: 14 }}>Checking invite…</div>
          )}
          {user && status === "joining" && (
            <div style={{ color: "var(--s-text-2)", fontSize: 14 }}>
              Joining {project?.name || "the project"}…
            </div>
          )}
          {user && status === "not-found" && (
            <>
              <div style={{ color: "var(--s-text-2)", fontSize: 14, marginBottom: 12 }}>
                This invite link isn&rsquo;t valid. It may have been regenerated.
              </div>
              <button className="shell-auth-btn primary" onClick={() => router.push("/")}>
                Go to Blueprint
              </button>
            </>
          )}
          {user && status === "error" && <p className="notice">{error}</p>}
        </div>
      </div>
    </div>
  );
}
