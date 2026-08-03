"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TopNav from "../components/TopNav";
import Toggle from "../components/Toggle";
import {
  onAuthStateChanged,
  signOut,
  linkWithPopup,
  reauthenticateWithPopup,
  unlink,
  updateProfile,
  deleteUser,
  PhoneMultiFactorGenerator,
} from "firebase/auth";
import { doc, onSnapshot, setDoc, deleteDoc, updateDoc, collection, query, where, getDocs, arrayRemove } from "firebase/firestore";
import { auth, db, googleProvider, githubProvider, linkedinProvider } from "../../lib/firebase";
import { describeAuthError } from "../../lib/authErrors";
import { integrationsDocPath, saveGoogleCredential, saveGithubCredential, savePublicIdentity } from "../../lib/integrations";
import { useAuthGate } from "../../lib/useAuthGate";
import { qrCodeUrl } from "../../lib/inviteCode";
import { IconPhone, IconLock } from "../components/icons";
import ColorPicker from "../components/ColorPicker";
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

const PREF_TABS = [
  { key: "account", label: "My account" },
  { key: "voice", label: "Voice & Video" },
  { key: "appearance", label: "Appearance" },
  { key: "notifications", label: "Notifications" },
  { key: "accessibility", label: "Accessibility" },
  { key: "danger", label: "Danger zone" },
];

// Curated accent presets for the custom color picker — a spread of hues
// that all read fine as both a button fill (with computed contrast text)
// and an active-state highlight, in both light and dark mode.
const ACCENT_PRESETS = [
  { label: "Default", value: "" },
  { label: "Amber", value: "#e0a339" },
  { label: "Coral", value: "#e5534b" },
  { label: "Rose", value: "#e08a6f" },
  { label: "Violet", value: "#c46fd8" },
  { label: "Blue", value: "#6fa8d8" },
  { label: "Teal", value: "#4fb8b0" },
  { label: "Green", value: "#5fbf8f" },
];

