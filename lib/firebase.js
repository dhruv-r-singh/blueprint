import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider, OAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCIfXjit8gt2EUkEVuIpVDJ7_tGeNHcgv0",
  authDomain: "blueprint-drs.firebaseapp.com",
  projectId: "blueprint-drs",
  storageBucket: "blueprint-drs.firebasestorage.app",
  messagingSenderId: "385507025565",
  appId: "1:385507025565:web:df7f34575b75c09da42a74",
};

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Extra scopes so signing in with Google/GitHub also hands back a Drive /
// GitHub API access token (see lib/integrations.js) — no separate "Connect"
// step needed. Google will show these as additional consent items on the
// same sign-in popup; GitHub just silently includes "repo" in what it asks
// for, since GitHub OAuth Apps don't pre-declare scopes.
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("https://www.googleapis.com/auth/drive.file");
// Powers the shared per-project Calendar tab (lib/integrations.js
// createCalendarEvent/listCalendarEvents) — same access token as Drive,
// just with this extra scope granted alongside it.
googleProvider.addScope("https://www.googleapis.com/auth/calendar.events");

export const githubProvider = new GithubAuthProvider();
githubProvider.addScope("repo");

// Requires a custom OIDC provider named exactly "oidc.linkedin" configured
// in Firebase console → Authentication → Sign-in method → Add new provider →
// OpenID Connect, using LinkedIn's "Sign In with LinkedIn using OpenID
// Connect" product (client ID/secret from the LinkedIn Developer Portal,
// issuer https://www.linkedin.com/oauth). The redirect URI LinkedIn needs
// on its side is https://blueprint-drs.firebaseapp.com/__/auth/handler.
// See README.md for the full checklist.
export const linkedinProvider = new OAuthProvider("oidc.linkedin");
linkedinProvider.addScope("openid");
linkedinProvider.addScope("profile");
linkedinProvider.addScope("email");
linkedinProvider.setCustomParameters({ prompt: "consent" });
