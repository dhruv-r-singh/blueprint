"use client";

// Shown when signInWithPopup throws auth/multi-factor-auth-required —
// meaning the identity provider step (Google/GitHub/LinkedIn) succeeded,
// but this account also has a second factor (phone or authenticator app)
// enrolled via /account, so sign-in isn't complete yet. Used on both "/"
// and "/join/[code]", the only two places sign-in happens.

import { useState } from "react";
import { getMultiFactorResolver, PhoneAuthProvider, PhoneMultiFactorGenerator } from "firebase/auth";
import { auth } from "../../lib/firebase";
import { getRecaptchaVerifier } from "../../lib/mfa";

export default function MfaChallenge({ error, onResolved, onCancel }) {
  let resolver = null;
  let resolverError = "";
  try {
    resolver = getMultiFactorResolver(auth, error);
  } catch (e) {
    resolverError = e.message || "Couldn't start the two-factor challenge — try signing in again.";
  }

  const [selectedHint, setSelectedHint] = useState(resolver?.hints?.[0] || null);
  const [step, setStep] = useState("choose"); // choose | code
  const [verificationId, setVerificationId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!resolver) {
    return (
      <div className="shell-card" style={{ maxWidth: 380 }}>
        <p style={{ fontSize: 13, color: "#e5534b", marginBottom: 16 }}>{resolverError}</p>
        <button className="shell-auth-btn" onClick={onCancel}>Back</button>
      </div>
    );
  }

  const isPhone = selectedHint?.factorId === PhoneMultiFactorGenerator.FACTOR_ID;

  async function sendCode() {
    setBusy(true);
    setErr("");
    try {
      if (isPhone) {
        const provider = new PhoneAuthProvider(auth);
        const verifier = getRecaptchaVerifier("mfa-recaptcha-container");
        const id = await provider.verifyPhoneNumber({ multiFactorHint: selectedHint, session: resolver.session }, verifier);
        setVerificationId(id);
      }
      setStep("code");
    } catch (e) {
      setErr(e.message || "Couldn't send the verification code.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    setBusy(true);
    setErr("");
    try {
      let assertion;
      if (isPhone) {
        const credential = PhoneAuthProvider.credential(verificationId, code);
        assertion = PhoneMultiFactorGenerator.assertion(credential);
      } else {
        const { TotpMultiFactorGenerator } = await import("firebase/auth");
        assertion = TotpMultiFactorGenerator.assertionForSignIn(selectedHint.uid, code);
      }
      const result = await resolver.resolveSignIn(assertion);
      onResolved(result);
    } catch (e) {
      setErr(e.message || "That code didn't work — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell-card" style={{ maxWidth: 380, width: "100%" }}>
      <div className="brand-wordmark" style={{ fontSize: 22, marginBottom: 10 }}>
        Verify it&rsquo;s you
      </div>

      {step === "choose" && (
        <>
          <p style={{ fontSize: 13, color: "var(--s-text-2)", marginBottom: 16 }}>
            This account has two-factor authentication on. Choose how to verify:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {resolver.hints.map((hint) => (
              <label
                key={hint.uid}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  border: `1px solid ${selectedHint?.uid === hint.uid ? "var(--s-amber)" : "var(--s-border)"}`,
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                <input type="radio" checked={selectedHint?.uid === hint.uid} onChange={() => setSelectedHint(hint)} />
                {hint.factorId === PhoneMultiFactorGenerator.FACTOR_ID ? `Text message · ${hint.displayName || hint.phoneNumber}` : `Authenticator app · ${hint.displayName || "TOTP"}`}
              </label>
            ))}
          </div>
          {err && <p style={{ fontSize: 12, color: "#e5534b", marginBottom: 12 }}>{err}</p>}
          <div id="mfa-recaptcha-container" />
          <button className="shell-auth-btn primary" onClick={sendCode} disabled={busy}>
            {busy ? "Sending…" : isPhone ? "Send code" : "Continue"}
          </button>
          <button className="shell-auth-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        </>
      )}

      {step === "code" && (
        <>
          <p style={{ fontSize: 13, color: "var(--s-text-2)", marginBottom: 16 }}>
            {isPhone ? "Enter the code we texted you." : "Enter the 6-digit code from your authenticator app."}
          </p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            autoFocus
            className="shell-input"
            style={{ width: "100%", marginBottom: 12, fontFamily: "inherit", fontSize: 15, padding: 10, textAlign: "center", letterSpacing: "0.2em" }}
          />
          {err && <p style={{ fontSize: 12, color: "#e5534b", marginBottom: 12 }}>{err}</p>}
          <button className="shell-auth-btn primary" onClick={confirmCode} disabled={busy || code.length < 6}>
            {busy ? "Verifying…" : "Verify"}
          </button>
          <button className="shell-auth-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        </>
      )}
    </div>
  );
}
