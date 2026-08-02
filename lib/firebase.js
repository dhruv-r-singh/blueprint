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

export const linkedinProvider = new OAuthProvider("oidc.linkedin");
linkedinProvider.addScope("openid");
linkedinProvider.addScope("profile");
linkedinProvider.addScope("email");
