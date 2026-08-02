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
} from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";
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
  const [newRoleCode, setNewRoleCode] = useState("");
  const [newRoleTitle, setNewRoleTitle] = useState("");
  const [newTaskText, setNewTaskText] = useState({ todo: "", progress: "", done: "" });

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

  if (project === null) {
    return (
      <div className="shell">
        <div className="shell-view">
          <p className="notice">Project not found, or still loading.</p>
        </div>
      </div>
    );
  }

  const activeChannel = CHANNELS.find((c) => c.key === tab);

  return (
    <div className="shell">
      <div className="shell-topbar">
        <Link href="/profile" className="shell-topbar-right">
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
                <input
                  value={newRoleTitle}
                  onChange={(e) => setNewRoleTitle(e.target.value)}
                  placeholder="Role title"
                  style={{ flex: 1, background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)", color: "var(--s-text)", padding: 8, fontSize: 12, borderRadius: 6 }}
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
                  <input
                    value={newTaskText[col.key]}
                    onChange={(e) =>
                      setNewTaskText((prev) => ({ ...prev, [col.key]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        createTask(col.key);
                      }
                    }}
                    placeholder="+ Add task"
                    className="shell-add-task"
                    style={{ fontFamily: "inherit" }}
                  />
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
                      <div className="shell-msg-body">
                        <b>{m.senderName}</b>
                        <p>{m.text}</p>
                      </div>
                    </div>
                  ))}
                  {messages.length === 0 && (
                    <p style={{ fontSize: 12, color: "var(--s-text-3)" }}>No messages yet — say hi.</p>
                  )}
                </div>
                <form onSubmit={sendMessage} className="shell-composer">
                  <input
                    value={msgText}
                    onChange={(e) => setMsgText(e.target.value)}
                    placeholder="Message the team"
                  />
                  <button type="submit">Send</button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
