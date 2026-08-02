"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "../../../lib/firebase";

// Deliberately NOT wrapped in useAuthGate — that hook is what redirects
// here in the first place when profiles/{uid}.disabled is true, so gating
// this page the same way would just bounce right back (redirect loop). This
// does its own minimal check instead: signed out -> "/", signed in -> show
// the reactivate screen regardless of the disabled flag (reactivating is
// literally what clears it).
export default function AccountDisabledPage() {
  const router = useRouter();
  const [user, setUser] = useState(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) router.replace("/");
    });
    return () => unsub();
  }, [router]);

  async function reactivate() {
    if (!user) return;
    setBusy(true);
    try {
      await setDoc(doc(db, "profiles", user.uid), { disabled: false }, { merge: true });
      router.replace("/");
    } catch (err) {
      console.error("Couldn't reactivate account:", err);
      setBusy(false);
    }
  }

  if (!user) return <div className="shell" />;

  return (
    <div className="shell" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div className="shell-card" style={{ padding: 32, maxWidth: 420, textAlign: "center" }}>
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 20, marginBottom: 10 }}>
          Your account is disabled
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--s-text-2)", marginBottom: 22 }}>
          You disabled this account from Preferences. Reactivate it to pick up right where you left off. Nothing was deleted.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={reactivate} disabled={busy} className="shell-task-add-btn" style={{ padding: "10px 18px" }}>
            {busy ? "Reactivating…" : "Reactivate account"}
          </button>
          <button onClick={() => signOut(auth)} className="ghost" style={{ padding: "10px 18px" }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