// Same list translateMessage() in project/[id]/page.js accepts — kept here
// so the dropdown and the actual translate call can't drift apart.
const TRANSLATE_LANGUAGES = [
  { code: "", label: "Match my browser (default)" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

function sectionLabelStyle() {
  return { fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 };
}

export default function AccountSettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState(undefined);
  const [prefTab, setPrefTab] = useState("account");
  const [busy, setBusy] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [disablingAccount, setDisablingAccount] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [integrations, setIntegrations] = useState(null);
  const [profile, setProfile] = useState(null);
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
  const [micDevices, setMicDevices] = useState([]);
  const [camDevices, setCamDevices] = useState([]);
  const [deviceError, setDeviceError] = useState("");

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

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, "profiles", user.uid), (snap) => {
      setProfile(snap.exists() ? snap.data() : {});
    });
    return () => unsub();
  }, [user]);

  // Device labels are only populated once mic/camera permission has been
  // granted at least once — that's a browser privacy rule, not a bug here.
  useEffect(() => {
    if (prefTab !== "voice" || !navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        setMicDevices(devices.filter((d) => d.kind === "audioinput"));
        setCamDevices(devices.filter((d) => d.kind === "videoinput"));
      })
      .catch(() => setDeviceError("Couldn't list audio/video devices."));
  }, [prefTab]);

  const linkedIds = new Set((user?.providerData || []).map((p) => p.providerId));
  const prefs = profile?.preferences || {};

  function savePreference(patch) {
    if (!user) return;
    setDoc(doc(db, "profiles", user.uid), { preferences: { ...prefs, ...patch } }, { merge: true }).catch((err) =>
      console.error("Couldn't save preference:", err)
    );
  }

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
    return null; // no secondary integration status for LinkedIn
  }

  // LinkedIn "connected" doesn't come from Firebase Auth's providerData like
  // Google/GitHub — Firebase's OIDC connector can't actually complete a
  // LinkedIn linking flow (see app/api/auth/linkedin/start/route.js), so
  // "Connect" here saves straight to Firestore instead. See
  // app/api/auth/linkedin/link-start/route.js.
  function isLinkedinConnected() {
    return Boolean(integrations?.linkedinConnected);
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
        setNotice(got ? "Google Drive & Calendar connected." : "Signed in with Google, but Drive/Calendar access wasn't granted. Try again and allow the permissions.");
      } else if (entry.integration === "github") {
        const got = await saveGithubCredential(result, saveFn(), savePublicFn);
        setNotice(got ? "GitHub connected." : "Signed in with GitHub, but repo access wasn't granted. Try again and allow it.");
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

  // LinkedIn was never actually linked as a real Firebase Auth provider (see
  // isLinkedinConnected above), so this is a full-page redirect out to
  // LinkedIn and back — not a popup like Google/GitHub — landing back here
  // via the `linkedinLinked` / `linkedinError` query params handled below.
  async function handleLinkedInConnect() {
    setError("");
    setNotice("");
    setBusy("oidc.linkedin");
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch("/api/auth/linkedin/link-start", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ returnPath: "/account" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Couldn't start connecting LinkedIn.");
      window.location.href = data.url;
    } catch (err) {
      setError(err.message || "Couldn't connect LinkedIn.");
      setBusy(null);
    }
  }

  async function handleDisconnect(entry) {
    setError("");
    setNotice("");
    if (entry.id === "oidc.linkedin") {
      setBusy(entry.id);
      try {
        await saveFn()({ linkedinConnected: false });
        setNotice("LinkedIn disconnected.");
      } catch (err) {
        setError("Couldn't disconnect LinkedIn. " + (err.message || "Try again."));
      } finally {
        setBusy(null);
      }
      return;
    }
    if (linkedIds.size <= 1) {
      setError("You need at least one sign-in method connected. Link another before removing this one.");
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

  // Landing back here from the LinkedIn redirect (see handleLinkedInConnect).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get("linkedinLinked");
    const linkedinError = params.get("linkedinError");
    if (!linked && !linkedinError) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (linkedinError) setError(linkedinError);
    else setNotice("LinkedIn connected.");
  }, []);

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
      return "This needs a fresh sign-in first. Reconnect one of your accounts above (Connected accounts), then try again.";
    }
    return err.message || "Something went wrong. Try again.";
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
      setError("Couldn't update your name. " + (err.code || "Try again."));
    } finally {
      setSavingName(false);
    }
  }

  async function handleDisableAccount() {
    if (!user) return;
    if (!window.confirm("Disable your account? You'll be signed out immediately and won't be able to use Blueprint until you reactivate. Nothing is deleted, and you can undo this any time by signing back in.")) {
      return;
    }
    setDisablingAccount(true);
    setError("");
    try {
      await setDoc(doc(db, "profiles", user.uid), { disabled: true, disabledAt: Date.now() }, { merge: true });
      await signOut(auth);
      router.replace("/");
    } catch (err) {
      setError("Couldn't disable your account. " + (err.message || "Try again."));
      setDisablingAccount(false);
    }
  }

  async function handleDeleteAccount() {
    if (!user || deleteConfirmText.trim().toUpperCase() !== "DELETE") return;
    setDeletingAccount(true);
    setError("");
    try {
      // Pull the user out of every project they're a member of. Note:
      // projects they solely owned are left as-is (ownerId will point at a
      // now-deleted uid) — full ownership transfer/cleanup is out of scope
      // here; see SETUP_NOTES.md.
      const memberQ = query(collection(db, "projects"), where("memberIds", "array-contains", user.uid));
      const memberSnap = await getDocs(memberQ);
      await Promise.all(
        memberSnap.docs.map((d) =>
          updateDoc(doc(db, "projects", d.id), { memberIds: arrayRemove(user.uid) }).catch(() => {})
        )
      );

      await deleteDoc(doc(db, "profiles", user.uid, "private", "integrations")).catch(() => {});
      await deleteDoc(doc(db, "profiles", user.uid, "private", "google")).catch(() => {});
      await deleteDoc(doc(db, "profiles", user.uid)).catch(() => {});

      await deleteUser(auth.currentUser);
      router.replace("/");
    } catch (err) {
      if (err.code === "auth/requires-recent-login") {
        setError("This needs a fresh sign-in first. Reconnect one of your accounts above (Connected accounts), then try deleting again.");
      } else {
        setError("Couldn't delete your account. " + (err.message || "Try again."));
      }
      setDeletingAccount(false);
    }
  }

  if (!user) return <div className="shell" />;

  return (
    <div className="shell">
      <TopNav user={user} />

      <div className="shell-view" style={{ maxWidth: 880, margin: "0 auto", width: "100%", display: "flex", gap: 36, alignItems: "flex-start" }}>
        <div style={{ width: 170, flex: "none", position: "sticky", top: 32 }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 20, marginBottom: 18 }}>Preferences</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {PREF_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setPrefTab(t.key)}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 7,
                  border: "none",
                  background: prefTab === t.key ? "var(--s-bg-elevated)" : "transparent",
                  color: t.key === "danger" ? "#e5534b" : prefTab === t.key ? "var(--s-text)" : "var(--s-text-2)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 13,
                  fontWeight: prefTab === t.key ? 700 : 500,
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, maxWidth: 560 }}>
          {error && <p className="notice">{error}</p>}
          {notice && <p className="notice" style={{ color: "var(--s-green, #5fbf8f)", borderColor: "var(--s-green, #5fbf8f)" }}>{notice}</p>}

          {prefTab === "account" && (
            <>
              <p style={sectionLabelStyle()}>Display name</p>
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

              <p style={sectionLabelStyle()}>Connected accounts</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {PROVIDERS.map((entry) => {
                  const connected = entry.id === "oidc.linkedin" ? isLinkedinConnected() : linkedIds.has(entry.id);
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
                            className="shell-task-add-btn"
                            style={{ height: 36, fontSize: 12 }}
                          >
                            {busy === entry.id ? "Working…" : entry.integration === "drive" ? "Refresh Drive access" : "Grant repo access"}
                          </button>
                        )}
                        <button
                          onClick={() =>
                            connected
                              ? handleDisconnect(entry)
                              : entry.id === "oidc.linkedin"
                              ? handleLinkedInConnect()
                              : grantOrRefresh(entry)
                          }
                          disabled={busy !== null}
                          className={connected ? "shell-btn-outline" : "shell-task-add-btn"}
                          style={{ height: 36, fontSize: 12 }}
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
                Drive folders / GitHub repos and chat attachments, no separate setup needed. Drive access now
                renews itself in the background, so you shouldn't need "Refresh Drive access" above. It's
                there as a manual fallback if it ever does lapse.
              </div>

              <p style={sectionLabelStyle()}>Discoverability</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 30 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Discoverable</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>
                    Let other members find you on a project's Matches tab and invite you in, based on your
                    profile skills. Off hides you from every Matches list — existing projects you're already
                    on aren't affected.
                  </div>
                </div>
                <Toggle checked={prefs.discoverable !== false} onChange={(v) => savePreference({ discoverable: v })} />
              </div>

              <p style={sectionLabelStyle()}>Two-factor authentication</p>

              {mfaFactors.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                  {mfaFactors.map((f) => (
                    <div key={f.uid} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10 }}>
                      <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        {f.factorId === PhoneMultiFactorGenerator.FACTOR_ID ? <IconPhone size={14} /> : <IconLock size={14} />}
                        {f.displayName || (f.factorId === PhoneMultiFactorGenerator.FACTOR_ID ? f.phoneNumber : "Authenticator app")}
                      </span>
                      <button onClick={() => handleRemoveFactor(f)} className="shell-btn-outline" style={{ height: 32, fontSize: 12 }}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {mfaFactors.length === 0 && (
                <p style={{ fontSize: 12, color: "var(--s-text-3)", marginBottom: 14 }}>Not turned on yet. Every future sign-in will ask for a second factor once you add one.</p>
              )}

              {!mfaMode && (
                <div style={{ display: "flex", gap: 8, marginBottom: 30 }}>
                  <button onClick={() => setMfaMode("phone")} className="shell-btn-outline" style={{ fontSize: 12 }}>
                    Add phone number
                  </button>
                  <button onClick={() => { setMfaMode("totp"); handleStartTotp(); }} className="shell-btn-outline" style={{ fontSize: 12 }}>
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

              <button onClick={() => signOut(auth)} className="shell-btn-outline">
                Sign out
              </button>
            </>
          )}

          {prefTab === "voice" && (
            <>
              <p style={sectionLabelStyle()}>Input device (microphone)</p>
              <select
                value={prefs.micId || ""}
                onChange={(e) => savePreference({ micId: e.target.value })}
                className="shell-input"
                style={{ width: "100%", marginBottom: 20 }}
              >
                <option value="">System default</option>
                {micDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>
                ))}
              </select>

              <p style={sectionLabelStyle()}>Output device (camera)</p>
              <select
                value={prefs.camId || ""}
                onChange={(e) => savePreference({ camId: e.target.value })}
                className="shell-input"
                style={{ width: "100%", marginBottom: 12 }}
              >
                <option value="">System default</option>
                {camDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || "Camera"}</option>
                ))}
              </select>
              {deviceError && <p style={{ fontSize: 12, color: "#e5534b", marginBottom: 12 }}>{deviceError}</p>}
              <p style={{ fontSize: 11.5, color: "var(--s-text-3)", marginBottom: 24 }}>
                Used as the default the next time you start a Meeting in any project. Device names only show up
                once you've granted mic/camera permission at least once. That's your browser, not this app.
              </p>

              <p style={sectionLabelStyle()}>Joining a meeting</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10 }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>Join with camera off</div>
                    <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>You can always turn it back on once you're in.</div>
                  </div>
                  <Toggle checked={Boolean(prefs.camOffOnJoin)} onChange={(v) => savePreference({ camOffOnJoin: v })} />
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10 }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>Join with mic muted</div>
                    <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Starts every meeting muted until you unmute.</div>
                  </div>
                  <Toggle checked={Boolean(prefs.micOffOnJoin)} onChange={(v) => savePreference({ micOffOnJoin: v })} />
                </div>
              </div>
            </>
          )}

          {prefTab === "appearance" && (
            <>
              <p style={sectionLabelStyle()}>Theme</p>
              <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
                {[
                  { key: "dark", label: "Dark", swatchBg: "#202124", swatchBorder: "#333338" },
                  { key: "light", label: "Light", swatchBg: "#ffffff", swatchBorder: "#dcdce1" },
                ].map((t) => {
                  const active = (prefs.theme || "dark") === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => savePreference({ theme: t.key })}
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "12px 14px",
                        background: "var(--s-bg-side)",
                        border: active ? "1px solid var(--s-amber)" : "1px solid var(--s-border)",
                        borderRadius: 10,
                        cursor: "pointer",
                        fontFamily: "'DM Sans', sans-serif",
                        color: "var(--s-text)",
                      }}
                    >
                      <span style={{ width: 16, height: 16, borderRadius: "50%", background: t.swatchBg, border: `1px solid ${t.swatchBorder}`, flex: "none" }} />
                      <span style={{ fontSize: 13.5 }}>{t.label}</span>
                      {active && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--s-amber)" }}>✓</span>}
                    </button>
                  );
                })}
              </div>

              <p style={sectionLabelStyle()}>Accent color</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
                {ACCENT_PRESETS.map((p) => {
                  const active = (prefs.accentColor || "") === p.value;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      title={p.label}
                      onClick={() => savePreference({ accentColor: p.value })}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        cursor: "pointer",
                        padding: 0,
                        background: p.value || "repeating-conic-gradient(var(--s-bg-elevated) 0% 25%, var(--s-bg-hover) 0% 50%) 50% / 10px 10px",
                        border: active ? "2px solid var(--s-text)" : "2px solid var(--s-border)",
                        boxShadow: active ? "0 0 0 2px var(--s-bg-main), 0 0 0 3px var(--s-text)" : "none",
                      }}
                    />
                  );
                })}
              </div>
              {/* The actual custom picker — a draggable saturation/value
                  square plus a hue strip, not a typed hex field. */}
              <ColorPicker
                value={prefs.accentColor || "#e0a339"}
                onChange={(hex) => savePreference({ accentColor: hex })}
              />
              <p style={{ fontSize: 11.5, color: "var(--s-text-3)", marginBottom: 24 }}>
                Applies to buttons, active states, and highlights app-wide. &ldquo;Default&rdquo; matches the built-in monotone look.
              </p>

              <p style={sectionLabelStyle()}>Layout</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Compact mode</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Tighter spacing in chat and on task cards.</div>
                </div>
                <Toggle checked={Boolean(prefs.compactMode)} onChange={(v) => savePreference({ compactMode: v })} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Sharp corners</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Swaps the app's rounded cards/buttons for a crisper, squared-off look.</div>
                </div>
                <Toggle checked={prefs.cornerStyle === "sharp"} onChange={(v) => savePreference({ cornerStyle: v ? "sharp" : "rounded" })} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 24 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Sidebar on the right</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Moves the channel list and team rail to the right side of the screen.</div>
                </div>
                <Toggle checked={prefs.sidebarSide === "right"} onChange={(v) => savePreference({ sidebarSide: v ? "right" : "left" })} />
              </div>

              <p style={sectionLabelStyle()}>Chat display</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Always show timestamps</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Off shows a message's time only when you hover it, like most chat apps.</div>
                </div>
                <Toggle checked={Boolean(prefs.alwaysShowTimestamps)} onChange={(v) => savePreference({ alwaysShowTimestamps: v })} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 24 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>24-hour clock</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Show message times as 14:30 instead of 2:30 PM.</div>
                </div>
                <Toggle checked={Boolean(prefs.use24HourClock)} onChange={(v) => savePreference({ use24HourClock: v })} />
              </div>

              <p style={sectionLabelStyle()}>Calendar</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 24 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Week starts on Monday</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Affects the month grid on the Calendar tab. Off starts weeks on Sunday.</div>
                </div>
                <Toggle checked={Boolean(prefs.weekStartsMonday)} onChange={(v) => savePreference({ weekStartsMonday: v })} />
              </div>

              <p style={sectionLabelStyle()}>Your language</p>
              <select
                value={prefs.translateLanguage || ""}
                onChange={(e) => savePreference({ translateLanguage: e.target.value })}
                className="shell-input"
                style={{ width: "100%", marginBottom: 8 }}
              >
                {TRANSLATE_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
              <p style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>
                Chat messages translate into this language. Once a message resolves as already being in it, the Translate option drops off that message.
              </p>
            </>
          )}

          {prefTab === "notifications" && (
            <>
              <p style={sectionLabelStyle()}>Chat</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Sound on new message</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Plays a short chime when a teammate sends a message in a project you have open.</div>
                </div>
                <Toggle checked={Boolean(prefs.messageSound)} onChange={(v) => savePreference({ messageSound: v })} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Only for @mentions</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Limit the sound above to messages that mention you by name.</div>
                </div>
                <Toggle checked={Boolean(prefs.messageSoundMentionsOnly)} onChange={(v) => savePreference({ messageSoundMentionsOnly: v })} disabled={!prefs.messageSound} />
              </div>
              <div style={{ padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 10, opacity: prefs.messageSound ? 1 : 0.5 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Chime volume</div>
                  <span style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>{Math.round((prefs.chimeVolume ?? 0.6) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={prefs.chimeVolume ?? 0.6}
                  onChange={(e) => savePreference({ chimeVolume: Number(e.target.value) })}
                  disabled={!prefs.messageSound}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 24, opacity: prefs.messageSound ? 1 : 0.5 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Chime tone</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Pick which two-tone sound plays.</div>
                </div>
                <select
                  value={prefs.chimeTone || "classic"}
                  onChange={(e) => savePreference({ chimeTone: e.target.value })}
                  disabled={!prefs.messageSound}
                  className="shell-input"
                  style={{ width: 140 }}
                >
                  <option value="classic">Classic</option>
                  <option value="soft">Soft</option>
                  <option value="chirp">Chirp</option>
                  <option value="marimba">Marimba</option>
                </select>
              </div>

              <p style={sectionLabelStyle()}>Presence</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 24 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Auto-away</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>
                    Switch your status to &ldquo;Away&rdquo; after this long with no activity in the app, and back to
                    &ldquo;Available&rdquo; the moment you're back.
                  </div>
                </div>
                <select
                  value={prefs.autoAwayMinutes ?? 0}
                  onChange={(e) => savePreference({ autoAwayMinutes: Number(e.target.value) })}
                  className="shell-input"
                  style={{ width: 110 }}
                >
                  <option value={0}>Off</option>
                  <option value={5}>5 min</option>
                  <option value={15}>15 min</option>
                  <option value={30}>30 min</option>
                </select>
              </div>

              <p style={sectionLabelStyle()}>Composing</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Send with</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Shift+Enter is always a line break, either way.</div>
                </div>
                <select
                  value={prefs.sendShortcut || "enter"}
                  onChange={(e) => savePreference({ sendShortcut: e.target.value })}
                  className="shell-input"
                  style={{ width: 150 }}
                >
                  <option value="enter">Enter</option>
                  <option value="ctrlEnter">Ctrl/Cmd + Enter</option>
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Quick-react emoji</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Shown first when you hover a message, before opening the full picker.</div>
                </div>
                <select
                  value={prefs.defaultReactionEmoji || "👍"}
                  onChange={(e) => savePreference({ defaultReactionEmoji: e.target.value })}
                  className="shell-input"
                  style={{ width: 90, fontSize: 16 }}
                >
                  {["👍", "❤️", "😂", "🎉", "👀", "🔥"].map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Ask before deleting a message</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Off deletes your message immediately, no confirmation popup.</div>
                </div>
                <Toggle checked={prefs.confirmMessageDelete !== false} onChange={(v) => savePreference({ confirmMessageDelete: v })} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Auto-translate incoming messages</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Translates messages into your language automatically instead of needing the Translate action.</div>
                </div>
                <Toggle checked={Boolean(prefs.autoTranslate)} onChange={(v) => savePreference({ autoTranslate: v })} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Autoplay voice messages</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Plays a voice message as soon as it arrives instead of waiting for you to press play.</div>
                </div>
                <Toggle checked={Boolean(prefs.autoPlayVoiceMessages)} onChange={(v) => savePreference({ autoPlayVoiceMessages: v })} />
              </div>
            </>
          )}

          {prefTab === "accessibility" && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Reduce motion</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Turns off hover/transition animations app-wide.</div>
                </div>
                <Toggle checked={Boolean(prefs.reduceMotion)} onChange={(v) => savePreference({ reduceMotion: v })} />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Larger text</div>
                  <div style={{ fontSize: 11.5, color: "var(--s-text-3)" }}>Scales up the whole app slightly.</div>
                </div>
                <Toggle checked={Boolean(prefs.largerText)} onChange={(v) => savePreference({ largerText: v })} />
              </div>
            </>
          )}

          {prefTab === "danger" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid rgba(229, 83, 75, 0.35)", borderRadius: 10 }}>
              <div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13.5, marginBottom: 4 }}>Disable account</div>
                <div style={{ fontSize: 12, color: "var(--s-text-2)", marginBottom: 8 }}>
                  Signs you out and blocks access until you reactivate. Nothing is deleted.
                </div>
                <button
                  onClick={handleDisableAccount}
                  disabled={disablingAccount}
                  className="shell-btn-outline"
                  style={{ fontSize: 12 }}
                >
                  {disablingAccount ? "Disabling…" : "Disable account"}
                </button>
              </div>

              <div style={{ borderTop: "1px solid rgba(229, 83, 75, 0.25)", paddingTop: 14 }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13.5, marginBottom: 4 }}>Delete account</div>
                <div style={{ fontSize: 12, color: "var(--s-text-2)", marginBottom: 8 }}>
                  Permanently deletes your profile and sign-in. This can't be undone. Type <strong>DELETE</strong> to confirm.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="Type DELETE"
                    className="shell-input"
                    style={{ width: 160 }}
                  />
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deletingAccount || deleteConfirmText.trim().toUpperCase() !== "DELETE"}
                    className="shell-btn-danger"
                    style={{ fontSize: 12 }}
                  >
                    {deletingAccount ? "Deleting…" : "Delete account"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
