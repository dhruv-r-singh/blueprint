"use client";

// Two-factor auth: phone (SMS) and authenticator app (TOTP), on top of
// whatever provider a user originally signed in with (Google/GitHub/
// LinkedIn). This is Firebase Auth's built-in multi-factor auth — it isn't
// tied to a specific first-factor provider, so once enrolled, EVERY future
// sign-in (regardless of provider) will pause and demand the second factor.
//
// Real prerequisites this code can't set up on its own — see SETUP_NOTES.md:
//   - Multi-factor auth has to be turned on for the Firebase project
//     (Authentication → Sign-in method → Advanced → Multi-factor auth),
//     which on some projects requires upgrading to the Blaze (pay-as-you-go)
//     plan, since SMS delivery isn't free.
//   - TOTP (authenticator app) support needs a reasonably recent Firebase
//     JS SDK (10.9+). This module feature-detects it and fails with a clear
//     message instead of crashing if the installed SDK is older.

import {
  multiFactor,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
} from "firebase/auth";
import { auth } from "./firebase";

export function enrolledFactors(user) {
  try {
    return multiFactor(user).enrolledFactors || [];
  } catch {
    return [];
  }
}

/** Lazily creates (and reuses) an invisible reCAPTCHA bound to `containerId`. */
let recaptchaVerifier = null;
export function getRecaptchaVerifier(containerId) {
  if (recaptchaVerifier) return recaptchaVerifier;
  recaptchaVerifier = new RecaptchaVerifier(auth, containerId, { size: "invisible" });
  return recaptchaVerifier;
}

/** Step 1 of phone enrollment: sends the SMS code. Returns a verificationId. */
export async function startPhoneEnrollment(user, phoneNumber, containerId) {
  const session = await multiFactor(user).getSession();
  const verifier = getRecaptchaVerifier(containerId);
  const provider = new PhoneAuthProvider(auth);
  return provider.verifyPhoneNumber({ phoneNumber, session }, verifier);
}

/** Step 2 of phone enrollment: confirms the SMS code and enrolls the factor. */
export async function confirmPhoneEnrollment(user, verificationId, code, displayName = "Phone") {
  const credential = PhoneAuthProvider.credential(verificationId, code);
  const assertion = PhoneMultiFactorGenerator.assertion(credential);
  await multiFactor(user).enroll(assertion, displayName);
}

/**
 * Step 1 of authenticator-app enrollment: generates a TOTP secret + an
 * otpauth:// URI you can turn into a QR code (see lib/inviteCode.js's
 * qrCodeUrl, reused for this). Throws a clear error if the installed
 * Firebase SDK doesn't support TOTP yet.
 */
export async function startTotpEnrollment(user, accountLabel = "Blueprint") {
  let TotpMultiFactorGenerator;
  try {
    ({ TotpMultiFactorGenerator } = await import("firebase/auth"));
    if (!TotpMultiFactorGenerator?.generateSecret) throw new Error("missing");
  } catch {
    throw new Error("Authenticator-app 2FA needs a newer Firebase SDK version than this project currently has installed (firebase 10.9+). SMS-based 2FA works either way.");
  }
  const session = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  const otpauthUri = secret.generateQrCodeUrl(accountLabel, "Blueprint");
  return { secret, otpauthUri };
}

/** Step 2 of authenticator-app enrollment: confirms the 6-digit code. */
export async function confirmTotpEnrollment(user, secret, oneTimeCode, displayName = "Authenticator app") {
  const { TotpMultiFactorGenerator } = await import("firebase/auth");
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, oneTimeCode);
  await multiFactor(user).enroll(assertion, displayName);
}

export async function unenrollFactor(user, factorUid) {
  await multiFactor(user).unenroll(factorUid);
}
