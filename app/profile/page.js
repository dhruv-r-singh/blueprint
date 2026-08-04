"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { searchSkills } from "../../lib/skillsCatalog";
import { listPublicGithubRepos, integrationsDocPath } from "../../lib/integrations";
import { uploadFile } from "../../lib/storage";
import { useAuthGate } from "../../lib/useAuthGate";
import Autocomplete from "../components/Autocomplete";
import AvatarEditor from "../components/AvatarEditor";
import TopNav from "../components/TopNav";
import { IconPencil, IconStar, IconGithubMark, IconLinkedinMark } from "../components/icons";

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
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [linkedinDraft, setLinkedinDraft] = useState("");
  const [editingLinkedin, setEditingLinkedin] = useState(false);
  const [linkedinConnected, setLinkedinConnected] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useAuthGate(user);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const snap = await getDoc(doc(db, "profiles", user.uid));
      let ghUsername = "";
      if (snap.exists()) {
        setSkills(snap.data().skills || []);
        setHeadline(snap.data().headline || "");
        ghUsername = snap.data().githubUsername || "";
        setGithubUsername(ghUsername);
        setAvatarUrl(snap.data().avatarUrl || "");
        setPortfolio(snap.data().portfolio || []);
        setLinkedinUrl(snap.data().linkedinUrl || "");
      }

      // The private integrations doc also holds LinkedIn's "connected" flag
      // (see app/api/auth/linkedin/link-start/route.js — LinkedIn is never a
      // real Firebase Auth provider link, just a Firestore record) and, if
      // GitHub is connected, the access token — read it once for both.
      try {
        const integSnap = await getDoc(doc(db, ...integrationsDocPath(user.uid)));
        const integData = integSnap.exists() ? integSnap.data() : {};
        setLinkedinConnected(Boolean(integData.linkedinConnected));

        // Self-heal: accounts that connected GitHub before saveGithubCredential
        // started looking up + saving the username (or where that one-time
        // lookup silently failed) end up with a real githubAccessToken but no
        // githubUsername on their profile — since Firebase's provider linking
        // only happens once, there's no "Connect" button left to re-trigger
        // the lookup. If we find that gap, do the lookup now with the token
        // that's already saved, same as a fresh connect would.
        if (!ghUsername && integData.githubAccessToken) {
          const res = await fetch("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${integData.githubAccessToken}`, accept: "application/vnd.github+json" },
          });
          if (res.ok) {
            const me = await res.json();
            if (me.login) {
              await setDoc(doc(db, "profiles", user.uid), { githubUsername: me.login }, { merge: true });
              setGithubUsername(me.login);
            }
          }
        }
      } catch (err) {
        console.error("Couldn't load integrations doc:", err);
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

  async function saveLinkedinUrl(e) {
    e.preventDefault();
    if (!user) return;
    let url = linkedinDraft.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      await setDoc(doc(db, "profiles", user.uid), { linkedinUrl: url }, { merge: true });
      setLinkedinUrl(url);
      setEditingLinkedin(false);
      setLinkedinDraft("");
    } catch (err) {
      console.error("Failed to save LinkedIn URL:", err);
    }
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

  // LinkedIn's "Sign In with LinkedIn using OpenID Connect" product — the
  // only LinkedIn auth product this app (or most apps) can get approved
  // without a LinkedIn partnership — only ever hands back name/email/photo
  // claims, never a public profile URL or vanity slug. There's no field to
  // auto-derive github.com/{username}-style; a real profile link can only
  // come from the person typing it in themselves (see the Links section
  // below), gated on having actually linked LinkedIn as a sign-in method.
  // linkedinConnected state is set from the integrations doc above — see the
  // comment there for why this isn't derived from user.providerData like
  // Google/GitHub.

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
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 22, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.displayName || user.email}
                </div>
                <input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  onBlur={() => saveProfile(skills, headline)}
                  placeholder="Add a headline, e.g. Firmware & embedded systems"
                  style={{
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--s-border)",
                    color: "var(--s-text-2)",
                    fontSize: 13,
                    padding: "4px 0",
                    width: "min(320px, 100%)",
                  }}
                />
              </div>
            </div>

            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
              Links
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28, alignItems: "flex-start" }}>
              {githubUsername && (
                <a
                  href={`https://github.com/${githubUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shell-attachment-card"
                >
                  <IconGithubMark size={13} />
                  <span className="shell-attachment-title">github.com/{githubUsername}</span>
                </a>
              )}

              {linkedinConnected && linkedinUrl && !editingLinkedin && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" className="shell-attachment-card">
                    <IconLinkedinMark size={13} />
                    <span className="shell-attachment-title">{linkedinUrl.replace(/^https?:\/\//i, "")}</span>
                  </a>
                  <button
                    type="button"
                    className="ghost"
                    style={{ fontSize: 11 }}
                    onClick={() => {
                      setLinkedinDraft(linkedinUrl);
                      setEditingLinkedin(true);
                    }}
                  >
                    Edit
                  </button>
                </div>
              )}

              {linkedinConnected && (!linkedinUrl || editingLinkedin) && (
                <form onSubmit={saveLinkedinUrl} style={{ display: "flex", gap: 8 }}>
                  <span style={{ display: "flex", alignItems: "center", color: "var(--s-text-3)" }}>
                    <IconLinkedinMark size={13} />
                  </span>
                  <input
                    value={linkedinDraft}
                    onChange={(e) => setLinkedinDraft(e.target.value)}
                    placeholder="linkedin.com/in/yourname"
                    autoFocus={editingLinkedin}
                    className="shell-input"
                    style={{ fontSize: 12.5, padding: "6px 10px" }}
                  />
                  <button type="submit" className="shell-task-add-btn" style={{ fontSize: 11.5, padding: "0 12px" }}>
                    Save
                  </button>
                  {editingLinkedin && (
                    <button type="button" className="ghost" style={{ fontSize: 11.5 }} onClick={() => setEditingLinkedin(false)}>
                      Cancel
                    </button>
                  )}
                </form>
              )}

              {!githubUsername && !linkedinConnected && (
                <span style={{ fontSize: 12, color: "var(--s-text-3)" }}>
                  Connect GitHub or LinkedIn in <Link href="/account" style={{ color: "var(--s-amber)" }}>Preferences</Link> to show links here.
                </span>
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
                  key={"manual-" + i}
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

              {/* GitHub repos aren't stored in `portfolio` — they're read live
                  from GitHub every time this page loads (see the
                  listPublicGithubRepos effect above), so they can't go stale
                  or duplicate on reconnect. Rendered with the same card style
                  as manual entries per request, just with a GitHub badge and
                  no remove button (removing one here wouldn't mean anything —
                  it'd just reappear, since the source of truth is GitHub
                  itself, not this list). */}
              {githubUsername && reposLoading && (
                <span style={{ fontSize: 12, color: "var(--s-text-3)" }}>Loading GitHub repositories…</span>
              )}
              {githubUsername && reposError && (
                <span style={{ fontSize: 12, color: "#e5534b" }}>{reposError}</span>
              )}
              {githubRepos.map((r) => (
                <div
                  key={"gh-" + r.id}
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
                    <a href={r.html_url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--s-amber)", fontWeight: 600, fontSize: 13.5, textDecoration: "none" }}>
                      <IconGithubMark size={12} />
                      {r.name}
                    </a>
                    {r.description && (
                      <div style={{ fontSize: 12, color: "var(--s-text-3)", marginTop: 2 }}>{r.description}</div>
                    )}
                  </div>
                  {r.stargazers_count > 0 && (
                    <span style={{ fontSize: 11, color: "var(--s-text-3)", flex: "none", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <IconStar size={11} filled /> {r.stargazers_count}
                    </span>
                  )}
                </div>
              ))}

              {portfolio.length === 0 && githubRepos.length === 0 && !reposLoading && (
                <span style={{ fontSize: 12, color: "var(--s-text-3)" }}>No portfolio items yet. Add projects, case studies, or work samples.</span>
              )}
            </div>
            <form onSubmit={addPortfolioItem} style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 480 }}>
              <input
                value={newPortfolioTitle}
                onChange={(e) => setNewPortfolioTitle(e.target.value)}
                placeholder="Title, e.g. Blueprint mobile redesign"
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
