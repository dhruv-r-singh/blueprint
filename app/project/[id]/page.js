"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  updateDoc,
  addDoc,
  getDocs,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";
import { searchRoleTitles } from "../../../lib/roleTitles";
import { generateInviteCode, inviteLink, qrCodeUrl } from "../../../lib/inviteCode";
import {
  integrationsDocPath,
  ensureFreshGoogleToken,
  listRecentDriveFiles,
  listGithubRepos,
} from "../../../lib/integrations";
import Autocomplete from "../../components/Autocomplete";
import VideoCall from "./VideoCall";

const COLUMNS = [
  { key: "todo", label: "To do" },
  { key: "progress", label: "In progress" },
  { key: "done", label: "Done" },
];

const ROLE_COLORS = {
  SW: "#6fa8d8",
  AI: "#c46fd8",
  CAD: "#5fbf8f",
  HW: "#5fbf8f",
  BIZ: "#e0a339",
  UX: "#e08a6f",
};

function roleColor(code) {
  const prefix = (code || "").replace(/[0-9-]/g, "");
  return ROLE_COLORS[prefix] || "#e0a339";
}

const SEED_CANDIDATES = [
  { name: "Priya N.", headline: "ML engineer · on-device vision", roleCodes: ["AI"], skillTags: ["PyTorch", "Computer vision", "Mobile ML"], match: 94 },
  { name: "Jordan L.", headline: "Mobile engineer · React Native", roleCodes: ["SW"], skillTags: ["React Native", "iOS", "Android"], match: 88 },
  { name: "Sam O.", headline: "Product designer · rapid prototyping", roleCodes: ["CAD", "HW"], skillTags: ["Fusion 360", "Injection molding"], match: 91 },
  { name: "Elena V.", headline: "Business · agtech outreach", roleCodes: ["BIZ"], skillTags: ["Partnerships", "Grant writing"], match: 85 },
  { name: "Maya R.", headline: "Mechanical engineering student", roleCodes: ["CAD"], skillTags: ["SolidWorks", "3D printing"], match: 76 },
];

const CHANNELS = [
  { key: "overview", label: "Overview", desc: "Brief, roles, and status for this project", icon: "O" },
  { key: "tasks", label: "Tasks", desc: "Drag cards between columns", icon: "T" },
  { key: "matches", label: "Matches", desc: "Ranked candidates for the roles still open", icon: "M" },
  { key: "chat", label: "Team chat", desc: "", icon: "C" },
];

const SETTINGS_CHANNEL = { key: "settings", label: "Settings", desc: "Project name, roles, and invites", icon: "⚙" };

