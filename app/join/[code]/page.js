"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signInWithPopup } from "firebase/auth";
import { collection, query, where, getDocs, doc, updateDoc, arrayUnion } from "firebase/firestore";
import { auth, db, googleProvider, githubProvider, linkedinProvider } from "../../../lib/firebase";
import { describeAuthError } from "../../../lib/authErrors";

export default function JoinPage() {
  const { code } = useParams();
  const router = useRouter();
  const [user, setUser] = useState(undefined);
  const [status, setStatus] = useState("checking"); // checking | not-found | joining | error
  const [error, setError] = useState("");
  const [project, setProject] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user || !code) return;
    (async () => {
      try {
        const q = query(collection(db, "projects"), where("inviteCode", "==", code));
        const snap = await getDocs(q);
        if (snap.empty) {
          setStatus("not-found");
          return;
        }
        const p = { id: snap.docs[0].id, ...snap.docs[0].data() };
        setProject(p);

        if ((p.memberIds || []).includes(user.uid)) {
          router.replace(`/project/${p.id}`);
          return;
        }

        setStatus("joining");
        await updateDoc(doc(db, "projects", p.id), { memberIds: arrayUnion(user.uid) });
        router.replace(`/project/${p.id}`);
      } catch (err) {
        console.error("Join failed:", err);
        setError("Couldn't join that project — " + (err.code || err.message || "try again"));
        setStatus("error");
      }
    })();
  }, [user, code, router]);

  async function handleSignIn(kind) {
    setError("");
    setPending(kind);
    try {
      const provider = kind === "google" ? googleProvider : kind === "github" ? githubProvider : linkedinProvider;
      await signInWithPopup(auth, provider);
    } catch (err) {
      const msg = describeAuthError(err);
      if (msg) setError(msg);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="shell">
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div className="shell-card" style={{ width: "100%", maxWidth: 420 }}>
          <div className="brand-wordmark" style={{ fontSize: 26, marginBottom: 6 }}>
            Blueprint
          </div>

          {user === undefined && <div style={{ color: "var(--s-text-2)", fontSize: 14 }}>Loading…</div>}

          {user === null && (
            <>
              <div style={{ color: "var(--s-text-2)", fontSize: 14, marginBottom: 22 }}>
                Sign in to accept this invite.
              </div>
              {error && <p className="notice">{error}</p>}
              <button className="shell-auth-btn" onClick={() => handleSignIn("google")} disabled={pending !== null}>
                {pending === "google" ? "Signing in…" : "Continue with Google"}
              </button>
              <button className="shell-auth-btn" onClick={() => handleSignIn("github")} disabled={pending !== null}>
                {pending === "github" ? "Signing in…" : "Continue with GitHub"}
              </button>
              <button className="shell-auth-btn" onClick={() => handleSignIn("linkedin")} disabled={pending !== null}>
                {pending === "linkedin" ? "Signing in…" : "Continue with LinkedIn"}
              </button>
            </>
          )}

          {user && status === "checking" && (
            <div style={{ color: "var(--s-text-2)", fontSize: 14 }}>Checking invite…</div>
          )}
          {user && status === "joining" && (
            <div style={{ color: "var(--s-text-2)", fontSize: 14 }}>
              Joining {project?.name || "the project"}…
            </div>
          )}
          {user && status === "not-found" && (
            <>
              <div style={{ color: "var(--s-text-2)", fontSize: 14, marginBottom: 12 }}>
                This invite link isn&rsquo;t valid — it may have been regenerated.
              </div>
              <button className="shell-auth-btn primary" onClick={() => router.push("/")}>
                Go to Blueprint
              </button>
            </>
          )}
          {user && status === "error" && <p className="notice">{error}</p>}
        </div>
      </div>
    </div>
  );
}
