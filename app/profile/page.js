"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { searchSkills } from "../../lib/skillsCatalog";
import { integrationsDocPath, listPublicGithubRepos } from "../../lib/integrations";
import { uploadFile } from "../../lib/storage";
import { useAuthGate } from "../../lib/useAuthGate";
import Autocomplete from "../components/Autocomplete";
import AvatarEditor from "../components/AvatarEditor";
import TopNav from "../components/TopNav";
import { IconPencil, IconStar } from "../components/icons";

export default function ProfilePage() {
  const [user, setUser] = useState(undefined);
  const [skills, setSkills] = useState([]);
  const [newSkill, setNewSkill] = useState("");
  const [headline, setHeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [githubUsername, setGithubUsername] = useState("");
  const [githubRepos, setGithubRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [pendingAvatarFile, setPendingAvatarFile] = useState(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [portfolio, setPortfolio] = useState([]);
  const [newPortfolioTitle, setNewPortfolioTitle] = useState("");
  const [newPortfolioUrl, setNewPortfolioUrl] = useState("");
  const [newPortfolioDesc, setNewPortfolioDesc] = useState("");
  const [integrations, setIntegrations] = useState(null);

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

  useEffect(() => {
    if (!user) return;
    (async () => {
      const snap = await getDoc(doc(db, "profiles", user.uid));
      if (snap.exists()) {
        setSkills(snap.data().skills || []);
        setHeadline(snap.data().headline || "");
        setGithubUsername(snap.data().githubUsername || "");
        setAvatarUrl(snap.data().avatarUrl || "");
        setPortfolio(snap.data().portfolio || []);
      }
    })();
  }, [user]);

  async function savePortfolio(next) {
    if (!user) return;
    setPortfolio(next);
    try {
      await setDoc(doc(db, "profiles", user.uid), { portfolio: next }, { merge: true });
    } catch (err) {
      console.error("Failed to save portfolio:", err);
    }
  }

  function addPortfolioItem(e) {
    e.preventDefault();
    const title = newPortfolioTitle.trim();
    let url = newPortfolioUrl.trim();
    if (!title) return;
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    savePortfolio([...portfolio, { title, url, description: newPortfolioDesc.trim() }]);
    setNewPortfolioTitle("");
    setNewPortfolioUrl("");
    setNewPortfolioDesc("");
  }

  function removePortfolioItem(i) {
    savePortfolio(portfolio.filter((_, idx) => idx !== i));
  }

  async function handleAvatarSave(blob) {
    if (!user) return;
    setAvatarSaving(true);
    setAvatarError("");
    try {
      const path = `profiles/${user.uid}/avatar-${Date.now()}.jpg`;
      const url = await uploadFile(path, blob, () => {});
      await setDoc(doc(db, "profiles", user.uid), { avatarUrl: url }, { merge: true });
      setAvatarUrl(url);
      setPendingAvatarFile(null);
    } catch (err) {
      setAvatarError(err.message || "Couldn't save that photo.");
    } finally {
      setAvatarSaving(false);
    }
  }

  useEffect(() => {
    if (!githubUsername) {
      setGithubRepos([]);
      return;
    }
    setReposLoading(true);
    setReposError("");
    listPublicGithubRepos(githubUsername)
      .then((repos) => setGithubRepos(repos))
      .catch((err) => setReposError(err.message || "Couldn't load GitHub repos."))
      .finally(() => setReposLoading(false));
  }, [githubUsername]);

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

  // Hard auth gate: render nothing at all — not even the topbar — until we
  // know for sure someone's signed in. useAuthGate above sends
  // signed-out visitors to "/" the instant we know they're signed out.
  if (!user) return <div className="shell" />;

  return (
    <div className="shell">
      <TopNav user={user} />

      <div className="shell-view" style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>
        {user && (
          <>
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 28 }}>
              <label style={{ position: "relative", cursor: "pointer", display: "block" }}>
                {avatarUrl || user.photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl || user.photoURL} alt="" style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover" }} />
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
                <span
                  style={{
                    position: "absolute",
                    bottom: -2,
                    right: -2,
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "var(--s-amber)",
                    color: "var(--s-amber-ink)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    border: "2px solid var(--s-bg)",
                  }}
                  title="Change photo"
                >
                  <IconPencil size={11} />
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => e.target.files[0] && setPendingAvatarFile(e.target.files[0])}
                  style={{ display: "none" }}
                />
              </label>
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
              Connections
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
              {[
                { label: "Google Drive", connected: Boolean(integrations?.driveAccessToken) },
                { label: "GitHub", connected: Boolean(integrations?.githubAccessToken) },
              ].map((c) => (
                <span
                  key={c.label}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 12,
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "1px solid var(--s-border)",
                    background: "var(--s-bg-side)",
                    color: c.connected ? "var(--s-text)" : "var(--s-text-3)",
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: c.connected ? "var(--s-green, #5fbf8f)" : "var(--s-text-3)" }} />
                  {c.label} {c.connected ? "connected" : "not connected"}
                </span>
              ))}
              {(!integrations?.driveAccessToken || !integrations?.githubAccessToken) && (
                <Link href="/account" style={{ fontSize: 12, color: "var(--s-amber)", alignSelf: "center" }}>
                  Connect in Preferences →
                </Link>
              )}
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
              <button onClick={() => addSkill()} className="shell-task-add-btn" style={{ fontSize: 12 }}>
                Add
              </button>
            </div>
            {saving && <p style={{ fontSize: 11, color: "var(--s-text-3)", marginTop: 8 }}>Saving…</p>}

            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", margin: "28px 0 10px" }}>
              Portfolio
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {portfolio.map((p, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 12px",
                    border: "1px solid var(--s-border)",
                    borderRadius: 10,
                    background: "var(--s-bg-side)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--s-amber)", fontWeight: 600, fontSize: 13.5, textDecoration: "none" }}>
                        {p.title}
                      </a>
                    ) : (
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{p.title}</span>
                    )}
                    {p.description && (
                      <div style={{ fontSize: 12, color: "var(--s-text-3)", marginTop: 2 }}>{p.description}</div>
                    )}
                  </div>
                  <span onClick={() => removePortfolioItem(i)} style={{ cursor: "pointer", color: "var(--s-text-3)", flex: "none" }}>
                    ×
                  </span>
                </div>
              ))}
              {portfolio.length === 0 && (
                <span style={{ fontSize: 12, color: "var(--s-text-3)" }}>No portfolio items yet — add projects, case studies, or work samples.</span>
              )}
            </div>
            <form onSubmit={addPortfolioItem} style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 480 }}>
              <input
                value={newPortfolioTitle}
                onChange={(e) => setNewPortfolioTitle(e.target.value)}
                placeholder="Title — e.g. Blueprint mobile redesign"
                className="shell-input"
                style={{ fontFamily: "inherit", fontSize: 13, padding: 10 }}
              />
              <input
                value={newPortfolioUrl}
                onChange={(e) => setNewPortfolioUrl(e.target.value)}
                placeholder="Link (optional)"
                className="shell-input"
                style={{ fontFamily: "inherit", fontSize: 13, padding: 10 }}
              />
              <textarea
                value={newPortfolioDesc}
                onChange={(e) => setNewPortfolioDesc(e.target.value)}
                placeholder="Short description (optional)"
                rows={2}
                className="shell-input"
                style={{ fontFamily: "inherit", fontSize: 13, padding: 10, resize: "vertical" }}
              />
              <button type="submit" className="shell-task-add-btn" style={{ alignSelf: "flex-start", fontSize: 12 }}>
                Add to portfolio
              </button>
            </form>

            {githubUsername && (
              <>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", margin: "28px 0 10px" }}>
                  GitHub repositories
                </p>
                {reposLoading && <p style={{ fontSize: 12, color: "var(--s-text-3)" }}>Loading…</p>}
                {reposError && <p style={{ fontSize: 12, color: "#e5534b" }}>{reposError}</p>}
                {!reposLoading && !reposError && githubRepos.length === 0 && (
                  <p style={{ fontSize: 12, color: "var(--s-text-3)" }}>No public repositories yet.</p>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {githubRepos.map((r) => (
                    <a
                      key={r.id}
                      href={r.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shell-attachment-card"
                      style={{ maxWidth: 480 }}
                    >
                      <span className="shell-attachment-badge github">GitHub</span>
                      <span className="shell-attachment-title">{r.name}</span>
                      {r.stargazers_count > 0 && (
                        <span className="shell-attachment-meta" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                          <IconStar size={11} filled /> {r.stargazers_count}
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {pendingAvatarFile && (
        <AvatarEditor
          file={pendingAvatarFile}
          onCancel={() => {
            setPendingAvatarFile(null);
            setAvatarError("");
          }}
          onSave={handleAvatarSave}
          saving={avatarSaving}
          error={avatarError}
        />
      )}
    </div>
  );
}
