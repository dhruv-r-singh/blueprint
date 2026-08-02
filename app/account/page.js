"use client";

import { useEffect, useState } from "react";
import TopNav from "../components/TopNav";
import {
  onAuthStateChanged,
  signOut,
  linkWithPopup,
  reauthenticateWithPopup,
  unlink,
  updateProfile,
  PhoneMultiFactorGenerator,
} from "firebase/auth";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db, googleProvider, githubProvider, linkedinProvider } from "../../lib/firebase";
import { describeAuthError } from "../../lib/authErrors";
import { integrationsDocPath, saveGoogleCredential, saveGithubCredential, savePublicIdentity } from "../../lib/integrations";
import { useAuthGate } from "../../lib/useAuthGate";
import { qrCodeUrl } from "../../lib/inviteCode";
import {
  enrolledFactors,
  startPhoneEnrollment,
  confirmPhoneEnrollment,
  startTotpEnrollment,
  confirmTotpEnrollment,
  unenrollFactor,
} from "../../lib/mfa";

const PROVIDERS = [
  {
    id: "google.com",
    label: "Google",
    provider: googleProvider,
    integration: "drive",
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
    integration: "github",
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
    integration: null,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="#0A66C2">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
];

export default function AccountSettingsPage() {
  const [user, setUser] = useState(undefined);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [integrations, setIntegrations] = useState(null);
  const [mfaFactors, setMfaFactors] = useState([]);
  const [mfaMode, setMfaMode] = useState(null); // null | "phone" | "totp"
  const [mfaStep, setMfaStep] = useState("start"); // start | code
  const [phoneNumber, setPhoneNumber] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaVerificationId, setMfaVerificationId] = useState("");
  const [totpSecret, setTotpSecret] = useState(null);
  const [totpQrUri, setTotpQrUri] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaErrorMsg] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setDisplayName(u?.displayName || "");
      setMfaFactors(u ? enrolledFactors(u) : []);
    });
    return () => unsub();
  }, []);

  useAuthGate(user);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, ...integrationsDocPath(user.uid)), (snap) => {
      setIntegrations(snap.exists() ? snap.data() : {});
    });
    return () => unsub();
  }, [user]);

  const linkedIds = new Set((user?.providerData || []).map((p) => p.providerId));

  function saveFn() {
    return (patch) => setDoc(doc(db, ...integrationsDocPath(user.uid)), patch, { merge: true });
  }

  function hasIntegration(entry) {
    if (entry.integration === "drive") {
      return Boolean(integrations?.driveAccessToken) && Date.now() < (integrations?.driveTokenExpiresAt || 0);
    }
    if (entry.integration === "github") {
      return Boolean(integrations?.githubAccessToken);
    }
    return null; // no integration attached to this provider (LinkedIn)
  }

  // Used both for a fresh link (provider not yet connected) and for
  // refreshing an expired Drive token on an already-linked Google account.
  async function grantOrRefresh(entry, { refresh = false } = {}) {
    setError("");
    setNotice("");
    setBusy(entry.id);
    try {
      const result = refresh
        ? await reauthenticateWithPopup(auth.currentUser, entry.provider)
        : await linkWithPopup(auth.currentUser, entry.provider);
      setUser({ ...auth.currentUser });

      const savePublicFn = (patch) => setDoc(doc(db, "profiles", user.uid), patch, { merge: true });
      if (entry.integration === "drive") {
        const got = await saveGoogleCredential(result, saveFn());
        setNotice(got ? "Google Drive & Calendar connected." : "Signed in with Google, but Drive/Calendar access wasn't granted — try again and allow the permissions.");
      } else if (entry.integration === "github") {
        const got = await saveGithubCredential(result, saveFn(), savePublicFn);
        setNotice(got ? "GitHub connected." : "Signed in with GitHub, but repo access wasn't granted — try again and allow it.");
      } else {
        setNotice(`${entry.label} connected.`);
      }
      await savePublicIdentity(user.uid, auth.currentUser, savePublicFn);
    } catch (err) {
      const msg = describeAuthError(err, refresh ? `Refreshing ${entry.label}` : `Connecting ${entry.label}`);
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
      // The identity is gone, so any Drive/GitHub token tied to it is dead too.
      if (entry.integration === "drive") {
        await saveFn()({ driveAccessToken: null, driveTokenExpiresAt: null });
      } else if (entry.integration === "github") {
        await saveFn()({ githubAccessToken: null });
      }
      setNotice(`${entry.label} disconnected.`);
    } catch (err) {
      const msg = describeAuthError(err, `Disconnecting ${entry.label}`);
      if (msg) setError(msg);
    } finally {
      setBusy(null);
    }
  }

  function resetMfaFlow() {
    setMfaMode(null);
    setMfaStep("start");
    setPhoneNumber("");
    setMfaCode("");
    setMfaVerificationId("");
    setTotpSecret(null);
    setTotpQrUri("");
    setMfaErrorMsg("");
  }

  function mfaFriendlyError(err) {
    if (err.code === "auth/requires-recent-login") {
      return "This needs a fresh sign-in first — reconnect one of your accounts above (Connected accounts), then try again.";
    }
    return err.message || "Something went wrong — try again.";
  }

  async function handleSendPhoneCode(e) {
    e.preventDefault();
    if (!phoneNumber.trim()) return;
    setMfaBusy(true);
    setMfaErrorMsg("");
    try {
      const id = await startPhoneEnrollment(user, phoneNumber.trim(), "phone-mfa-recaptcha");
      setMfaVerificationId(id);
      setMfaStep("code");
    } catch (err) {
      setMfaErrorMsg(mfaFriendlyError(err));
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleConfirmPhoneCode(e) {
    e.preventDefault();
    setMfaBusy(true);
    setMfaErrorMsg("");
    try {
      await confirmPhoneEnrollment(user, mfaVerificationId, mfaCode.trim(), phoneNumber.trim());
      setMfaFactors(enrolledFactors(user));
      setNotice("Phone number added for two-factor sign-in.");
      resetMfaFlow();
    } catch (err) {
      setMfaErrorMsg(mfaFriendlyError(err));
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleStartTotp() {
    setMfaBusy(true);
    setMfaErrorMsg("");
    try {
      const { secret, otpauthUri } = await startTotpEnrollment(user, user.email || user.displayName || "account");
      setTotpSecret(secret);
      setTotpQrUri(otpauthUri);
      setMfaStep("code");
    } catch (err) {
      setMfaErrorMsg(mfaFriendlyError(err));
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleConfirmTotp(e) {
    e.preventDefault();
    setMfaBusy(true);
    setMfaErrorMsg("");
    try {
      await confirmTotpEnrollment(user, totpSecret, mfaCode.trim(), "Authenticator app");
      setMfaFactors(enrolledFactors(user));
      setNotice("Authenticator app added for two-factor sign-in.");
      resetMfaFlow();
    } catch (err) {
      setMfaErrorMsg(mfaFriendlyError(err));
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleRemoveFactor(factor) {
    setError("");
    setNotice("");
    try {
      await unenrollFactor(user, factor.uid);
      setMfaFactors(enrolledFactors(user));
      setNotice(`${factor.displayName || "That factor"} removed.`);
    } catch (err) {
      setError(mfaFriendlyError(err));
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

  if (!user) return <div className="shell" />;

  return (
    <div className="shell">
      <TopNav user={user} />

      <div className="shell-view" style={{ maxWidth: 560, margin: "0 auto", width: "100%" }}>
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
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {PROVIDERS.map((entry) => {
                const connected = linkedIds.has(entry.id);
                const integrated = hasIntegration(entry);
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
                      flexWrap: "wrap",
                    }}
                  >
                    {entry.icon}
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 14 }}>{entry.label}</div>
                      <div style={{ fontSize: 12, color: connected ? "var(--s-green, #5fbf8f)" : "var(--s-text-3)" }}>
                        {connected ? "Connected" : "Not connected"}
                      </div>
                      {entry.integration === "drive" && (
                        <div style={{ fontSize: 11, color: integrated ? "var(--s-green, #5fbf8f)" : "var(--s-text-3)", marginTop: 2 }}>
                          {integrated ? "Drive access active" : connected ? "Drive access expired or not granted" : "Also grants Drive access"}
                        </div>
                      )}
                      {entry.integration === "github" && (
                        <div style={{ fontSize: 11, color: integrated ? "var(--s-green, #5fbf8f)" : "var(--s-text-3)", marginTop: 2 }}>
                          {integrated ? "Repo access active" : connected ? "Repo access not granted" : "Also grants repo access"}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {connected && entry.integration && !integrated && (
                        <button
                          onClick={() => grantOrRefresh(entry, { refresh: true })}
                          disabled={busy !== null}
                          style={{ padding: "8px 14px", background: "var(--s-amber)", color: "var(--s-amber-ink)", border: "none", borderRadius: 7, fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, cursor: busy !== null ? "not-allowed" : "pointer" }}
                        >
                          {busy === entry.id ? "Working…" : entry.integration === "drive" ? "Refresh Drive access" : "Grant repo access"}
                        </button>
                      )}
                      <button
                        onClick={() => (connected ? handleDisconnect(entry) : grantOrRefresh(entry))}
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
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: "var(--s-text-3)", marginBottom: 30 }}>
              Connecting Google or GitHub here (or signing in with them) automatically enables project
              Drive folders / GitHub repos and chat attachments — no separate setup. Drive access is
              only good for about an hour at a time; if it lapses, use "Refresh Drive access" above.
            </div>

            <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
              Two-factor authentication
            </p>

            {mfaFactors.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                {mfaFactors.map((f) => (
                  <div key={f.uid} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10 }}>
                    <span style={{ flex: 1, fontSize: 13 }}>
                      {f.factorId === PhoneMultiFactorGenerator.FACTOR_ID ? "📱" : "🔐"} {f.displayName || (f.factorId === PhoneMultiFactorGenerator.FACTOR_ID ? f.phoneNumber : "Authenticator app")}
                    </span>
                    <button onClick={() => handleRemoveFactor(f)} style={{ padding: "6px 12px", background: "transparent", border: "1px solid var(--s-border)", color: "var(--s-text-2)", borderRadius: 7, fontFamily: "'DM Sans', sans-serif", fontSize: 12, cursor: "pointer" }}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            {mfaFactors.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--s-text-3)", marginBottom: 14 }}>Not turned on yet — every future sign-in will ask for a second factor once you add one.</p>
            )}

            {!mfaMode && (
              <div style={{ display: "flex", gap: 8, marginBottom: 30 }}>
                <button onClick={() => setMfaMode("phone")} style={{ padding: "8px 14px", background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)", color: "var(--s-text)", borderRadius: 7, fontFamily: "'DM Sans', sans-serif", fontSize: 12, cursor: "pointer" }}>
                  Add phone number
                </button>
                <button onClick={() => { setMfaMode("totp"); handleStartTotp(); }} style={{ padding: "8px 14px", background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)", color: "var(--s-text)", borderRadius: 7, fontFamily: "'DM Sans', sans-serif", fontSize: 12, cursor: "pointer" }}>
                  Add authenticator app
                </button>
              </div>
            )}

            {mfaMode === "phone" && mfaStep === "start" && (
              <form onSubmit={handleSendPhoneCode} className="shell-card" style={{ padding: 20, marginBottom: 30 }}>
                <p style={{ fontSize: 13, marginBottom: 12 }}>Enter your phone number (with country code, e.g. +1 555 555 0100).</p>
                <input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1 555 555 0100"
                  className="shell-input"
                  style={{ width: "100%", marginBottom: 12 }}
                />
                {mfaError && <p style={{ fontSize: 12, color: "#e5534b", marginBottom: 12 }}>{mfaError}</p>}
                <div id="phone-mfa-recaptcha" />
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" disabled={mfaBusy} className="shell-task-add-btn" style={{ padding: "8px 16px" }}>
                    {mfaBusy ? "Sending…" : "Send code"}
                  </button>
                  <button type="button" onClick={resetMfaFlow} className="ghost">Cancel</button>
                </div>
              </form>
            )}

            {mfaMode === "phone" && mfaStep === "code" && (
              <form onSubmit={handleConfirmPhoneCode} className="shell-card" style={{ padding: 20, marginBottom: 30 }}>
                <p style={{ fontSize: 13, marginBottom: 12 }}>Enter the code we texted to {phoneNumber}.</p>
                <input
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder="123456"
                  autoFocus
                  className="shell-input"
                  style={{ width: "100%", marginBottom: 12, textAlign: "center", letterSpacing: "0.2em" }}
                />
                {mfaError && <p style={{ fontSize: 12, color: "#e5534b", marginBottom: 12 }}>{mfaError}</p>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" disabled={mfaBusy || mfaCode.length < 6} className="shell-task-add-btn" style={{ padding: "8px 16px" }}>
                    {mfaBusy ? "Verifying…" : "Verify & enable"}
                  </button>
                  <button type="button" onClick={resetMfaFlow} className="ghost">Cancel</button>
                </div>
              </form>
            )}

            {mfaMode === "totp" && mfaStep === "start" && (
              <div className="shell-card" style={{ padding: 20, marginBottom: 30 }}>
                {mfaBusy && <p style={{ fontSize: 13 }}>Generating secret…</p>}
                {mfaError && <p style={{ fontSize: 12, color: "#e5534b" }}>{mfaError}</p>}
                {mfaError && (
                  <button type="button" onClick={resetMfaFlow} className="ghost">Cancel</button>
                )}
              </div>
            )}

            {mfaMode === "totp" && mfaStep === "code" && totpSecret && (
              <form onSubmit={handleConfirmTotp} className="shell-card" style={{ padding: 20, marginBottom: 30 }}>
                <p style={{ fontSize: 13, marginBottom: 12 }}>Scan this with your authenticator app (Google Authenticator, Authy, 1Password, etc.), or enter the key manually.</p>
                {totpQrUri && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrCodeUrl(totpQrUri, 180)} alt="TOTP QR code" style={{ display: "block", marginBottom: 12, borderRadius: 8, background: "#fff", padding: 8 }} />
                )}
                <p style={{ fontSize: 11, color: "var(--s-text-3)", marginBottom: 12, wordBreak: "break-all" }}>
                  Manual key: {totpSecret.secretKey}
                </p>
                <input
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder="123456"
                  autoFocus
                  className="shell-input"
                  style={{ width: "100%", marginBottom: 12, textAlign: "center", letterSpacing: "0.2em" }}
                />
                {mfaError && <p style={{ fontSize: 12, color: "#e5534b", marginBottom: 12 }}>{mfaError}</p>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="submit" disabled={mfaBusy || mfaCode.length < 6} className="shell-task-add-btn" style={{ padding: "8px 16px" }}>
                    {mfaBusy ? "Verifying…" : "Verify & enable"}
                  </button>
                  <button type="button" onClick={resetMfaFlow} className="ghost">Cancel</button>
                </div>
              </form>
            )}

            <button onClick={() => signOut(auth)} className="shell-auth-btn" style={{ maxWidth: 200 }}>
              Sign out
            </button>
          </>
        )}
      </div>
    </div>
  );
}
