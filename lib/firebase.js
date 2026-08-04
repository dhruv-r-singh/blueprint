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
// Needed specifically for the "Connect GitHub" toggle in project Settings
// to be able to delete the repo again when someone switches it off —
// GitHub gates repo deletion behind this scope separately from the plain
// "repo" scope above, on purpose (deleting a repo is irreversible). Anyone
// who connected GitHub before this line existed will need to reconnect
// (Preferences → Connected accounts) before deletion works for them; repo
// creation and everything else already worked fine either way.
githubProvider.addScope("delete_repo");

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

// Unlike LinkedIn, "microsoft.com" is a real first-class Firebase Auth
// provider (Firebase's backend talks to Microsoft's token endpoint directly,
// no generic-OIDC Basic-Auth mismatch to work around) — just needs enabling
// in Firebase console → Authentication → Sign-in method → Microsoft, with an
// Application (client) ID/secret from an Azure AD app registration. See
// SETUP_NOTES.md. `common` allows both personal Microsoft accounts and
// work/school (Azure AD) accounts to sign in.
export const microsoftProvider = new OAuthProvider("microsoft.com");
microsoftProvider.addScope("openid");
microsoftProvider.addScope("profile");
microsoftProvider.addScope("email");
microsoftProvider.setCustomParameters({ prompt: "select_account", tenant: "common" });
