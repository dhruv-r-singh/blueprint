"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, addDoc, doc, onSnapshot, updateDoc, serverTimestamp, query, where, getDocs, arrayUnion } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../../lib/firebase";
import { generateInviteCode } from "../../lib/inviteCode";
import {
  integrationsDocPath,
  ensureFreshGoogleToken,
  createDriveFolder,
  createGithubRepo,
  slugifyRepoName,
} from "../../lib/integrations";
import Toggle from "../components/Toggle";
import TopNav from "../components/TopNav";
import { useAuthGate } from "../../lib/useAuthGate";

export default function CreateProjectPage() {
  const router = useRouter();
  const [user, setUser] = useState(undefined);
  const [mode, setMode] = useState("create"); // "create" | "join"
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(""); // status text while the multi-step create runs
  const [error, setError] = useState("");
  const [integrations, setIntegrations] = useState(null);
  const [makeDriveFolder, setMakeDriveFolder] = useState(false);
  const [makeGithubRepo, setMakeGithubRepo] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useAuthGate(user);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, ...integrationsDocPath(user.uid)), (snap) => {
      setIntegrations(snap.exists() ? snap.data() : {});
    });
    return () => unsub();
  }, [user]);

  const driveConnected = Boolean(integrations?.driveAccessToken);
  const githubConnected = Boolean(integrations?.githubAccessToken);

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
    if (!brief.trim()) {
      setError("Give your project a brief — it's what the AI uses to suggest roles.");
      return;
    }
    setSaving(true);
    setError("");
    const trimmedName = name.trim();
    let ref;
    try {
      setStep("Creating project…");
      ref = await addDoc(collection(db, "projects"), {
        name: trimmedName,
        brief: brief.trim(),
        roles: [],
        ownerId: user.uid,
        ownerName: user.displayName || user.email || "Unknown",
        memberIds: [user.uid],
        inviteCode: generateInviteCode(),
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error(err);
      setError("Couldn't create the project. Try again.");
      setSaving(false);
      setStep("");
      return;
    }

    // The project exists at this point regardless of what happens below —
    // Drive/GitHub creation failures are non-fatal, just surfaced as a
    // notice, so a flaky API call never loses the project itself.
    const extras = {};
    const warnings = [];

    if (makeDriveFolder && driveConnected) {
      setStep("Creating Drive folder…");
      try {
        const token = await ensureFreshGoogleToken(integrations);
        const folder = await createDriveFolder(token, trimmedName);
        extras.driveFolderId = folder.id;
        extras.driveFolderUrl = folder.url;
      } catch (err) {
        console.error("Drive folder creation failed:", err);
        warnings.push("Drive folder: " + (err.message || "failed"));
      }
    }

    if (makeGithubRepo && githubConnected) {
      setStep("Creating GitHub repo…");
      try {
        const repo = await createGithubRepo(integrations.githubAccessToken, trimmedName, { private: true });
        extras.githubRepoUrl = repo.url;
        extras.githubRepoFullName = repo.fullName;
      } catch (err) {
        console.error("GitHub repo creation failed:", err);
        warnings.push("GitHub repo: " + (err.message || "failed"));
      }
    }

    if (Object.keys(extras).length > 0) {
      try {
        await updateDoc(doc(db, "projects", ref.id), extras);
      } catch (err) {
        console.error("Failed to save Drive/GitHub links on project:", err);
      }
    }

    if (warnings.length > 0) {
      // Don't block navigation — the project is real and usable either way.
      console.warn("Project created with warnings:", warnings.join("; "));
    }

    router.push(`/project/${ref.id}`);
  }

  // Same lookup app/join/[code]/page.js does, just reachable by typing the
  // code directly instead of needing the full invite link.
  async function handleJoin(e) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code || !user) return;
    setJoinBusy(true);
    setJoinError("");
    try {
      const q = query(collection(db, "projects"), where("inviteCode", "==", code));
      const snap = await getDocs(q);
      if (snap.empty) {
        setJoinError("No project found with that code. Double-check it and try again.");
        setJoinBusy(false);
        return;
      }
      const p = { id: snap.docs[0].id, ...snap.docs[0].data() };
      if (!(p.memberIds || []).includes(user.uid)) {
        await updateDoc(doc(db, "projects", p.id), { memberIds: arrayUnion(user.uid) });
      }
      router.push(`/project/${p.id}`);
    } catch (err) {
      setJoinError("Couldn't join that project. " + (err.code || err.message || "Try again."));
      setJoinBusy(false);
    }
  }

  if (!user) return <div className="shell" />;

  return (
    <div className="shell">
      <TopNav user={user} />
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div className="shell-card" style={{ width: "100%", maxWidth: 440 }}>
          <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 9, marginBottom: 22 }}>
            {[
              { key: "create", label: "Make a project" },
              { key: "join", label: "Join a project" },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setMode(t.key)}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: 7,
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 12.5,
                  fontWeight: 700,
                  background: mode === t.key ? "var(--s-amber)" : "transparent",
                  color: mode === t.key ? "var(--s-amber-ink)" : "var(--s-text-2)",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {mode === "join" ? (
            <form onSubmit={handleJoin}>
              <div style={{ fontWeight: 700, fontSize: 24, marginBottom: 6 }}>Join a project</div>
              <div style={{ color: "var(--s-text-2)", fontSize: 14, marginBottom: 22 }}>
                Enter the 8-character code a teammate shared with you.
              </div>

              {joinError && <p className="notice">{joinError}</p>}

              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 8))}
                placeholder="ABCD1234"
                autoFocus
                maxLength={8}
                className="shell-input"
                style={{ width: "100%", marginBottom: 16, fontFamily: "'DM Sans', sans-serif", fontWeight: 700, letterSpacing: "0.18em", textAlign: "center", fontSize: 18, textTransform: "uppercase" }}
              />

              <button type="submit" disabled={joinBusy || joinCode.trim().length < 4} className="shell-auth-btn primary">
                {joinBusy ? "Joining…" : "Join project"}
              </button>
            </form>
          ) : (
        <form onSubmit={handleCreate}>
          <div style={{ fontWeight: 700, fontSize: 24, marginBottom: 6 }}>New project</div>
          <div style={{ color: "var(--s-text-2)", fontSize: 14, marginBottom: 22 }}>
            Give it a name and a quick description. You can flesh out roles and tasks inside.
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
            placeholder="What is this project? A few sentences is enough — the AI uses this to suggest roles."
            rows={3}
            required
            className="shell-input"
            style={{ width: "100%", marginBottom: 16, resize: "vertical", fontFamily: "inherit" }}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            <div className="toggle-row">
              <div className="toggle-row-label">
                <div className="toggle-row-title">Create a Google Drive folder</div>
                <div className="toggle-row-hint">
                  {driveConnected
                    ? `Named "${name.trim() || "your project"}"`
                    : <>Connect Drive in <Link href="/account" style={{ color: "var(--s-amber)" }}>Preferences</Link> first</>}
                </div>
              </div>
              <Toggle checked={makeDriveFolder && driveConnected} onChange={setMakeDriveFolder} disabled={!driveConnected} />
            </div>

            <div className="toggle-row">
              <div className="toggle-row-label">
                <div className="toggle-row-title">Create a GitHub repository</div>
                <div className="toggle-row-hint">
                  {githubConnected
                    ? `Private repo named "${name.trim() ? slugifyRepoName(name) : "your-project"}"`
                    : <>Connect GitHub in <Link href="/account" style={{ color: "var(--s-amber)" }}>Preferences</Link> first</>}
                </div>
              </div>
              <Toggle checked={makeGithubRepo && githubConnected} onChange={setMakeGithubRepo} disabled={!githubConnected} />
            </div>
          </div>

          <button type="submit" disabled={saving} className="shell-auth-btn primary">
            {saving ? step || "Creating…" : "Create project"}
          </button>
        </form>
          )}
        </div>
      </div>
    </div>
  );
}
