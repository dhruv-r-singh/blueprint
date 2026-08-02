"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";

export default function DashboardPage() {
  const [user, setUser] = useState(undefined);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      setProjects([]);
      setLoading(false);
      return;
    }
    const q = query(collection(db, "projects"), where("memberIds", "array-contains", user.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setProjects(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user]);

  return (
    <div className="shell">
      <div className="shell-topbar">
        {user && (
          <div className="shell-topbar-right" onClick={() => signOut(auth)} style={{ cursor: "pointer" }}>
            <span className="shell-pname">Sign out</span>
          </div>
        )}
      </div>

      <div className="shell-view" style={{ maxWidth: 760, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
          <div>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--s-text-3)" }}>
              Your projects
            </p>
            <h1 className="brand-wordmark" style={{ fontSize: 30, marginTop: 6 }}>
              Blueprint
            </h1>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link href="/profile" style={{ textDecoration: "none" }}>
              <button
                type="button"
                style={{
                  padding: "12px 20px",
                  background: "transparent",
                  color: "var(--s-text)",
                  border: "1px solid var(--s-border)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 12,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  borderRadius: 6,
                }}
              >
                Profile
              </button>
            </Link>
            <Link href="/create" style={{ textDecoration: "none" }}>
              <button
                type="button"
                style={{
                  padding: "12px 20px",
                  background: "var(--s-amber)",
                  color: "var(--s-amber-ink)",
                  border: "none",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 12,
                  fontWeight: 500,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  borderRadius: 6,
                }}
              >
                New project
              </button>
            </Link>
          </div>
        </div>

        {user === undefined && <p style={{ color: "var(--s-text-3)", fontSize: 13 }}>Checking sign-in…</p>}
        {user === null && <p style={{ color: "var(--s-text-3)", fontSize: 13 }}>Sign in to see your projects.</p>}
        {user && loading && <p style={{ color: "var(--s-text-3)", fontSize: 13 }}>Loading projects…</p>}
        {user && !loading && projects.length === 0 && (
          <p style={{ color: "var(--s-text-3)", fontSize: 13 }}>No projects yet — draft one to get started.</p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "var(--s-border)" }}>
          {projects.map((p) => (
            <Link key={p.id} href={`/project/${p.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div
                style={{
                  background: "var(--s-bg-side)",
                  padding: "16px 18px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                  flexWrap: "wrap",
                  cursor: "pointer",
                }}
              >
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--s-text-3)", marginTop: 4, maxWidth: "44ch" }}>{p.brief}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {(p.roles || []).map((r, i) => (
                      <span
                        key={i}
                        style={{
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: 10,
                          color: "var(--s-amber)",
                          border: "1px solid var(--s-border)",
                          padding: "2px 7px",
                          borderRadius: 6,
                        }}
                      >
                        {r.code}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
