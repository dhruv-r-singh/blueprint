"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, updateProfile } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth, db } from "../../lib/firebase";
import { searchSkills } from "../../lib/skillsCatalog";
import { useAuthGate } from "../../lib/useAuthGate";
import Autocomplete from "../components/Autocomplete";

// Shown once, right after account creation, before a brand-new user ever
// sees /create. Collects the bare minimum a teammate would want to know
// about you at a glance — display name, a one-line headline, a few skills —
// so a fresh profile isn't blank the first time anyone looks at it. Sets
// profiles/{uid}.onboarded = true when finished; app/page.js's post-sign-in
// redirect checks that flag and only sends first-timers here.
export default function OnboardingPage() {
  const router = useRouter();
  const [user, setUser] = useState(undefined);
  const [name, setName] = useState("");
  const [headline, setHeadline] = useState("");
  const [skills, setSkills] = useState([]);
  const [newSkill, setNewSkill] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) setName(u.displayName || "");
    });
    return () => unsub();
  }, []);

  useAuthGate(user);

  function addSkill(skill) {
    const value = (skill ?? newSkill).trim();
    if (!value || skills.includes(value)) return;
    setSkills((prev) => [...prev, value]);
    setNewSkill("");
  }

  function removeSkill(i) {
    setSkills((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function finishOnboarding(e) {
    e.preventDefault();
    if (!user || !name.trim()) return;
    setSaving(true);
    setError("");
    try {
      if (name.trim() !== user.displayName) {
        await updateProfile(auth.currentUser, { displayName: name.trim() });
      }
      await setDoc(
        doc(db, "profiles", user.uid),
        {
          name: name.trim(),
          headline: headline.trim(),
          skills,
          onboarded: true,
        },
        { merge: true }
      );
      router.replace("/create");
    } catch (err) {
      setError("Couldn't save that — " + (err.message || "try again"));
      setSaving(false);
    }
  }

  async function skipForNow() {
    if (!user) return;
    setSaving(true);
    try {
      await setDoc(doc(db, "profiles", user.uid), { onboarded: true }, { merge: true });
      router.replace("/create");
    } catch (err) {
      setError("Couldn't continue — " + (err.message || "try again"));
      setSaving(false);
    }
  }

  if (!user) return <div className="shell" />;

  return (
    <div className="shell">
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <form onSubmit={finishOnboarding} className="shell-card" style={{ width: "100%", maxWidth: 460, padding: 28 }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 22, marginBottom: 6 }}>
            Welcome — quick intro first
          </div>
          <div style={{ color: "var(--s-text-2)", fontSize: 13.5, marginBottom: 24 }}>
            Just enough so teammates know who you are before you start (or join) a project. Takes a minute.
          </div>

          {error && <p className="notice">{error}</p>}

          <label style={{ fontSize: 11, color: "var(--s-text-3)", display: "block", marginBottom: 6 }}>Display name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="How should people see your name?"
            className="shell-input"
            style={{ width: "100%", marginBottom: 18 }}
            autoFocus
          />

          <label style={{ fontSize: 11, color: "var(--s-text-3)", display: "block", marginBottom: 6 }}>Headline (optional)</label>
          <input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="e.g. Mechanical engineering student · CAD & prototyping"
            className="shell-input"
            style={{ width: "100%", marginBottom: 18 }}
          />

          <label style={{ fontSize: 11, color: "var(--s-text-3)", display: "block", marginBottom: 6 }}>Skills (optional)</label>
          <Autocomplete
            value={newSkill}
            onChange={setNewSkill}
            search={(q) => searchSkills(q, skills)}
            onSelect={(item) => addSkill(item)}
            onEnter={(e) => (e.preventDefault(), addSkill())}
            placeholder="Add a skill and press Enter"
            style={{ marginBottom: 10 }}
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
          {skills.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
              {skills.map((s, i) => (
                <span
                  key={s}
                  onClick={() => removeSkill(i)}
                  style={{ fontSize: 12, padding: "5px 10px", background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)", borderRadius: 999, cursor: "pointer", color: "var(--s-text-2)" }}
                  title="Remove"
                >
                  {s} ×
                </span>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <button type="submit" disabled={saving || !name.trim()} className="shell-task-add-btn" style={{ padding: "10px 20px" }}>
              {saving ? "Saving…" : "Continue"}
            </button>
            <button type="button" onClick={skipForNow} disabled={saving} className="ghost">
              Skip for now
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
