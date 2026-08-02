import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider, OAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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
export const googleProvider = new GoogleAuthProvider();
export const githubProvider = new GithubAuthProvider();

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
