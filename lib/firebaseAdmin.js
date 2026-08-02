// Server-only Firebase Admin SDK singleton. Used exclusively by the
// app/api/oauth/google/* route handlers to (a) verify the Firebase ID token
// a client sends along with a request, and (b) read/write the server-only
// profiles/{uid}/private/google document that holds a user's Drive/Calendar
// refresh token. The Admin SDK bypasses Firestore security rules entirely,
// so this document never needs a client-facing rule at all — nothing but
// this file (running on the server, never shipped to the browser) can ever
// touch it.
//
// NEVER import this from a "use client" file or anything that runs in the
// browser — it needs the `firebase-admin` package (server-only) and a
// service account key, and would either crash or leak credentials if
// bundled client-side.
//
// Requires:
//   - `firebase-admin` added as a dependency (npm install firebase-admin)
//   - FIREBASE_SERVICE_ACCOUNT_KEY env var — the full JSON of a service
//     account key, as a single-line string. See SETUP_NOTES.md for how to
//     generate one and where to set it in Vercel.
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function credentialFromEnv() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY is not set — see SETUP_NOTES.md for how to generate and add it."
    );
  }
  return cert(JSON.parse(raw));
}

const adminApp = getApps().length ? getApps()[0] : initializeApp({ credential: credentialFromEnv() });

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);

/**
 * Verifies the "Authorization: Bearer <idToken>" header on a Next.js
 * Request and returns the caller's uid, or throws a plain Error with a
 * message safe to send straight back to the client.
 */
export async function requireUid(request) {
  const authHeader = request.headers.get("authorization") || "";
  const idToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!idToken) throw new Error("Missing Authorization header.");
  const decoded = await adminAuth.verifyIdToken(idToken);
  return decoded.uid;
}
