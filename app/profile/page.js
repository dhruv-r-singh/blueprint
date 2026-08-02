"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { searchSkills } from "../../lib/skillsCatalog";
import Autocomplete from "../components/Autocomplete";

export default function ProfilePage() {
  const [user, setUser] = useState(undefined);
  const [skills, setSkills] = useState([]);
  const [newSkill, setNewSkill] = useState("");
  const [headline, setHeadline] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const snap = await getDoc(doc(db, "profiles", user.uid));
      if (snap.exists()) {
        setSkills(snap.data().skills || []);
        setHeadline(snap.data().headline || "");
      }
    })();
  }, [user]);

  async function saveProfile(nextSkills, nextHeadline) {
    if (!user) return;
    setSaving(true);
    try {
      await setDoc(
        doc(db, "profiles", user.uid),
        { skills: nextSkills, headline: nextHeadline, name: user.displayName || user.email },
        { merge: true }
      );
    } catch (err) {
      console.error("Failed to save profile:", err);
    } finally {
      setSaving(false);
    }
  }

  function addSkill(skill) {
    const value = (skill ?? newSkill).trim();
    if (!value || skills.includes(value)) return;
    const next = [...skills, value];
    setSkills(next);
    setNewSkill("");
    saveProfile(next, headline);
  }

  function removeSkill(i) {
    const next = skills.filter((_, idx) => idx !== i);
    setSkills(next);
    saveProfile(next, headline);
  }

  return (
    <div className="shell">
      <div className="shell-topbar">
        <Link href="/" className="shell-topbar-right">
          <span className="shell-pname">← Back</span>
        </Link>
        <Link href="/account" className="shell-topbar-right" style={{ marginLeft: 8 }}>
          <span className="shell-pname">Settings</span>
        </Link>
      </div>

      <div className="shell-view" style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>
        {user === undefined && <p style={{ color: "var(--s-text-3)", fontSize: 13 }}>Loading…</p>}
        {user === null && <p style={{ color: "var(--s-text-3)", fontSize: 13 }}>Sign in to view your profile.</p>}

        {user && (
          <>
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 28 }}>
              {user.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.photoURL} alt="" style={{ width: 64, height: 64, borderRadius: "50%" }} />
              ) : (
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    background: "var(--s-bg-elevated)",
                    border: "1px solid var(--s-border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "'DM Sans', sans-serif",
                    fontWeight: 600,
                    fontSize: 20,
                  }}
                >
                  {(user.displayName || user.email || "?")[0].toUpperCase()}
                </div>
              )}
              <div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 22 }}>
                  {user.displayName || user.email}
                </div>
                <input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  onBlur={() => saveProfile(skills, headline)}
                  placeholder="Add a headline — e.g. Firmware & embedded systems"
                  style={{
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--s-border)",
                    color: "var(--s-text-2)",
                    fontSize: 13,
                    padding: "4px 0",
                    width: 320,
                  }}
                />
              </div>
            </div>

            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
              Skills
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {skills.map((s, i) => (
                <span key={i} className="shell-mini-chip" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {s}
                  <span onClick={() => removeSkill(i)} style={{ cursor: "pointer" }}>×</span>
                </span>
              ))}
              {skills.length === 0 && (
                <span style={{ fontSize: 12, color: "var(--s-text-3)" }}>No skills added yet.</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Autocomplete
                value={newSkill}
                onChange={setNewSkill}
                search={(q) => searchSkills(q, skills)}
                onSelect={(item) => addSkill(item)}
                onEnter={(e) => (e.preventDefault(), addSkill())}
                placeholder="Add a skill and press Enter"
                style={{ flex: 1 }}
                inputStyle={{
                  background: "var(--s-bg-side)",
                  border: "1px solid var(--s-border)",
                  color: "var(--s-text)",
                  padding: 10,
                  fontSize: 13,
                  width: "100%",
                  borderRadius: 6,
                  fontFamily: "inherit",
                }}
              />
              <button
                onClick={() => addSkill()}
                style={{
                  padding: "10px 16px",
                  background: "var(--s-amber)",
                  color: "var(--s-amber-ink)",
                  border: "none",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 12,
                  cursor: "pointer",
                  borderRadius: 6,
                }}
              >
                Add
              </button>
            </div>
            {saving && <p style={{ fontSize: 11, color: "var(--s-text-3)", marginTop: 8 }}>Saving…</p>}
          </>
        )}
      </div>
    </div>
  );
}
