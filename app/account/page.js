"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  onAuthStateChanged,
  signOut,
  linkWithPopup,
  unlink,
  updateProfile,
} from "firebase/auth";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db, googleProvider, githubProvider, linkedinProvider } from "../../lib/firebase";
import { describeAuthError } from "../../lib/authErrors";
import {
  googleConfigured,
  githubConfigured,
  startGoogleConnect,
  startGithubConnect,
  exchangeGoogleCode,
  exchangeGithubCode,
  integrationsDocPath,
} from "../../lib/integrations";

const PROVIDERS = [
  {
    id: "google.com",
    label: "Google",
    provider: googleProvider,
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.85 2.09-1.81 2.73v2.27h2.92c1.71-1.57 2.69-3.88 2.69-6.64z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.17l-2.92-2.27c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34C2.44 15.98 5.48 18 9 18z" />
        <path fill="#FBBC05" d="M3.97 10.71A5.4 5.4 0 013.68 9c0-.59.1-1.17.29-1.71V4.96H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.04l3.01-2.33z" />
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
      </svg>
    ),
  },
  {
    id: "github.com",
    label: "GitHub",
    provider: githubProvider,
    icon: (
      <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    ),
  },
  {
    id: "oidc.linkedin",
    label: "LinkedIn",
    provider: linkedinProvider,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="#0A66C2">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
];

export default function AccountSettingsPage() {
  return (
    <Suspense fallback={<div className="shell" />}>
      <AccountSettingsInner />
    </Suspense>
  );
}

function AccountSettingsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState(undefined);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [profile, setProfile] = useState(null);
  const [integrationBusy, setIntegrationBusy] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setDisplayName(u?.displayName || "");
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, ...integrationsDocPath(user.uid)), (snap) => {
      setProfile(snap.exists() ? snap.data() : {});
    });
    return () => unsub();
  }, [user]);

  // Land back here from Google/GitHub's consent screen with ?code=&state=.
  useEffect(() => {
    if (!user) return;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (!code || !state) return;

    (async () => {
      setIntegrationBusy(state);
      setError("");
      try {
        if (state === "google") {
          const { access_token, refresh_token, expires_in } = await exchangeGoogleCode(code);
          await setDoc(
            doc(db, ...integrationsDocPath(user.uid)),
            {
              driveAccessToken: access_token,
              driveRefreshToken: refresh_token || profile?.driveRefreshToken || null,
              driveTokenExpiresAt: Date.now() + expires_in * 1000,
            },
            { merge: true }
          );
          setNotice("Google Drive connected.");
        } else if (state === "github") {
          const { access_token } = await exchangeGithubCode(code);
          await setDoc(doc(db, ...integrationsDocPath(user.uid)), { githubAccessToken: access_token }, { merge: true });
          setNotice("GitHub connected.");
        }
      } catch (err) {
        setError(err.message || "Connection failed.");
      } finally {
        setIntegrationBusy(null);
        router.replace("/account");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, searchParams]);

  async function disconnectDrive() {
    if (!user) return;
    await setDoc(doc(db, ...integrationsDocPath(user.uid)), { driveAccessToken: null, driveRefreshToken: null, driveTokenExpiresAt: null }, { merge: true });
  }
  async function disconnectGithub() {
    if (!user) return;
    await setDoc(doc(db, ...integrationsDocPath(user.uid)), { githubAccessToken: null }, { merge: true });
  }

  const linkedIds = new Set((user?.providerData || []).map((p) => p.providerId));

  async function handleConnect(entry) {
    setError("");
    setNotice("");
    setBusy(entry.id);
    try {
      await linkWithPopup(auth.currentUser, entry.provider);
      setUser({ ...auth.currentUser });
      setNotice(`${entry.label} connected.`);
    } catch (err) {
      const msg = describeAuthError(err, `Connecting ${entry.label}`);
      if (msg) setError(msg);
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect(entry) {
    setError("");
    setNotice("");
    if (linkedIds.size <= 1) {
      setError("You need at least one sign-in method connected — link another before removing this one.");
      return;
    }
    setBusy(entry.id);
    try {
      await unlink(auth.currentUser, entry.id);
      setUser({ ...auth.currentUser });
      setNotice(`${entry.label} disconnected.`);
    } catch (err) {
      const msg = describeAuthError(err, `Disconnecting ${entry.label}`);
      if (msg) setError(msg);
    } finally {
      setBusy(null);
    }
  }

  async function saveDisplayName() {
    if (!user || !displayName.trim() || displayName.trim() === user.displayName) return;
    setSavingName(true);
    try {
      await updateProfile(auth.currentUser, { displayName: displayName.trim() });
      setUser({ ...auth.currentUser });
    } catch (err) {
      setError("Couldn't update your name — " + (err.code || "try again"));
    } finally {
      setSavingName(false);
    }
  }

  return (
    <div className="shell">
      <div className="shell-topbar">
        <Link href="/profile" className="shell-topbar-right">
          <span className="shell-pname">← Profile</span>
        </Link>
      </div>

      <div className="shell-view" style={{ maxWidth: 560, margin: "0 auto", width: "100%" }}>
        {user === undefined && <p style={{ color: "var(--s-text-3)", fontSize: 13 }}>Loading…</p>}
        {user === null && <p style={{ color: "var(--s-text-3)", fontSize: 13 }}>Sign in to view account settings.</p>}

        {user && (
          <>
            <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 24, marginBottom: 24 }}>
              Account settings
            </h1>

            {error && <p className="notice">{error}</p>}
            {notice && <p className="notice" style={{ color: "var(--s-green, #5fbf8f)", borderColor: "var(--s-green, #5fbf8f)" }}>{notice}</p>}

            <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
              Display name
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 30 }}>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), saveDisplayName())}
                className="shell-input"
                style={{ flex: 1 }}
              />
              <button onClick={saveDisplayName} disabled={savingName} className="shell-task-add-btn" style={{ padding: "0 18px" }}>
                {savingName ? "Saving…" : "Save"}
              </button>
            </div>

            <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
              Connected accounts
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 30 }}>
              {PROVIDERS.map((entry) => {
                const connected = linkedIds.has(entry.id);
                return (
                  <div
                    key={entry.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 14px",
                      background: "var(--s-bg-side)",
                      border: "1px solid var(--s-border)",
                      borderRadius: 10,
                    }}
                  >
                    {entry.icon}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14 }}>{entry.label}</div>
                      <div style={{ fontSize: 12, color: connected ? "var(--s-green, #5fbf8f)" : "var(--s-text-3)" }}>
                        {connected ? "Connected" : "Not connected"}
                      </div>
                    </div>
                    <button
                      onClick={() => (connected ? handleDisconnect(entry) : handleConnect(entry))}
                      disabled={busy !== null}
                      style={{
                        padding: "8px 14px",
                        background: connected ? "transparent" : "var(--s-amber)",
                        color: connected ? "var(--s-text-2)" : "var(--s-amber-ink)",
                        border: connected ? "1px solid var(--s-border)" : "none",
                        borderRadius: 7,
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: busy !== null ? "not-allowed" : "pointer",
                      }}
                    >
                      {busy === entry.id ? "Working…" : connected ? "Disconnect" : "Connect"}
                    </button>
                  </div>
                );
              })}
            </div>

            <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
              Integrations
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 30 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14 }}>Google Drive</div>
                  <div style={{ fontSize: 12, color: profile?.driveAccessToken ? "var(--s-green, #5fbf8f)" : "var(--s-text-3)" }}>
                    {!googleConfigured() ? "Not set up on this deployment yet" : profile?.driveAccessToken ? "Connected" : "Not connected"}
                  </div>
                </div>
                <button
                  onClick={() => (profile?.driveAccessToken ? disconnectDrive() : startGoogleConnect())}
                  disabled={!googleConfigured() || integrationBusy !== null}
                  style={{
                    padding: "8px 14px",
                    background: profile?.driveAccessToken ? "transparent" : "var(--s-amber)",
                    color: profile?.driveAccessToken ? "var(--s-text-2)" : "var(--s-amber-ink)",
                    border: profile?.driveAccessToken ? "1px solid var(--s-border)" : "none",
                    borderRadius: 7,
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: !googleConfigured() ? "not-allowed" : "pointer",
                    opacity: googleConfigured() ? 1 : 0.5,
                  }}
                >
                  {integrationBusy === "google" ? "Connecting…" : profile?.driveAccessToken ? "Disconnect" : "Connect"}
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14 }}>GitHub (repos)</div>
                  <div style={{ fontSize: 12, color: profile?.githubAccessToken ? "var(--s-green, #5fbf8f)" : "var(--s-text-3)" }}>
                    {!githubConfigured() ? "Not set up on this deployment yet" : profile?.githubAccessToken ? "Connected" : "Not connected"}
                  </div>
                </div>
                <button
                  onClick={() => (profile?.githubAccessToken ? disconnectGithub() : startGithubConnect())}
                  disabled={!githubConfigured() || integrationBusy !== null}
                  style={{
                    padding: "8px 14px",
                    background: profile?.githubAccessToken ? "transparent" : "var(--s-amber)",
                    color: profile?.githubAccessToken ? "var(--s-text-2)" : "var(--s-amber-ink)",
                    border: profile?.githubAccessToken ? "1px solid var(--s-border)" : "none",
                    borderRadius: 7,
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: !githubConfigured() ? "not-allowed" : "pointer",
                    opacity: githubConfigured() ? 1 : 0.5,
                  }}
                >
                  {integrationBusy === "github" ? "Connecting…" : profile?.githubAccessToken ? "Disconnect" : "Connect"}
                </button>
              </div>
              <div style={{ fontSize: 11, color: "var(--s-text-3)" }}>
                Once connected, you can attach files/repos directly in a project&rsquo;s chat instead of pasting a link.
              </div>
            </div>

            <button onClick={() => signOut(auth)} className="shell-auth-btn" style={{ maxWidth: 200 }}>
              Sign out
            </button>
          </>
        )}
      </div>
    </div>
  );
}