export default function ProjectPage() {
  const { id } = useParams();
  const router = useRouter();
  const [user, setUser] = useState(undefined);
  const [tab, setTab] = useState("overview");
  const [project, setProject] = useState(null);
  const [myProjects, setMyProjects] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [draggedId, setDraggedId] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [messages, setMessages] = useState([]);
  const [msgText, setMsgText] = useState("");
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [composerMode, setComposerMode] = useState(null); // null | "attach" | "poll" | "task"
  const [attachUrl, setAttachUrl] = useState("");
  const [myIntegrations, setMyIntegrations] = useState(null);
  const [browsing, setBrowsing] = useState(null); // null | "drive" | "github"
  const [browseItems, setBrowseItems] = useState([]);
  const [browseError, setBrowseError] = useState("");
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [taskRefId, setTaskRefId] = useState("");
  const [newRoleCode, setNewRoleCode] = useState("");
  const [newRoleTitle, setNewRoleTitle] = useState("");
  const [newTaskText, setNewTaskText] = useState({ todo: "", progress: "", done: "" });
  const [addingCol, setAddingCol] = useState(null);
  const [settingsName, setSettingsName] = useState("");
  const [settingsBrief, setSettingsBrief] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, "projects", id), (snap) => {
      setProject(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    return () => unsub();
  }, [id]);

  // Seed the settings-tab draft fields once per project (not on every
  // snapshot update) so typing isn't clobbered by realtime updates.
  useEffect(() => {
    if (!project) return;
    setSettingsName(project.name || "");
    setSettingsBrief(project.brief || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "projects"), where("memberIds", "array-contains", user.uid));
    const unsub = onSnapshot(q, (snap) => {
      setMyProjects(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!id) return;
    const q = query(collection(db, "projects", id, "tasks"), orderBy("createdAt"));
    const unsub = onSnapshot(q, (snap) => {
      setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [id]);

  useEffect(() => {
    if (tab !== "matches" || !user) return;
    (async () => {
      const snap = await getDocs(collection(db, "candidates"));
      if (snap.empty) {
        for (const c of SEED_CANDIDATES) await addDoc(collection(db, "candidates"), c);
      }
    })();
    const unsub = onSnapshot(collection(db, "candidates"), (snap) => {
      setCandidates(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [tab, user]);

  useEffect(() => {
    if (tab !== "chat" || !id) return;
    const q = query(collection(db, "projects", id, "messages"), orderBy("createdAt"));
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [tab, id]);

  useEffect(() => {
    if (tab !== "chat" || !user) return;
    const unsub = onSnapshot(doc(db, ...integrationsDocPath(user.uid)), (snap) => {
      setMyIntegrations(snap.exists() ? snap.data() : {});
    });
    return () => unsub();
  }, [tab, user]);

  async function moveTask(taskId, newStatus) {
    try {
      await updateDoc(doc(db, "projects", id, "tasks", taskId), { status: newStatus });
    } catch (err) {
      console.error("Failed to move task:", err);
    }
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!msgText.trim() || !user) return;
    const text = msgText.trim();
    setMsgText("");
    await addDoc(collection(db, "projects", id, "messages"), {
      text,
      senderId: user.uid,
      senderName: user.displayName || user.email || "Unknown",
      createdAt: serverTimestamp(),
    });
  }

  function closeComposerExtra() {
    setComposerMode(null);
    setComposerMenuOpen(false);
    setAttachUrl("");
    setPollQuestion("");
    setPollOptions(["", ""]);
    setTaskRefId("");
    setBrowsing(null);
    setBrowseItems([]);
    setBrowseError("");
  }

  async function browseDrive() {
    setBrowsing("drive");
    setBrowseError("");
    setBrowseItems([]);
    try {
      const token = await ensureFreshGoogleToken(myIntegrations, (patch) =>
        setDoc(doc(db, ...integrationsDocPath(user.uid)), patch, { merge: true })
      );
      const files = await listRecentDriveFiles(token);
      setBrowseItems(
        files.map((f) => ({ id: f.id, title: f.name, url: f.webViewLink, provider: "drive" }))
      );
    } catch (err) {
      setBrowseError(err.message || "Couldn't load Drive files.");
    }
  }

  async function browseGithub() {
    setBrowsing("github");
    setBrowseError("");
    setBrowseItems([]);
    try {
      const repos = await listGithubRepos(myIntegrations.githubAccessToken);
      setBrowseItems(
        repos.map((r) => ({ id: r.id, title: r.full_name, url: r.html_url, provider: "github" }))
      );
    } catch (err) {
      setBrowseError(err.message || "Couldn't load GitHub repos.");
    }
  }

  async function sendPickedAttachment(item) {
    if (!user) return;
    await addDoc(collection(db, "projects", id, "messages"), {
      type: "attachment",
      url: item.url,
      provider: item.provider,
      title: item.title,
      senderId: user.uid,
      senderName: user.displayName || user.email || "Unknown",
      createdAt: serverTimestamp(),
    });
    closeComposerExtra();
  }

  function guessLinkMeta(rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (u.hostname.includes("drive.google.com") || u.hostname.includes("docs.google.com")) {
        return { provider: "drive", title: "Google Drive file" };
      }
      if (u.hostname.includes("github.com")) {
        const parts = u.pathname.split("/").filter(Boolean);
        return { provider: "github", title: parts.length >= 2 ? `${parts[0]}/${parts[1]}` : "GitHub" };
      }
      return { provider: "link", title: u.hostname };
    } catch {
      return { provider: "link", title: rawUrl };
    }
  }

  async function sendAttachment(e) {
    e.preventDefault();
    if (!attachUrl.trim() || !user) return;
    const url = attachUrl.trim();
    const { provider, title } = guessLinkMeta(url);
    await addDoc(collection(db, "projects", id, "messages"), {
      type: "attachment",
      url,
      provider,
      title,
      senderId: user.uid,
      senderName: user.displayName || user.email || "Unknown",
      createdAt: serverTimestamp(),
    });
    closeComposerExtra();
  }

  function updatePollOption(i, value) {
    setPollOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  }
  function addPollOption() {
    setPollOptions((prev) => (prev.length >= 6 ? prev : [...prev, ""]));
  }
  function removePollOption(i) {
    setPollOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  async function sendPoll(e) {
    e.preventDefault();
    const question = pollQuestion.trim();
    const options = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!question || options.length < 2 || !user) return;
    await addDoc(collection(db, "projects", id, "messages"), {
      type: "poll",
      question,
      options: options.map((text) => ({ text, votes: [] })),
      senderId: user.uid,
      senderName: user.displayName || user.email || "Unknown",
      createdAt: serverTimestamp(),
    });
    closeComposerExtra();
  }

  async function votePoll(message, optionIndex) {
    if (!user) return;
    const nextOptions = message.options.map((opt, i) => {
      const votes = opt.votes || [];
      if (i === optionIndex) {
        return { ...opt, votes: votes.includes(user.uid) ? votes.filter((v) => v !== user.uid) : [...votes, user.uid] };
      }
      // single-choice poll: voting for one option clears your vote elsewhere
      return { ...opt, votes: votes.filter((v) => v !== user.uid) };
    });
    try {
      await updateDoc(doc(db, "projects", id, "messages", message.id), { options: nextOptions });
    } catch (err) {
      console.error("Failed to vote:", err);
    }
  }

  async function sendTaskRef(e) {
    e.preventDefault();
    if (!taskRefId || !user) return;
    const task = tasks.find((t) => t.id === taskRefId);
    if (!task) return;
    await addDoc(collection(db, "projects", id, "messages"), {
      type: "task-ref",
      taskId: task.id,
      taskTitle: task.title,
      senderId: user.uid,
      senderName: user.displayName || user.email || "Unknown",
      createdAt: serverTimestamp(),
    });
    closeComposerExtra();
  }

  async function createTask(status) {
    const text = (newTaskText[status] || "").trim();
    if (!text) return;
    try {
      await addDoc(collection(db, "projects", id, "tasks"), {
        title: text,
        roleCode: "",
        status,
        createdAt: serverTimestamp(),
      });
      setNewTaskText((prev) => ({ ...prev, [status]: "" }));
      setAddingCol(status);
    } catch (err) {
      console.error("Failed to create task:", err);
    }
  }

  async function addRole(e) {
    e.preventDefault();
    if (!newRoleCode.trim() || !newRoleTitle.trim()) return;
    try {
      await updateDoc(doc(db, "projects", id), {
        roles: arrayUnion({
          code: newRoleCode.trim().toUpperCase(),
          title: newRoleTitle.trim(),
          description: "",
        }),
      });
      setNewRoleCode("");
      setNewRoleTitle("");
    } catch (err) {
      console.error("Failed to add role:", err);
    }
  }

  async function removeRole(role) {
    try {
      await updateDoc(doc(db, "projects", id), { roles: arrayRemove(role) });
    } catch (err) {
      console.error("Failed to remove role:", err);
    }
  }

  async function saveProjectMeta(e) {
    e.preventDefault();
    if (!settingsName.trim()) return;
    setSavingMeta(true);
    try {
      await updateDoc(doc(db, "projects", id), {
        name: settingsName.trim(),
        brief: settingsBrief.trim(),
      });
    } catch (err) {
      console.error("Failed to save project settings:", err);
    } finally {
      setSavingMeta(false);
    }
  }

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(inviteLink(project.inviteCode));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.error("Clipboard write failed:", err);
    }
  }

  async function regenerateInvite() {
    setInviteBusy(true);
    try {
      await updateDoc(doc(db, "projects", id), { inviteCode: generateInviteCode() });
    } catch (err) {
      console.error("Failed to regenerate invite code:", err);
    } finally {
      setInviteBusy(false);
    }
  }

  async function leaveProject() {
    if (!user) return;
    if (!window.confirm("Leave this project? You'll need a new invite to get back in.")) return;
    setLeaving(true);
    try {
      await updateDoc(doc(db, "projects", id), { memberIds: arrayRemove(user.uid) });
      router.replace("/");
    } catch (err) {
      console.error("Failed to leave project:", err);
      setLeaving(false);
    }
  }

  if (project === null) {
    return (
      <div className="shell">
        <div className="shell-view">
          <p className="notice">Project not found, or still loading.</p>
        </div>
      </div>
    );
  }

  const activeChannel = [...CHANNELS, SETTINGS_CHANNEL].find((c) => c.key === tab);

  return (
    <div className="shell">
      <div className="shell-topbar">
        <Link href="/account" className="shell-topbar-right" style={{ marginLeft: "auto" }} aria-label="Account settings">
          <span style={{ fontSize: 16, color: "var(--s-text-3)" }}>⚙</span>
        </Link>
        <Link href="/profile" className="shell-topbar-right" style={{ marginLeft: 8 }}>
          <span className="shell-pname">{user?.displayName || user?.email || "Account"}</span>
          <span className="shell-avatar">
            {(user?.displayName || user?.email || "?")[0]?.toUpperCase()}
          </span>
        </Link>
      </div>

      <div className="shell-body">
        <div className="shell-sidebar">
          <div className="shell-switcher" onClick={() => setDropdownOpen((v) => !v)}>
            <span className="shell-swatch">{(project?.name || "?").slice(0, 2).toUpperCase()}</span>
            <span className="shell-switcher-name">{project?.name}</span>
            <span className="shell-chev">⌄</span>
            {dropdownOpen && (
              <div className="shell-dropdown" onClick={(e) => e.stopPropagation()}>
                <div className="shell-dropdown-label">Your projects</div>
                {myProjects.map((p) => (
                  <div
                    key={p.id}
                    className="shell-proj-row"
                    onClick={() => {
                      setDropdownOpen(false);
                      router.push(`/project/${p.id}`);
                    }}
                  >
                    <span className="shell-mini-swatch" />
                    {p.name}
                  </div>
                ))}
                <div
                  className="shell-proj-row"
                  style={{ color: "var(--s-amber)" }}
                  onClick={() => {
                    setDropdownOpen(false);
                    router.push("/create");
                  }}
                >
                  <span style={{ width: 8, textAlign: "center" }}>+</span>
                  New project
                </div>
              </div>
            )}
          </div>

          <div className="shell-chan-group">
            <div className="shell-chan-group-label">{project?.name}</div>
            {CHANNELS.map((c) => (
              <button
                key={c.key}
                className={"shell-chan" + (tab === c.key ? " active" : "")}
                onClick={() => setTab(c.key)}
              >
                {c.label}
                {c.key === "tasks" && tasks.length > 0 && (
                  <span className="shell-fill-pill">{tasks.length}</span>
                )}
              </button>
            ))}
          </div>

          <div className="shell-chan-group" style={{ marginTop: "auto", paddingTop: 0, borderTop: "1px solid var(--s-border)" }}>
            <button
              className={"shell-chan" + (tab === "settings" ? " active" : "")}
              onClick={() => setTab("settings")}
            >
              ⚙ Settings
            </button>
          </div>
        </div>

        <div className="shell-main">
          <div className="shell-main-top">
            <span className="shell-page-icon">{activeChannel.icon}</span>
            <span className="shell-cname">{activeChannel.label}</span>
            <span className="shell-cdesc">{activeChannel.desc}</span>
          </div>

          {tab === "overview" && project && (
            <div className="shell-view" style={{ maxWidth: 640 }}>
              <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 6 }}>
                Brief
              </p>
              <p className="shell-brief-text" style={{ marginBottom: 24 }}>
                {project.brief || "No brief yet."}
              </p>
              <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
                Roles needed
              </p>
              {(project.roles || []).length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--s-text-3)" }}>No roles added yet.</p>
              ) : (
                <div className="shell-role-grid">
                  {project.roles.map((r, i) => (
                    <div className="shell-role-card" key={i}>
                      <div className="shell-role-code">{r.code}-101</div>
                      <div className="shell-role-title">{r.title}</div>
                      <div className="shell-role-desc">{r.description}</div>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={addRole} style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <input
                  value={newRoleCode}
                  onChange={(e) => setNewRoleCode(e.target.value)}
                  placeholder="Code (e.g. SW)"
                  style={{ width: 110, background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)", color: "var(--s-text)", padding: 8, fontSize: 12, borderRadius: 6 }}
                />
                <Autocomplete
                  value={newRoleTitle}
                  onChange={setNewRoleTitle}
                  search={(q) => searchRoleTitles(q)}
                  onSelect={(item) => {
                    setNewRoleTitle(item.title);
                    if (!newRoleCode.trim()) setNewRoleCode(item.code);
                  }}
                  getLabel={(item) => item.title}
                  getSublabel={(item) => item.abbr || item.code}
                  placeholder="Role title (try 'chief')"
                  style={{ flex: 1 }}
                  inputStyle={{ width: "100%", background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)", color: "var(--s-text)", padding: 8, fontSize: 12, borderRadius: 6, fontFamily: "inherit" }}
                />
                <button type="submit" className="shell-auth-btn primary" style={{ width: "auto", margin: 0, padding: "8px 16px" }}>
                  Add
                </button>
              </form>
            </div>
          )}

          {tab === "tasks" && (
            <div className="shell-view shell-board">
              {COLUMNS.map((col) => (
                <div
                  key={col.key}
                  className="shell-board-col"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => draggedId && moveTask(draggedId, col.key)}
                >
                  <div className="shell-col-head">
                    {col.label} <span className="shell-col-count">{tasks.filter((t) => t.status === col.key).length}</span>
                  </div>
                  <div className="shell-col-drop">
                    {tasks
                      .filter((t) => t.status === col.key)
                      .map((t) => (
                        <div
                          key={t.id}
                          className="shell-task-card"
                          draggable
                          onDragStart={() => setDraggedId(t.id)}
                          onDragEnd={() => setDraggedId(null)}
                          style={{ "--role-color": roleColor(t.roleCode) }}
                        >
                          <span className="shell-task-role">{t.roleCode}</span>
                          <div>{t.title}</div>
                        </div>
                      ))}
                  </div>
                  {addingCol === col.key ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        createTask(col.key);
                      }}
                      style={{ display: "flex", gap: 6 }}
                    >
                      <input
                        autoFocus
                        value={newTaskText[col.key]}
                        onChange={(e) =>
                          setNewTaskText((prev) => ({ ...prev, [col.key]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setAddingCol(null);
                          }
                        }}
                        onBlur={(e) => {
                          // don't collapse if focus moved to the submit button
                          if (!e.relatedTarget || e.relatedTarget.type !== "submit") {
                            if (!newTaskText[col.key]?.trim()) setAddingCol(null);
                          }
                        }}
                        placeholder="Task title"
                        className="shell-input"
                        style={{ flex: 1, fontFamily: "inherit", fontSize: 13, padding: "10px 12px" }}
                      />
                      <button type="submit" className="shell-task-add-btn" aria-label="Add task">
                        Add
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="shell-add-task"
                      onClick={() => setAddingCol(col.key)}
                    >
                      + Add task
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "matches" && project && (
            <div className="shell-view" style={{ maxWidth: 640 }}>
              {(project.roles || []).length === 0 && (
                <p style={{ fontSize: 13, color: "var(--s-text-3)" }}>
                  Add roles in Overview first, then matches will show up here.
                </p>
              )}
              {(project.roles || []).map((role) => {
                const matched = candidates
                  .filter((c) => (c.roleCodes || []).includes(role.code))
                  .sort((a, b) => (b.match || 0) - (a.match || 0));
                if (matched.length === 0) return null;
                return (
                  <div key={role.code} className="shell-match-role-block">
                    <div className="shell-match-role-head">
                      <span className="shell-match-role-code">{role.code}-101</span>
                      <span className="shell-match-role-title">{role.title}</span>
                    </div>
                    {matched.map((c, i) => (
                      <div key={c.id} className={"shell-cand-card" + (i === 0 ? " top-match" : "")}>
                        <div className="shell-cand-top">
                          {i === 0 && <span className="shell-top-badge">Top match</span>}
                          <span className="shell-cand-name">{c.name}</span>
                          {c.match && (
                            <span style={{ marginLeft: "auto", fontFamily: "'DM Sans', sans-serif", fontSize: 10, color: "var(--s-green)" }}>
                              {c.match}%
                            </span>
                          )}
                        </div>
                        <div className="shell-cand-headline">{c.headline}</div>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {(c.skillTags || []).map((s, si) => (
                            <span key={si} className="shell-mini-chip">{s}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              {candidates.length === 0 && (
                <p style={{ fontSize: 13, color: "var(--s-text-3)" }}>Loading candidates…</p>
              )}
            </div>
          )}

          {tab === "chat" && (
            <div className="shell-view" style={{ maxWidth: 640 }}>
              <VideoCall projectId={id} />
              <div className="shell-chat-panel">
                <div className="shell-msgs">
                  {messages.map((m) => (
                    <div key={m.id} className="shell-msg">
                      <span className="shell-avatar" style={{ marginTop: 2 }}>
                        {m.senderName?.[0]?.toUpperCase()}
                      </span>
                      <div className="shell-msg-body" style={{ flex: 1 }}>
                        <b>{m.senderName}</b>

                        {(!m.type || m.type === "text") && <p>{m.text}</p>}

                        {m.type === "attachment" && (
                          <a
                            href={m.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shell-attachment-card"
                          >
                            <span className={"shell-attachment-badge " + m.provider}>
                              {m.provider === "drive" ? "Drive" : m.provider === "github" ? "GitHub" : "Link"}
                            </span>
                            <span className="shell-attachment-title">{m.title}</span>
                          </a>
                        )}

                        {m.type === "poll" && (
                          <div className="shell-poll-card">
                            <div className="shell-poll-question">{m.question}</div>
                            {(m.options || []).map((opt, i) => {
                              const votes = opt.votes || [];
                              const totalVotes = (m.options || []).reduce((sum, o) => sum + (o.votes?.length || 0), 0);
                              const pct = totalVotes ? Math.round((votes.length / totalVotes) * 100) : 0;
                              const mine = user && votes.includes(user.uid);
                              return (
                                <button key={i} type="button" className={"shell-poll-option" + (mine ? " voted" : "")} onClick={() => votePoll(m, i)}>
                                  <span className="shell-poll-bar" style={{ width: pct + "%" }} />
                                  <span className="shell-poll-option-label">{opt.text}</span>
                                  <span className="shell-poll-option-count">{votes.length}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {m.type === "task-ref" && (
                          <button type="button" className="shell-taskref-card" onClick={() => setTab("tasks")}>
                            <span className="shell-taskref-label">Task</span>
                            {m.taskTitle}
                            {(() => {
                              const live = tasks.find((t) => t.id === m.taskId);
                              const status = live?.status;
                              const col = COLUMNS.find((c) => c.key === status);
                              return col ? <span className="shell-taskref-status">{col.label}</span> : null;
                            })()}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {messages.length === 0 && (
                    <p style={{ fontSize: 12, color: "var(--s-text-3)" }}>No messages yet — say hi.</p>
                  )}
                </div>

                {composerMode === "attach" && (
                  <div className="shell-composer-extra" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, padding: 14 }}>
                    <form onSubmit={sendAttachment} style={{ display: "flex", gap: 8 }}>
                      <input
                        autoFocus
                        value={attachUrl}
                        onChange={(e) => setAttachUrl(e.target.value)}
                        placeholder="Paste a Google Drive or GitHub link…"
                        style={{ background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)", borderRadius: 8, padding: 10, color: "var(--s-text)", fontFamily: "inherit", fontSize: 13.5 }}
                      />
                      <button type="submit">Attach</button>
                      <button type="button" onClick={closeComposerExtra} className="ghost">Cancel</button>
                    </form>

                    {(myIntegrations?.driveAccessToken || myIntegrations?.githubAccessToken) && (
                      <div style={{ display: "flex", gap: 8 }}>
                        {myIntegrations?.driveAccessToken && (
                          <button type="button" onClick={browseDrive} className="ghost" style={{ border: "1px solid var(--s-border)", borderRadius: 7, padding: "6px 12px" }}>
                            Browse Drive
                          </button>
                        )}
                        {myIntegrations?.githubAccessToken && (
                          <button type="button" onClick={browseGithub} className="ghost" style={{ border: "1px solid var(--s-border)", borderRadius: 7, padding: "6px 12px" }}>
                            Browse GitHub repos
                          </button>
                        )}
                      </div>
                    )}
                    {!myIntegrations?.driveAccessToken && !myIntegrations?.githubAccessToken && (
                      <div style={{ fontSize: 11, color: "var(--s-text-3)" }}>
                        Connect Drive or GitHub in <Link href="/account" style={{ color: "var(--s-amber)" }}>Account settings</Link> to browse and attach without pasting a link.
                      </div>
                    )}

                    {browsing && (
                      <div style={{ border: "1px solid var(--s-border)", borderRadius: 8, overflow: "hidden" }}>
                        {browseError && <div style={{ padding: 10, fontSize: 12, color: "#e5534b" }}>{browseError}</div>}
                        {!browseError && browseItems.length === 0 && (
                          <div style={{ padding: 10, fontSize: 12, color: "var(--s-text-3)" }}>Loading…</div>
                        )}
                        {browseItems.map((item) => (
                          <div
                            key={item.id}
                            onClick={() => sendPickedAttachment(item)}
                            className="shell-proj-row"
                            style={{ borderRadius: 0 }}
                          >
                            {item.title}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {composerMode === "poll" && (
                  <form onSubmit={sendPoll} className="shell-composer-extra" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, padding: 14 }}>
                    <input
                      autoFocus
                      value={pollQuestion}
                      onChange={(e) => setPollQuestion(e.target.value)}
                      placeholder="Ask a question…"
                      style={{ background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)", borderRadius: 8, padding: 10, color: "var(--s-text)", fontFamily: "inherit", fontSize: 13.5 }}
                    />
                    {pollOptions.map((opt, i) => (
                      <div key={i} style={{ display: "flex", gap: 6 }}>
                        <input
                          value={opt}
                          onChange={(e) => updatePollOption(i, e.target.value)}
                          placeholder={`Option ${i + 1}`}
                          style={{ flex: 1, background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)", borderRadius: 8, padding: 9, color: "var(--s-text)", fontFamily: "inherit", fontSize: 13 }}
                        />
                        {pollOptions.length > 2 && (
                          <button type="button" onClick={() => removePollOption(i)} className="ghost" style={{ padding: "0 10px" }}>×</button>
                        )}
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      {pollOptions.length < 6 ? (
                        <button type="button" onClick={addPollOption} className="ghost" style={{ padding: "6px 0" }}>+ Add option</button>
                      ) : <span />}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" onClick={closeComposerExtra} className="ghost">Cancel</button>
                        <button type="submit">Post poll</button>
                      </div>
                    </div>
                  </form>
                )}

                {composerMode === "task" && (
                  <form onSubmit={sendTaskRef} className="shell-composer-extra">
                    <select
                      autoFocus
                      value={taskRefId}
                      onChange={(e) => setTaskRefId(e.target.value)}
                      style={{ flex: 1, background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)", borderRadius: 8, padding: 10, color: "var(--s-text)", fontFamily: "inherit", fontSize: 13.5 }}
                    >
                      <option value="">Choose a task…</option>
                      {tasks.map((t) => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                      ))}
                    </select>
                    <button type="submit" disabled={!taskRefId}>Share</button>
                    <button type="button" onClick={closeComposerExtra} className="ghost">Cancel</button>
                  </form>
                )}

                {composerMode === null && (
                  <form onSubmit={sendMessage} className="shell-composer">
                    <div style={{ position: "relative" }}>
                      <button
                        type="button"
                        className="shell-composer-plus"
                        onClick={() => setComposerMenuOpen((v) => !v)}
                        aria-label="Add to message"
                      >
                        +
                      </button>
                      {composerMenuOpen && (
                        <div className="shell-composer-menu" onClick={(e) => e.stopPropagation()}>
                          <div className="shell-proj-row" onClick={() => { setComposerMode("attach"); setComposerMenuOpen(false); }}>
                            Attach file / link
                          </div>
                          <div className="shell-proj-row" onClick={() => { setComposerMode("poll"); setComposerMenuOpen(false); }}>
                            Create a poll
                          </div>
                          <div className="shell-proj-row" onClick={() => { setComposerMode("task"); setComposerMenuOpen(false); }}>
                            Reference a task
                          </div>
                        </div>
                      )}
                    </div>
                    <input
                      value={msgText}
                      onChange={(e) => setMsgText(e.target.value)}
                      placeholder="Message the team"
                    />
                    <button type="submit">Send</button>
                  </form>
                )}
              </div>
            </div>
          )}

          {tab === "settings" && project && (
            <div className="shell-view" style={{ maxWidth: 560 }}>
              <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
                Project
              </p>
              <form onSubmit={saveProjectMeta} style={{ marginBottom: 32 }}>
                <input
                  value={settingsName}
                  onChange={(e) => setSettingsName(e.target.value)}
                  placeholder="Project name"
                  className="shell-input"
                  style={{ width: "100%", marginBottom: 10 }}
                />
                <textarea
                  value={settingsBrief}
                  onChange={(e) => setSettingsBrief(e.target.value)}
                  placeholder="Brief"
                  rows={3}
                  className="shell-input"
                  style={{ width: "100%", marginBottom: 10, resize: "vertical", fontFamily: "inherit" }}
                />
                <button type="submit" disabled={savingMeta} className="shell-task-add-btn" style={{ padding: "10px 18px" }}>
                  {savingMeta ? "Saving…" : "Save changes"}
                </button>
              </form>

              <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
                Roles
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
                {(project.roles || []).length === 0 && (
                  <p style={{ fontSize: 13, color: "var(--s-text-3)" }}>No roles yet — add them from the Overview tab.</p>
                )}
                {(project.roles || []).map((r, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 14px",
                      background: "var(--s-bg-side)",
                      border: "1px solid var(--s-border)",
                      borderRadius: 10,
                    }}
                  >
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, color: "var(--s-amber)" }}>
                      {r.code}
                    </span>
                    <span style={{ flex: 1, fontSize: 13.5 }}>{r.title}</span>
                    <button
                      onClick={() => removeRole(r)}
                      style={{ background: "transparent", border: "none", color: "var(--s-text-3)", cursor: "pointer", fontSize: 13 }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
                Invite teammates
              </p>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 32 }}>
                <img
                  src={qrCodeUrl(inviteLink(project.inviteCode))}
                  alt="Invite QR code"
                  width={140}
                  height={140}
                  style={{ borderRadius: 10, border: "1px solid var(--s-border)", background: "#fff" }}
                />
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input readOnly value={inviteLink(project.inviteCode)} className="shell-input" style={{ flex: 1, fontSize: 12.5 }} />
                    <button onClick={copyInviteLink} className="shell-task-add-btn" style={{ padding: "0 16px" }}>
                      {copied ? "Copied" : "Copy link"}
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--s-text-3)", marginBottom: 10 }}>
                    Or share the code: <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, color: "var(--s-text)", letterSpacing: "0.08em" }}>{project.inviteCode || "—"}</span>
                  </div>
                  <button
                    onClick={regenerateInvite}
                    disabled={inviteBusy}
                    style={{ background: "transparent", border: "1px solid var(--s-border)", color: "var(--s-text-2)", borderRadius: 7, padding: "8px 14px", fontFamily: "'DM Sans', sans-serif", fontSize: 12, cursor: "pointer" }}
                  >
                    {inviteBusy ? "Regenerating…" : "Regenerate code"}
                  </button>
                  <div style={{ fontSize: 11, color: "var(--s-text-3)", marginTop: 6 }}>
                    Regenerating invalidates the old link and QR code.
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
                Danger zone
              </p>
              <button
                onClick={leaveProject}
                disabled={leaving}
                style={{ background: "transparent", border: "1px solid #e5534b", color: "#e5534b", borderRadius: 7, padding: "10px 16px", fontFamily: "'DM Sans', sans-serif", fontSize: 12.5, cursor: "pointer" }}
              >
                {leaving ? "Leaving…" : "Leave project"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
