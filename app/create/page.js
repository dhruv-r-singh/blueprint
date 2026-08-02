"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../../lib/firebase";

export default function CreateProjectPage() {
  const router = useRouter();
  const [user, setUser] = useState(undefined);
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!user) {
      setError("Sign in before creating a project.");
      return;
    }
    if (!name.trim()) {
      setError("Give your project a name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const ref = await addDoc(collection(db, "projects"), {
        name: name.trim(),
        brief: brief.trim(),
        roles: [],
        ownerId: user.uid,
        ownerName: user.displayName || user.email || "Unknown",
        memberIds: [user.uid],
        createdAt: serverTimestamp(),
      });
      router.push(`/project/${ref.id}`);
    } catch (err) {
      console.error(err);
      setError("Couldn't create the project — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="shell">
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <form onSubmit={handleCreate} className="shell-card" style={{ width: "100%", maxWidth: 440 }}>
          <div style={{ fontWeight: 700, fontSize: 24, marginBottom: 6 }}>New project</div>
          <div style={{ color: "var(--s-text-2)", fontSize: 14, marginBottom: 22 }}>
            Give it a name and a quick description — you can flesh out roles and tasks inside.
          </div>

          {error && <p className="notice">{error}</p>}

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            autoFocus
            className="shell-input"
            style={{ width: "100%", marginBottom: 12 }}
          />

          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="What is this project? (optional)"
            rows={3}
            className="shell-input"
            style={{ width: "100%", marginBottom: 16, resize: "vertical", fontFamily: "inherit" }}
          />

          <button type="submit" disabled={saving} className="shell-auth-btn primary">
            {saving ? "Creating…" : "Create project"}
          </button>
        </form>
      </div>
    </div>
  );
}
