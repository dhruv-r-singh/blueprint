"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, addDoc, doc, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore";
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

export default function CreateProjectPage() {
  const router = useRouter();
  const [user, setUser] = useState(undefined);
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(""); // status text while the multi-step create runs
  const [error, setError] = useState("");
  const [integrations, setIntegrations] = useState(null);
  const [makeDriveFolder, setMakeDriveFolder] = useState(false);
  const [makeGithubRepo, setMakeGithubRepo] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

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
      setError("Couldn't create the project — try again.");
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

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            <div className="toggle-row">
              <div className="toggle-row-label">
                <div className="toggle-row-title">Create a Google Drive folder</div>
                <div className="toggle-row-hint">
                  {driveConnected
                    ? `Named "${name.trim() || "your project"}"`
                    : <>Connect Drive in <Link href="/account" style={{ color: "var(--s-amber)" }}>Account settings</Link> first</>}
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
                    : <>Connect GitHub in <Link href="/account" style={{ color: "var(--s-amber)" }}>Account settings</Link> first</>}
                </div>
              </div>
              <Toggle checked={makeGithubRepo && githubConnected} onChange={setMakeGithubRepo} disabled={!githubConnected} />
            </div>
          </div>

          <button type="submit" disabled={saving} className="shell-auth-btn primary">
            {saving ? step || "Creating…" : "Create project"}
          </button>
        </form>
      </div>
    </div>
  );
}
