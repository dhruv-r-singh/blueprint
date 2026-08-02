"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { auth, db, firebaseConfigured } from "../lib/firebase";
import ParticlesBackground from "./components/ParticlesBackground";

const FEATURES = [
  {
    title: "Find your team",
    desc: "Post the roles your project needs and get matched with people whose skills actually fit — not just whoever saw the group chat first.",
  },
  {
    title: "Everything in one place",
    desc: "Tasks, chat, meetings, a shared whiteboard, and calendar — no juggling five different apps to keep a project moving.",
  },
  {
    title: "Your tools, connected",
    desc: "Sign in once and Blueprint can spin up a Drive folder and a GitHub repo for you automatically, ready the moment your team is.",
  },
];

export default function Page() {
  const router = useRouter();
  const [user, setUser] = useState(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firebaseConfigured) {
      setUser(null);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  // Once signed in, skip the marketing page entirely — go straight into the
  // most recent project, or straight into project creation if there isn't
  // one yet. First-time users (no projects yet AND never finished
  // onboarding) go to /onboarding instead, exactly once, before ever
  // seeing /create.
  //
  // Deliberately NOT using orderBy() + limit() here: that combined with the
  // where("memberIds", ...) filter requires a Firestore composite index. If
  // that index doesn't exist, the query throws, lands in the catch block
  // below, and silently sends everyone to /create — even people who already
  // have projects. Fetching all of the user's projects (cheap; a person has
  // at most a handful) and sorting client-side avoids depending on an index
  // that may not have been created in the Firebase console.
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const q = query(collection(db, "projects"), where("memberIds", "array-contains", user.uid));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          projects.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
          router.replace(`/project/${projects[0].id}`);
          return;
        }
        const profileSnap = await getDoc(doc(db, "profiles", user.uid));
        if (!profileSnap.exists() || !profileSnap.data()?.onboarded) {
          router.replace("/onboarding");
        } else {
          router.replace("/create");
        }
      } catch (err) {
        console.error("Redirect lookup failed:", err);
        setError("Couldn't load your projects — " + (err.code || err.message || "try again"));
      }
    })();
  }, [user, router]);

  // Signed-in visitors here are mid-redirect (see the effect above) — show
  // nothing rather than a flash of the marketing page.
  if (user) return <div className="shell" />;

  return (
    <div className="shell" style={{ overflowY: "auto" }}>
      <div style={{ position: "relative", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <ParticlesBackground particleCount={300} speed={0.3} />

        <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "26px 32px" }}>
            <span className="brand-wordmark" style={{ fontSize: 20 }}>Blueprint</span>
            <Link
              href="/signin"
              className="shell-task-add-btn"
              style={{ textDecoration: "none", height: 36, padding: "0 18px", fontSize: 12.5 }}
            >
              Sign in
            </Link>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "40px 24px" }}>
            <div className="brand-wordmark" style={{ fontSize: "clamp(40px, 7vw, 72px)", lineHeight: 1.05, marginBottom: 18 }}>
              Blueprint
            </div>
            <p style={{ fontSize: "clamp(15px, 2vw, 19px)", color: "var(--s-text-2)", maxWidth: 520, marginBottom: 34, lineHeight: 1.5 }}>
              Find the team for what you&rsquo;re building — then run the whole project without leaving the tab.
            </p>

            {error && <p className="notice" style={{ maxWidth: 420 }}>{error}</p>}
            {!firebaseConfigured && <p className="notice" style={{ maxWidth: 420 }}>Auth isn&rsquo;t configured yet.</p>}

            <Link
              href="/signin"
              className="shell-auth-btn primary"
              style={{ width: "auto", margin: 0, padding: "14px 32px", textDecoration: "none" }}
            >
              Get started
            </Link>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 20,
              maxWidth: 960,
              width: "100%",
              margin: "0 auto",
              padding: "0 32px 56px",
            }}
          >
            {FEATURES.map((f) => (
              <div
                key={f.title}
                style={{
                  padding: "20px 22px",
                  background: "rgba(255,255,255,0.03)",
                  backdropFilter: "blur(6px)",
                  border: "1px solid var(--s-border)",
                  borderRadius: 14,
                }}
              >
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{f.title}</div>
                <div style={{ fontSize: 13, color: "var(--s-text-2)", lineHeight: 1.5 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
