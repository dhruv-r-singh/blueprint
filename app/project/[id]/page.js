"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  updateDoc,
  addDoc,
  getDocs,
  deleteDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { auth, db } from "../../../lib/firebase";
import { searchRoleTitles } from "../../../lib/roleTitles";
import { generateInviteCode, inviteLink, qrCodeUrl } from "../../../lib/inviteCode";
import {
  integrationsDocPath,
  ensureFreshGoogleToken,
  listRecentDriveFiles,
  listGithubRepos,
  inviteGithubCollaborator,
  createCalendarEvent,
  deleteCalendarEvent,
  uploadFileToDrive,
} from "../../../lib/integrations";
import { uploadFile, safeFileName } from "../../../lib/storage";
import Autocomplete from "../../components/Autocomplete";
import TopNav from "../../components/TopNav";
import CADViewer, { guessCadKind } from "../../components/CADViewer";
import Toggle from "../../components/Toggle";
import { IconGear, IconMic, IconSparkle } from "../../components/icons";
import { focusModeInfo } from "../../components/FocusMode";
import VideoCall from "./VideoCall";
import { useAuthGate } from "../../../lib/useAuthGate";
import { isOnline, lastSeenLabel } from "../../../lib/presence";

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
  { key: "overview", label: "Overview", desc: "Brief, roles, and status for this project" },
  { key: "tasks", label: "Tasks", desc: "Drag cards between columns" },
  { key: "matches", label: "Matches", desc: "Ranked candidates for the roles still open" },
  { key: "calendar", label: "Calendar", desc: "Shared events for this project" },
  { key: "chat", label: "Team chat", desc: "" },
];

const RETRO_COLUMNS = [
  { key: "wentWell", label: "Went well", color: "#5fbf8f" },
  { key: "toImprove", label: "To improve", color: "#e0a339" },
  { key: "actionItems", label: "Action items", color: "#6fa8d8" },
];

const WHITEBOARD_COLORS = ["#1a1a1a", "#e5534b", "#e0a339", "#5fbf8f", "#6fa8d8", "#c46fd8"];

const SETTINGS_CHANNEL = { key: "settings", label: "Settings", desc: "Project name, roles, and invites" };
const DOCS_CHANNEL = { key: "docs", label: "Documentation", desc: "Shared notes for this project" };
const FILES_CHANNEL = { key: "files", label: "Files", desc: "Every file and link shared in this project" };
// Activities has no sidebar nav entry (only reachable via chat's "Open
// Activities" attachment or from inside a Meeting), but still needs a
// label/desc for the header when it IS open — see activeChannel below.
const ACTIVITIES_CHANNEL = { key: "activities", label: "Activities", desc: "Whiteboard & retro board" };

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
  const [meetingStartSignal, setMeetingStartSignal] = useState(0);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDate, setNewTaskDate] = useState("");
  const [newTaskTime, setNewTaskTime] = useState("");
  const [settingsName, setSettingsName] = useState("");
  const [settingsBrief, setSettingsBrief] = useState("");
  const [docsDraft, setDocsDraft] = useState("");
  const [docsSaving, setDocsSaving] = useState(false);
  const [docsSavedAt, setDocsSavedAt] = useState(null);
  const [savingMeta, setSavingMeta] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [imageUploadPct, setImageUploadPct] = useState(null);
  const [imageError, setImageError] = useState("");
  const [chatFilePct, setChatFilePct] = useState(null);
  const [chatFileError, setChatFileError] = useState("");
  const [alsoAddToDrive, setAlsoAddToDrive] = useState(false);
  const [openReactionPicker, setOpenReactionPicker] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventTitle, setEventTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [eventDesc, setEventDesc] = useState("");
  const [eventBusy, setEventBusy] = useState(false);
  const [eventError, setEventError] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordError, setRecordError] = useState("");
  const [voiceUploading, setVoiceUploading] = useState(false);
  const mediaRecorderRef = useRef(null);
  const recordChunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const recordCancelledRef = useRef(false);
  const recordSecondsRef = useRef(0);
  const [activitySubTab, setActivitySubTab] = useState("whiteboard");
  const [strokes, setStrokes] = useState([]);
  const [brushColor, setBrushColor] = useState(WHITEBOARD_COLORS[0]);
  const [brushWidth, setBrushWidth] = useState(3);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [boardTool, setBoardTool] = useState("pen"); // "pen" | "eraser"
  const [customColors, setCustomColors] = useState([]);
  const [boardBusy, setBoardBusy] = useState(false);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const currentPointsRef = useRef([]);
  const [retroNotes, setRetroNotes] = useState([]);
  const [retroDrafts, setRetroDrafts] = useState({ wentWell: "", toImprove: "", actionItems: "" });
  const [viewingCad, setViewingCad] = useState(null); // { url, kind } | null
  const [memberProfiles, setMemberProfiles] = useState({}); // uid -> profile doc data
  const [translations, setTranslations] = useState({}); // messageId -> { text, loading, error, lang }
  const [presenceTick, setPresenceTick] = useState(0); // bumps periodically so online/offline labels stay fresh

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useAuthGate(user);

  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, "projects", id), (snap) => {
      setProject(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    return () => unsub();
  }, [id]);

  // Subscribe to every member's public profile doc so the Team panel
  // (Overview tab) can show their name/avatar and a live online/offline
  // dot — see lib/presence.js. Re-subscribes whenever the member list
  // changes; each uid gets its own listener since Firestore doesn't do
  // "watch N documents by id" in one query without an array-contains-any
  // on a field these docs don't have.
  useEffect(() => {
    const memberIds = project?.memberIds || [];
    if (memberIds.length === 0) return;
    const unsubs = memberIds.map((uid) =>
      onSnapshot(doc(db, "profiles", uid), (snap) => {
        setMemberProfiles((prev) => ({ ...prev, [uid]: snap.exists() ? snap.data() : {} }));
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [project?.memberIds?.join(",")]);

  // Presence is time-threshold based (see lib/presence.js), so without
  // this tick a member's dot would stay "online" forever after their last
  // heartbeat until something else happened to re-render this component.
  useEffect(() => {
    const interval = setInterval(() => setPresenceTick((t) => t + 1), 15_000);
    return () => clearInterval(interval);
  }, []);

  // Seed the settings-tab draft fields once per project (not on every
  // snapshot update) so typing isn't clobbered by realtime updates.
  useEffect(() => {
    if (!project) return;
    setSettingsName(project.name || "");
    setSettingsBrief(project.brief || "");
    setDocsDraft(project.docsContent || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  async function saveDocs() {
    if (!id) return;
    setDocsSaving(true);
    try {
      await updateDoc(doc(db, "projects", id), { docsContent: docsDraft });
      setDocsSavedAt(Date.now());
    } catch (err) {
      console.error("Failed to save documentation:", err);
    } finally {
      setDocsSaving(false);
    }
  }

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
    if ((tab !== "chat" && tab !== "files") || !id) return;
    const q = query(collection(db, "projects", id, "messages"), orderBy("createdAt"));
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [tab, id]);

  useEffect(() => {
    if (tab !== "calendar" || !id) return;
    const q = query(collection(db, "projects", id, "events"), orderBy("start"));
    const unsub = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [tab, id]);

  useEffect(() => {
    if (tab !== "activities" || !id) return;
    const q = query(collection(db, "projects", id, "whiteboard"), orderBy("createdAt"));
    const unsub = onSnapshot(q, (snap) => {
      setStrokes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [tab, id]);

  useEffect(() => {
    if (tab !== "activities" || !id) return;
    const q = query(collection(db, "projects", id, "retro"), orderBy("createdAt"));
    const unsub = onSnapshot(q, (snap) => {
      setRetroNotes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [tab, id]);

  // Redraw the whole board any time strokes change — strokes are only
  // written to Firestore once a pen stroke is lifted (not live per-point),
  // so this keeps every member's canvas in sync without a huge write volume.
  useEffect(() => {
    if (activitySubTab !== "whiteboard" || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    for (const stroke of strokes) {
      const pts = stroke.points || [];
      if (pts.length < 2) continue;
      ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
      ctx.globalAlpha = stroke.opacity ?? 1;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color || "#1a1a1a";
      ctx.lineWidth = stroke.width || 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }, [strokes, activitySubTab]);

  function canvasPoint(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startStroke(e) {
    e.preventDefault();
    drawingRef.current = true;
    currentPointsRef.current = [canvasPoint(e)];
  }

  function continueStroke(e) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const pt = canvasPoint(e);
    currentPointsRef.current.push(pt);
    const ctx = canvasRef.current.getContext("2d");
    const pts = currentPointsRef.current;
    if (pts.length >= 2) {
      const prev = pts[pts.length - 2];
      ctx.globalCompositeOperation = boardTool === "eraser" ? "destination-out" : "source-over";
      ctx.globalAlpha = brushOpacity;
      ctx.beginPath();
      ctx.strokeStyle = brushColor;
      ctx.lineWidth = brushWidth;
      ctx.lineCap = "round";
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
  }

  async function endStroke() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const points = currentPointsRef.current;
    currentPointsRef.current = [];
    if (points.length < 2 || !user) return;
    try {
      await addDoc(collection(db, "projects", id, "whiteboard"), {
        points,
        color: brushColor,
        width: brushWidth,
        opacity: brushOpacity,
        tool: boardTool,
        uid: user.uid,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to save stroke:", err);
    }
  }

  async function undoLastStroke() {
    const last = strokes[strokes.length - 1];
    if (!last) return;
    try {
      await deleteDoc(doc(db, "projects", id, "whiteboard", last.id));
    } catch (err) {
      console.error("Failed to undo stroke:", err);
    }
  }

  function addCustomColor(hex) {
    setBrushColor(hex);
    setCustomColors((prev) => (prev.includes(hex) ? prev : [hex, ...prev].slice(0, 6)));
  }

  async function clearWhiteboard() {
    setBoardBusy(true);
    try {
      const snap = await getDocs(collection(db, "projects", id, "whiteboard"));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    } catch (err) {
      console.error("Failed to clear whiteboard:", err);
    } finally {
      setBoardBusy(false);
    }
  }

  async function addRetroNote(columnKey) {
    const text = (retroDrafts[columnKey] || "").trim();
    if (!text || !user) return;
    setRetroDrafts((prev) => ({ ...prev, [columnKey]: "" }));
    try {
      await addDoc(collection(db, "projects", id, "retro"), {
        column: columnKey,
        text,
        uid: user.uid,
        name: user.displayName || user.email || "Unknown",
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to add retro note:", err);
    }
  }

  async function removeRetroNote(noteId) {
    try {
      await deleteDoc(doc(db, "projects", id, "retro", noteId));
    } catch (err) {
      console.error("Failed to remove retro note:", err);
    }
  }

  // Not gated to the chat tab — the project owner's copy of this also
  // drives the GitHub-collaborator reconciliation effect below, which needs
  // to run regardless of which tab they're on.
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, ...integrationsDocPath(user.uid)), (snap) => {
      setMyIntegrations(snap.exists() ? snap.data() : {});
    });
    return () => unsub();
  }, [user]);

  // If this project has a GitHub repo and *I'm* the owner (the only one
  // whose browser legitimately holds the token that can grant repo access),
  // invite any member who's joined since the last time I had this page
  // open and has connected their own GitHub account. Not instant — it runs
  // whenever the owner is viewing the project — but needs no server
  // component, since only the owner's own client ever touches their token.
  const reconcilingRef = useRef(false);
  useEffect(() => {
    if (!project || !user || user.uid !== project.ownerId) return;
    if (!project.githubRepoFullName || !myIntegrations?.githubAccessToken) return;
    const invited = new Set(project.githubInvited || []);
    const pending = (project.memberIds || []).filter((uid) => uid !== user.uid && !invited.has(uid));
    if (pending.length === 0 || reconcilingRef.current) return;

    reconcilingRef.current = true;
    (async () => {
      for (const uid of pending) {
        try {
          const snap = await getDoc(doc(db, "profiles", uid));
          const username = snap.exists() ? snap.data().githubUsername : null;
          if (!username) continue; // they haven't connected GitHub yet — retried next time this effect runs
          await inviteGithubCollaborator(myIntegrations.githubAccessToken, project.githubRepoFullName, username);
          await updateDoc(doc(db, "projects", id), { githubInvited: arrayUnion(uid) });
        } catch (err) {
          console.error("Failed to invite GitHub collaborator:", uid, err);
        }
      }
      reconcilingRef.current = false;
    })();
  }, [project, user, myIntegrations, id]);

  async function moveTask(taskId, newStatus) {
    try {
      await updateDoc(doc(db, "projects", id, "tasks", taskId), { status: newStatus });
    } catch (err) {
      console.error("Failed to move task:", err);
    }
  }

  /** Names of current project members, longest-first so "Sam A" matches before "Sam" does. */
  function memberMentionNames() {
    return (project?.memberIds || [])
      .map((uid) => ({ uid, name: memberProfiles[uid]?.name }))
      .filter((m) => m.name)
      .sort((a, b) => b.name.length - a.name.length);
  }

  /** Scans `text` for "@Name" against current members and returns the matched uids. */
  function extractMentions(text) {
    const found = new Set();
    for (const { uid, name } of memberMentionNames()) {
      if (text.includes(`@${name}`)) found.add(uid);
    }
    return Array.from(found);
  }

  /** Renders message text with "@Name" mentions highlighted, for members that still match by name. */
  function renderMessageText(text) {
    const names = memberMentionNames()
      .map((m) => m.name)
      .filter(Boolean);
    if (names.length === 0) return text;
    const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`(@(?:${escaped.join("|")}))`, "g");
    return text.split(pattern).map((part, i) => (names.some((n) => part === `@${n}`) ? (
      <span key={i} className="shell-mention">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    )));
  }

  function handleMsgTextChange(e) {
    const val = e.target.value;
    setMsgText(val);
    const match = val.match(/(?:^|\s)@([a-zA-Z0-9._' -]*)$/);
    if (match) {
      setMentionOpen(true);
      setMentionQuery(match[1].toLowerCase());
    } else {
      setMentionOpen(false);
      setMentionQuery("");
    }
  }

  function pickMention(name) {
    setMsgText((prev) => prev.replace(/(?:^|\s)@([a-zA-Z0-9._' -]*)$/, (full) => (full.startsWith(" ") ? " " : "") + `@${name} `));
    setMentionOpen(false);
    setMentionQuery("");
  }

  // On-demand, per-viewer translation via /api/translate (Google Translate
  // API) — nothing is stored or broadcast, it just fills in translations[id]
  // for this browser. Target language defaults to the browser's language.
  async function translateMessage(m) {
    const target = (navigator.language || "en").split("-")[0];
    setTranslations((prev) => ({ ...prev, [m.id]: { ...(prev[m.id] || {}), loading: true, error: "" } }));
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: m.text, target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't translate that message.");
      setTranslations((prev) => ({ ...prev, [m.id]: { text: data.translatedText, loading: false, error: "", lang: target } }));
    } catch (err) {
      setTranslations((prev) => ({ ...prev, [m.id]: { loading: false, error: err.message || "Couldn't translate that message." } }));
    }
  }

  function dismissTranslation(messageId) {
    setTranslations((prev) => {
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!msgText.trim() || !user) return;
    const text = msgText.trim();
    setMsgText("");
    setMentionOpen(false);
    await addDoc(collection(db, "projects", id, "messages"), {
      text,
      mentions: extractMentions(text),
      senderId: user.uid,
      senderName: user.displayName || user.email || "Unknown",
      createdAt: serverTimestamp(),
    });
  }

  async function startVoiceRecording() {
    setRecordError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordError("This browser doesn't support voice recording.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordChunksRef.current = [];
      recordCancelledRef.current = false;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(recordTimerRef.current);
        const seconds = recordSecondsRef.current;
        setRecording(false);
        setRecordSeconds(0);
        recordSecondsRef.current = 0;
        if (recordCancelledRef.current || recordChunksRef.current.length === 0) return;

        const blob = new Blob(recordChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (!user) return;
        setVoiceUploading(true);
        try {
          const path = `projects/${id}/chat/voice-${Date.now()}.webm`;
          const url = await uploadFile(path, blob, () => {});
          await addDoc(collection(db, "projects", id, "messages"), {
            type: "voice",
            url,
            duration: seconds,
            senderId: user.uid,
            senderName: user.displayName || user.email || "Unknown",
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          setRecordError(err.message || "Couldn't send that voice message.");
        } finally {
          setVoiceUploading(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      recordSecondsRef.current = 0;
      recordTimerRef.current = setInterval(() => {
        recordSecondsRef.current += 1;
        setRecordSeconds(recordSecondsRef.current);
      }, 1000);
    } catch (err) {
      setRecordError("Couldn't access your microphone — check browser permissions.");
    }
  }

  function stopVoiceRecording() {
    recordCancelledRef.current = false;
    mediaRecorderRef.current?.stop();
  }

  function cancelVoiceRecording() {
    recordCancelledRef.current = true;
    mediaRecorderRef.current?.stop();
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
    setChatFilePct(null);
    setChatFileError("");
  }

  async function browseDrive() {
    setBrowsing("drive");
    setBrowseError("");
    setBrowseItems([]);
    try {
      const token = await ensureFreshGoogleToken(myIntegrations);
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

  async function handleChatFileUpload(file) {
    if (!user) return;
    setChatFileError("");
    setChatFilePct(0);
    try {
      const path = `projects/${id}/chat/${Date.now()}-${safeFileName(file.name)}`;
      const url = await uploadFile(path, file, setChatFilePct);

      let driveUrl = null;
      if (alsoAddToDrive && myIntegrations?.driveAccessToken) {
        try {
          const token = await ensureFreshGoogleToken(myIntegrations);
          const driveFile = await uploadFileToDrive(token, project.driveFolderId, file);
          driveUrl = driveFile.url;
        } catch (err) {
          // Non-fatal — the in-app upload already succeeded, so surface the
          // Drive failure as a soft error rather than blocking the message.
          console.error("Couldn't also add file to Drive:", err);
          setChatFileError(`Uploaded, but couldn't add to Drive: ${err.message || "unknown error"}`);
        }
      }

      await addDoc(collection(db, "projects", id, "messages"), {
        type: "attachment",
        url,
        provider: "upload",
        title: file.name,
        fileSize: file.size,
        fileType: file.type || "",
        driveUrl,
        senderId: user.uid,
        senderName: user.displayName || user.email || "Unknown",
        createdAt: serverTimestamp(),
      });
      closeComposerExtra();
    } catch (err) {
      setChatFileError(err.message || "Couldn't upload that file.");
    } finally {
      setChatFilePct(null);
    }
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

  const REACTION_EMOJI = ["👍", "❤️", "😂", "🎉", "😮", "👀"];

  async function toggleReaction(message, emoji) {
    if (!user) return;
    const mine = (message.reactions?.[emoji] || []).includes(user.uid);
    try {
      await updateDoc(doc(db, "projects", id, "messages", message.id), {
        [`reactions.${emoji}`]: mine ? arrayRemove(user.uid) : arrayUnion(user.uid),
      });
    } catch (err) {
      console.error("Failed to react:", err);
    }
    setOpenReactionPicker(null);
  }

  // Activities (whiteboard + retro) has no nav entry of its own anymore —
  // it's only reachable by attaching it from chat (this) or opening it from
  // inside an active Meeting (VideoCall's onOpenActivities). This posts a
  // clickable chat card that jumps everyone to the Activities tab.
  async function sendActivitiesRef() {
    if (!user) return;
    await addDoc(collection(db, "projects", id, "messages"), {
      type: "activities-ref",
      senderId: user.uid,
      senderName: user.displayName || user.email || "Unknown",
      createdAt: serverTimestamp(),
    });
    closeComposerExtra();
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

  // Every new task always lands in "To do" — no per-column add-task forms
  // anymore, just this one, kept simple on purpose. Move it with drag/drop
  // (or the status controls on the card) once work actually starts on it.
  async function createTask() {
    const text = newTaskTitle.trim();
    if (!text) return;
    try {
      await addDoc(collection(db, "projects", id, "tasks"), {
        title: text,
        roleCode: "",
        status: "todo",
        deadline: newTaskDate || null,
        deadlineTime: newTaskDate && newTaskTime ? newTaskTime : null,
        createdAt: serverTimestamp(),
      });
      setNewTaskTitle("");
      setNewTaskDate("");
      setNewTaskTime("");
      setShowAddTask(false);
    } catch (err) {
      console.error("Failed to create task:", err);
    }
  }

  /**
   * Returns { label, tone } describing how close/overdue a deadline is.
   * `deadline` is a YYYY-MM-DD date; `deadlineTime` is an optional HH:MM —
   * without it, a task is considered due at end-of-day.
   */
  function deadlineInfo(deadline, deadlineTime) {
    if (!deadline) return null;
    const due = deadlineTime ? new Date(`${deadline}T${deadlineTime}`) : new Date(`${deadline}T23:59:59`);
    const now = new Date();
    const diffMs = due - now;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const dateLabel = due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const timeLabel = deadlineTime ? due.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
    const fullLabel = timeLabel ? `${dateLabel}, ${timeLabel}` : dateLabel;
    if (diffMs < 0) return { label: `Overdue · ${fullLabel}`, tone: "overdue" };
    if (diffDays === 0) return { label: `Due today${timeLabel ? " · " + timeLabel : ""}`, tone: "soon" };
    if (diffDays <= 2) return { label: `Due ${fullLabel}`, tone: "soon" };
    return { label: `Due ${fullLabel}`, tone: "normal" };
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

  async function handleImageUpload(file) {
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      setImageError("Pick an image file.");
      return;
    }
    setImageError("");
    setImageUploadPct(0);
    try {
      const path = `projects/${id}/cover-${Date.now()}-${safeFileName(file.name)}`;
      const url = await uploadFile(path, file, setImageUploadPct);
      await updateDoc(doc(db, "projects", id), { imageUrl: url, imagePath: path });
    } catch (err) {
      console.error("Image upload failed:", err);
      setImageError(err.message || "Couldn't upload that image.");
    } finally {
      setImageUploadPct(null);
    }
  }

  async function createEvent(e) {
    e.preventDefault();
    if (!user || !project) return;
    const title = eventTitle.trim();
    if (!title || !eventDate || !eventStart || !eventEnd) return;
    setEventBusy(true);
    setEventError("");
    try {
      const startISO = new Date(`${eventDate}T${eventStart}`).toISOString();
      const endISO = new Date(`${eventDate}T${eventEnd}`).toISOString();
      if (new Date(endISO) <= new Date(startISO)) {
        throw new Error("End time has to be after the start time.");
      }

      // Look up teammates' emails so the Google Calendar invite reaches
      // them directly — this doesn't require their own Google token, unlike
      // the GitHub repo-invite flow, since Calendar invites are email-based.
      const otherMemberIds = (project.memberIds || []).filter((uid) => uid !== user.uid);
      const attendeeEmails = [];
      for (const uid of otherMemberIds) {
        try {
          const snap = await getDoc(doc(db, "profiles", uid));
          const email = snap.exists() ? snap.data().email : null;
          if (email) attendeeEmails.push(email);
        } catch {
          // skip — non-fatal, that member just won't get a direct invite
        }
      }

      let googleEventId = null;
      let googleEventUrl = null;
      try {
        const token = await ensureFreshGoogleToken(myIntegrations);
        const gEvent = await createCalendarEvent(token, {
          summary: title,
          description: eventDesc.trim(),
          startISO,
          endISO,
          attendeeEmails,
        });
        googleEventId = gEvent.id;
        googleEventUrl = gEvent.htmlLink;
      } catch (err) {
        // Non-fatal — the event still shows up in-app for every member even
        // if the creator's Google Calendar connection isn't set up.
        console.error("Couldn't create the Google Calendar event:", err);
        setEventError(err.message || "Saved to the project, but couldn't add it to Google Calendar — connect Google in Preferences and try again.");
      }

      await addDoc(collection(db, "projects", id, "events"), {
        title,
        description: eventDesc.trim(),
        start: startISO,
        end: endISO,
        createdBy: user.uid,
        createdByName: user.displayName || user.email || "Unknown",
        googleEventId,
        googleEventUrl,
        createdAt: serverTimestamp(),
      });

      setEventTitle("");
      setEventDate("");
      setEventStart("");
      setEventEnd("");
      setEventDesc("");
    } catch (err) {
      setEventError(err.message || "Couldn't create that event.");
    } finally {
      setEventBusy(false);
    }
  }

  async function removeEvent(evt) {
    if (!user) return;
    try {
      if (evt.googleEventId && myIntegrations?.driveAccessToken) {
        await deleteCalendarEvent(myIntegrations.driveAccessToken, evt.googleEventId).catch(() => {});
      }
      await deleteDoc(doc(db, "projects", id, "events", evt.id));
    } catch (err) {
      console.error("Failed to remove event:", err);
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

  /**
   * Firestore doesn't cascade-delete subcollections, so this walks every
   * one this app creates under a project (tasks/messages/events/
   * whiteboard/retro) and removes each doc before removing the project
   * itself. Owner-only — enforced both here and (should be) in Firestore
   * rules.
   */
  async function deleteProject() {
    if (!user || !project || user.uid !== project.ownerId) return;
    if (!window.confirm(`Permanently delete "${project.name}"? This deletes every task, message, and file reference in it — there's no undo.`)) return;
    setDeletingProject(true);
    try {
      const subcollections = ["tasks", "messages", "events", "whiteboard", "retro"];
      for (const name of subcollections) {
        const snap = await getDocs(collection(db, "projects", id, name));
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      }
      await deleteDoc(doc(db, "projects", id));
      router.replace("/");
    } catch (err) {
      console.error("Failed to delete project:", err);
      setDeletingProject(false);
    }
  }

  if (!user) return <div className="shell" />;

  if (project === null) {
    return (
      <div className="shell">
        <div className="shell-view">
          <p className="notice">Project not found, or still loading.</p>
        </div>
      </div>
    );
  }

  const activeChannel = [...CHANNELS, SETTINGS_CHANNEL, DOCS_CHANNEL, FILES_CHANNEL, ACTIVITIES_CHANNEL].find((c) => c.key === tab);

  return (
    <div className="shell">
      <TopNav user={user} />

      <div className="shell-body">
        <div className="shell-sidebar">
          <div className="shell-switcher" onClick={() => setDropdownOpen((v) => !v)}>
            {project?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={project.imageUrl} alt="" className="shell-swatch" style={{ objectFit: "cover" }} />
            ) : (
              <span className="shell-swatch">{(project?.name || "?").slice(0, 2).toUpperCase()}</span>
            )}
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

          {(project?.driveFolderUrl || project?.githubRepoUrl) && (
            <div style={{ display: "flex", gap: 6, padding: "0 14px 12px" }}>
              {project.driveFolderUrl && (
                <a
                  href={project.driveFolderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open the project's Google Drive folder"
                  style={{ flex: 1, textAlign: "center", padding: "6px 8px", fontSize: 11, fontWeight: 600, color: "var(--s-text-2)", background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)", borderRadius: 7, textDecoration: "none" }}
                >
                  Drive
                </a>
              )}
              {project.githubRepoUrl && (
                <a
                  href={project.githubRepoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open the project's GitHub repo"
                  style={{ flex: 1, textAlign: "center", padding: "6px 8px", fontSize: 11, fontWeight: 600, color: "var(--s-text-2)", background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)", borderRadius: 7, textDecoration: "none" }}
                >
                  GitHub
                </a>
              )}
            </div>
          )}

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
              className={"shell-chan" + (tab === "files" ? " active" : "")}
              onClick={() => setTab("files")}
            >
              Files
            </button>
            <button
              className={"shell-chan" + (tab === "docs" ? " active" : "")}
              onClick={() => setTab("docs")}
            >
              Documentation
            </button>
            <button
              className={"shell-chan" + (tab === "settings" ? " active" : "")}
              onClick={() => setTab("settings")}
            >
              <IconGear /> Settings
            </button>
          </div>
        </div>

        <div className="shell-main">
          <div className="shell-main-top">
            <span className="shell-cname">{activeChannel?.label}</span>
            <span className="shell-cdesc">{activeChannel?.desc}</span>
          </div>

          {tab === "overview" && project && (
            <div className="shell-view" style={{ maxWidth: 640 }}>
              {project.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={project.imageUrl}
                  alt=""
                  style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 14, border: "1px solid var(--s-border)", marginBottom: 22 }}
                />
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 24 }}>
                {[
                  { label: "Members", value: (project.memberIds || []).length },
                  { label: "Open tasks", value: tasks.filter((t) => t.status !== "done").length },
                  { label: "Done", value: tasks.filter((t) => t.status === "done").length },
                  { label: "Open roles", value: (project.roles || []).length },
                ].map((s) => (
                  <div key={s.label} style={{ padding: "14px 16px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 12 }}>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 22 }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: "var(--s-text-3)", marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 6 }}>
                Brief
              </p>
              <p className="shell-brief-text" style={{ marginBottom: 16 }}>
                {project.brief || "No brief yet."}
              </p>

              <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
                Team
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
                {(project.memberIds || []).map((uid) => {
                  void presenceTick; // re-evaluate isOnline() on each tick
                  const profile = memberProfiles[uid] || {};
                  const online = isOnline(profile.lastActiveAt);
                  const name = profile.name || (uid === user?.uid ? user?.displayName || user?.email : "Member");
                  return (
                    <div
                      key={uid}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 6px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 999 }}
                    >
                      <span className="shell-presence-wrap">
                        {profile.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={profile.avatarUrl} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover" }} />
                        ) : (
                          <span className="shell-avatar">{(name || "?")[0]?.toUpperCase()}</span>
                        )}
                        <span className={"shell-presence-dot" + (online ? " online" : "")} title={online ? "Online" : lastSeenLabel(profile.lastActiveAt)} />
                      </span>
                      <span style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {name}
                        {uid === project.ownerId && <span style={{ color: "var(--s-text-3)" }}> · Owner</span>}
                        {(() => {
                          const fm = focusModeInfo(profile.focusMode);
                          return fm ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--s-text-3)" }} title={fm.label}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: fm.color }} />
                              {fm.label}
                            </span>
                          ) : null;
                        })()}
                      </span>
                    </div>
                  );
                })}
              </div>

              {tasks.length > 0 && (
                <>
                  <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
                    Recently added tasks
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
                    {tasks
                      .slice()
                      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
                      .slice(0, 4)
                      .map((t) => {
                        const col = COLUMNS.find((c) => c.key === t.status);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setTab("tasks")}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 9, textAlign: "left", cursor: "pointer", color: "var(--s-text)", fontFamily: "inherit", fontSize: 13 }}
                          >
                            <span style={{ flex: 1 }}>{t.title}</span>
                            {col && <span style={{ fontSize: 10.5, color: "var(--s-text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{col.label}</span>}
                          </button>
                        );
                      })}
                  </div>
                </>
              )}

              {(project.driveFolderUrl || project.githubRepoUrl) && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {project.driveFolderUrl && (
                      <a href={project.driveFolderUrl} target="_blank" rel="noopener noreferrer" className="shell-attachment-card">
                        <span className="shell-attachment-badge drive">Drive</span>
                        <span className="shell-attachment-title">Project folder</span>
                      </a>
                    )}
                    {project.githubRepoUrl && (
                      <a href={project.githubRepoUrl} target="_blank" rel="noopener noreferrer" className="shell-attachment-card">
                        <span className="shell-attachment-badge github">GitHub</span>
                        <span className="shell-attachment-title">{project.githubRepoFullName || "Repository"}</span>
                      </a>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--s-text-3)", marginTop: 6 }}>
                    {project.driveFolderUrl && "Anyone with the Drive link can edit it. "}
                    {project.githubRepoUrl && "Members get a GitHub repo invite (connect GitHub in Preferences to receive it)."}
                  </div>
                </div>
              )}

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
            <div className="shell-view">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13, color: "var(--s-text-2)" }}>
                  {tasks.length} task{tasks.length === 1 ? "" : "s"}
                </div>
                {!showAddTask && (
                  <button type="button" className="shell-task-add-btn" onClick={() => setShowAddTask(true)}>
                    + Add task
                  </button>
                )}
              </div>

              {showAddTask && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    createTask();
                  }}
                  className="shell-card"
                  style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", padding: 16, marginBottom: 18 }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 220px" }}>
                    <label style={{ fontSize: 11, color: "var(--s-text-3)" }}>Task title</label>
                    <input
                      autoFocus
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setShowAddTask(false)}
                      placeholder="What needs to get done?"
                      className="shell-input"
                      style={{ fontFamily: "inherit", fontSize: 13, padding: "10px 12px" }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: "var(--s-text-3)" }}>Due date (optional)</label>
                    <input
                      type="date"
                      value={newTaskDate}
                      onChange={(e) => setNewTaskDate(e.target.value)}
                      className="shell-input"
                      style={{ padding: "9px 10px", fontSize: 12.5, fontFamily: "inherit" }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: "var(--s-text-3)" }}>Due time (optional)</label>
                    <input
                      type="time"
                      value={newTaskTime}
                      onChange={(e) => setNewTaskTime(e.target.value)}
                      disabled={!newTaskDate}
                      className="shell-input"
                      style={{ padding: "9px 10px", fontSize: 12.5, fontFamily: "inherit", opacity: newTaskDate ? 1 : 0.5 }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="submit" className="shell-task-add-btn" disabled={!newTaskTitle.trim()}>
                      Add task
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setShowAddTask(false);
                        setNewTaskTitle("");
                        setNewTaskDate("");
                        setNewTaskTime("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              <div className="shell-board">
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
                            {t.deadline && (() => {
                              const info = deadlineInfo(t.deadline, t.deadlineTime);
                              return info ? <span className={"shell-task-deadline " + info.tone}>{info.label}</span> : null;
                            })()}
                          </div>
                        ))}
                      {tasks.filter((t) => t.status === col.key).length === 0 && (
                        <div style={{ fontSize: 12, color: "var(--s-text-3)", padding: "10px 2px" }}>
                          {col.key === "todo" ? "Nothing here yet — add a task above." : "Drag a task here."}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
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

          {tab === "calendar" && (
            <div className="shell-view" style={{ maxWidth: 640 }}>
              <form onSubmit={createEvent} className="shell-card" style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 13 }}>New event</p>
                <input
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  placeholder="Event title"
                  className="shell-input"
                  style={{ fontFamily: "inherit", fontSize: 13, padding: 10 }}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="shell-input"
                    style={{ fontFamily: "inherit", fontSize: 13, padding: 10 }}
                  />
                  <input
                    type="time"
                    value={eventStart}
                    onChange={(e) => setEventStart(e.target.value)}
                    className="shell-input"
                    style={{ fontFamily: "inherit", fontSize: 13, padding: 10 }}
                  />
                  <span style={{ alignSelf: "center", color: "var(--s-text-3)", fontSize: 12 }}>to</span>
                  <input
                    type="time"
                    value={eventEnd}
                    onChange={(e) => setEventEnd(e.target.value)}
                    className="shell-input"
                    style={{ fontFamily: "inherit", fontSize: 13, padding: 10 }}
                  />
                </div>
                <textarea
                  value={eventDesc}
                  onChange={(e) => setEventDesc(e.target.value)}
                  placeholder="Description (optional)"
                  rows={2}
                  className="shell-input"
                  style={{ fontFamily: "inherit", fontSize: 13, padding: 10, resize: "vertical" }}
                />
                {eventError && <div style={{ fontSize: 11.5, color: "#e5534b" }}>{eventError}</div>}
                <button type="submit" disabled={eventBusy} className="shell-task-add-btn" style={{ alignSelf: "flex-start", padding: "9px 18px" }}>
                  {eventBusy ? "Creating…" : "Add event"}
                </button>
                {!myIntegrations?.driveAccessToken && (
                  <div style={{ fontSize: 11, color: "var(--s-text-3)" }}>
                    Connect Google in <Link href="/account" style={{ color: "var(--s-amber)" }}>Preferences</Link> to send real Google Calendar invites — events still show up here either way.
                  </div>
                )}
              </form>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {events.map((evt) => {
                  const start = evt.start ? new Date(evt.start) : null;
                  const end = evt.end ? new Date(evt.end) : null;
                  const dateLabel = start
                    ? start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
                    : "";
                  const timeLabel =
                    start && end
                      ? `${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} – ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                      : "";
                  return (
                    <div key={evt.id} className="shell-card" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <div style={{ flex: "none", minWidth: 70, fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: "var(--s-text-3)" }}>
                        <div style={{ fontWeight: 700, color: "var(--s-text-2)" }}>{dateLabel}</div>
                        <div>{timeLabel}</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{evt.title}</div>
                        {evt.description && <div style={{ fontSize: 12, color: "var(--s-text-3)", marginTop: 2 }}>{evt.description}</div>}
                        <div style={{ fontSize: 11, color: "var(--s-text-3)", marginTop: 4 }}>
                          Added by {evt.createdByName}
                          {evt.googleEventUrl && (
                            <>
                              {" · "}
                              <a href={evt.googleEventUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--s-amber)" }}>
                                Open in Google Calendar
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                      {evt.createdBy === user?.uid && (
                        <span onClick={() => removeEvent(evt)} style={{ cursor: "pointer", color: "var(--s-text-3)", flex: "none" }} title="Remove event">
                          ×
                        </span>
                      )}
                    </div>
                  );
                })}
                {events.length === 0 && (
                  <p style={{ fontSize: 13, color: "var(--s-text-3)" }}>No events yet — add one above.</p>
                )}
              </div>
            </div>
          )}

          {tab === "activities" && (
            <div className="shell-view" style={{ maxWidth: 760 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
                <button
                  type="button"
                  className={"shell-chan" + (activitySubTab === "whiteboard" ? " active" : "")}
                  style={{ width: "auto" }}
                  onClick={() => setActivitySubTab("whiteboard")}
                >
                  Whiteboard
                </button>
                <button
                  type="button"
                  className={"shell-chan" + (activitySubTab === "retro" ? " active" : "")}
                  style={{ width: "auto" }}
                  onClick={() => setActivitySubTab("retro")}
                >
                  Retro board
                </button>
              </div>

              {activitySubTab === "whiteboard" && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {WHITEBOARD_COLORS.concat(customColors).map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => { setBoardTool("pen"); setBrushColor(c); }}
                          aria-label={`Color ${c}`}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            background: c,
                            border: boardTool === "pen" && brushColor === c ? "2px solid var(--s-amber)" : "2px solid var(--s-border)",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        />
                      ))}
                      <label
                        title="Pick a custom color"
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          border: "2px dashed var(--s-text-3)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          fontSize: 13,
                          color: "var(--s-text-3)",
                          lineHeight: 1,
                          position: "relative",
                          overflow: "hidden",
                        }}
                      >
                        +
                        <input
                          type="color"
                          value={brushColor}
                          onChange={(e) => addCustomColor(e.target.value)}
                          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={() => setBoardTool((t) => (t === "eraser" ? "pen" : "eraser"))}
                      title="Eraser"
                      style={{
                        padding: "5px 12px",
                        borderRadius: 7,
                        fontSize: 12,
                        fontFamily: "'DM Sans', sans-serif",
                        cursor: "pointer",
                        background: boardTool === "eraser" ? "var(--s-amber)" : "transparent",
                        color: boardTool === "eraser" ? "var(--s-amber-ink)" : "var(--s-text-2)",
                        border: "1px solid var(--s-border)",
                      }}
                    >
                      Eraser
                    </button>

                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--s-text-3)" }}>
                      Brush
                      <input type="range" min="1" max="24" value={brushWidth} onChange={(e) => setBrushWidth(parseInt(e.target.value, 10))} />
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--s-text-3)" }}>
                      Opacity
                      <input type="range" min="0.1" max="1" step="0.1" value={brushOpacity} onChange={(e) => setBrushOpacity(parseFloat(e.target.value))} />
                    </label>

                    <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                      <button type="button" onClick={undoLastStroke} disabled={strokes.length === 0} className="ghost">
                        Undo
                      </button>
                      <button type="button" onClick={clearWhiteboard} disabled={boardBusy} className="ghost">
                        {boardBusy ? "Clearing…" : "Clear board"}
                      </button>
                    </div>
                  </div>
                  <canvas
                    ref={canvasRef}
                    width={760}
                    height={420}
                    style={{
                      width: "100%",
                      maxWidth: 760,
                      height: "auto",
                      border: "1px solid var(--s-border)",
                      borderRadius: 12,
                      background: "#fff",
                      touchAction: "none",
                      cursor: boardTool === "eraser" ? "cell" : "crosshair",
                    }}
                    onMouseDown={startStroke}
                    onMouseMove={continueStroke}
                    onMouseUp={endStroke}
                    onMouseLeave={endStroke}
                    onTouchStart={startStroke}
                    onTouchMove={continueStroke}
                    onTouchEnd={endStroke}
                  />
                </div>
              )}

              {activitySubTab === "retro" && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
                  {RETRO_COLUMNS.map((col) => (
                    <div key={col.key}>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12.5, color: col.color, marginBottom: 8 }}>
                        {col.label}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                        {retroNotes
                          .filter((n) => n.column === col.key)
                          .map((n) => (
                            <div key={n.id} className="shell-retro-note" style={{ borderLeft: `4px solid ${col.color}` }}>
                              <div style={{ fontSize: 12.5 }}>{n.text}</div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                                <span style={{ fontSize: 10, color: "var(--s-text-3)" }}>{n.name}</span>
                                {n.uid === user?.uid && (
                                  <span onClick={() => removeRetroNote(n.id)} style={{ cursor: "pointer", color: "var(--s-text-3)", fontSize: 12 }}>
                                    ×
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          addRetroNote(col.key);
                        }}
                      >
                        <textarea
                          value={retroDrafts[col.key]}
                          onChange={(e) => setRetroDrafts((prev) => ({ ...prev, [col.key]: e.target.value }))}
                          placeholder="Add a note…"
                          rows={2}
                          className="shell-input"
                          style={{ width: "100%", fontFamily: "inherit", fontSize: 12.5, padding: 8, resize: "vertical" }}
                        />
                        <button type="submit" className="shell-task-add-btn" style={{ marginTop: 6, padding: "6px 12px", fontSize: 11 }}>
                          Add
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "chat" && (
            <div className="shell-view" style={{ maxWidth: 640 }}>
              <VideoCall
                projectId={id}
                onOpenActivities={() => setTab("activities")}
                startSignal={meetingStartSignal}
                preferredMicId={memberProfiles[user?.uid]?.preferences?.micId}
                preferredCamId={memberProfiles[user?.uid]?.preferences?.camId}
              />
              <div className="shell-chat-panel">
                <div className="shell-msgs">
                  {messages.map((m) => (
                    <div key={m.id} className={"shell-msg" + (m.mentions?.includes(user?.uid) ? " mentioned" : "")}>
                      <span className="shell-presence-wrap" style={{ marginTop: 2 }}>
                        <span className="shell-avatar">{m.senderName?.[0]?.toUpperCase()}</span>
                        {(() => {
                          void presenceTick;
                          const online = isOnline(memberProfiles[m.senderId]?.lastActiveAt);
                          return <span className={"shell-presence-dot" + (online ? " online" : "")} />;
                        })()}
                      </span>
                      <div className="shell-msg-body" style={{ flex: 1 }}>
                        <b>{m.senderName}</b>

                        {(!m.type || m.type === "text") && (
                          <>
                            <p>{renderMessageText(m.text)}</p>
                            {!translations[m.id] && (
                              <button
                                type="button"
                                onClick={() => translateMessage(m)}
                                style={{ background: "none", border: "none", padding: 0, marginTop: 2, fontSize: 11, color: "var(--s-text-3)", cursor: "pointer" }}
                              >
                                Translate
                              </button>
                            )}
                            {translations[m.id]?.loading && (
                              <div style={{ fontSize: 11, color: "var(--s-text-3)", marginTop: 2 }}>Translating…</div>
                            )}
                            {translations[m.id]?.error && (
                              <div style={{ fontSize: 11, color: "#e5534b", marginTop: 2 }}>{translations[m.id].error}</div>
                            )}
                            {translations[m.id]?.text && (
                              <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--s-border)" }}>
                                <p style={{ fontStyle: "italic" }}>{translations[m.id].text}</p>
                                <button
                                  type="button"
                                  onClick={() => dismissTranslation(m.id)}
                                  style={{ background: "none", border: "none", padding: 0, fontSize: 11, color: "var(--s-text-3)", cursor: "pointer" }}
                                >
                                  Hide translation
                                </button>
                              </div>
                            )}
                          </>
                        )}

                        {m.type === "attachment" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {m.provider === "upload" && m.fileType?.startsWith("image/") && (
                              <a href={m.url} target="_blank" rel="noopener noreferrer">
                                <img src={m.url} alt={m.title} style={{ maxWidth: 320, maxHeight: 260, borderRadius: 10, border: "1px solid var(--s-border)", display: "block" }} />
                              </a>
                            )}
                            {m.provider === "upload" && m.fileType?.startsWith("video/") && (
                              <video src={m.url} controls style={{ maxWidth: 360, maxHeight: 260, borderRadius: 10, border: "1px solid var(--s-border)" }} />
                            )}
                            {m.provider === "upload" && m.fileType?.startsWith("audio/") && (
                              <audio src={m.url} controls style={{ maxWidth: 320 }} />
                            )}
                            {m.provider === "upload" && m.fileType === "application/pdf" && (
                              <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
                                <iframe src={m.url} style={{ width: 320, height: 220, border: "1px solid var(--s-border)", borderRadius: 10, pointerEvents: "none" }} title={m.title} />
                              </a>
                            )}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <a
                                href={m.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shell-attachment-card"
                              >
                                <span className={"shell-attachment-badge " + m.provider}>
                                  {m.provider === "drive" ? "Drive" : m.provider === "github" ? "GitHub" : m.provider === "upload" ? "File" : "Link"}
                                </span>
                                <span className="shell-attachment-title">{m.title}</span>
                                {m.provider === "upload" && m.fileSize ? (
                                  <span className="shell-attachment-meta">{Math.round(m.fileSize / 1024)}KB</span>
                                ) : null}
                              </a>
                              {m.driveUrl && (
                                <a href={m.driveUrl} target="_blank" rel="noopener noreferrer" className="shell-attachment-card">
                                  <span className="shell-attachment-badge drive">Drive</span>
                                  <span className="shell-attachment-title">Also on Drive</span>
                                </a>
                              )}
                              {m.provider === "upload" && guessCadKind(m.title) && (
                                <button
                                  type="button"
                                  className="ghost"
                                  style={{ border: "1px solid var(--s-border)", borderRadius: 7, padding: "6px 10px", fontSize: 12 }}
                                  onClick={() => setViewingCad({ url: m.url, kind: guessCadKind(m.title) })}
                                >
                                  View in 3D
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {m.type === "voice" && (
                          <div className="shell-voice-msg">
                            <audio controls src={m.url} style={{ height: 34, maxWidth: 260 }} />
                            {m.duration ? (
                              <span className="shell-attachment-meta">
                                {String(Math.floor(m.duration / 60)).padStart(1, "0")}:{String(m.duration % 60).padStart(2, "0")}
                              </span>
                            ) : null}
                          </div>
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

                        {m.type === "activities-ref" && (
                          <button type="button" className="shell-taskref-card" onClick={() => setTab("activities")}>
                            <IconSparkle size={13} />
                            Activities — whiteboard & retro board
                          </button>
                        )}

                        <div className="shell-reactions-row">
                          {Object.entries(m.reactions || {})
                            .filter(([, uids]) => (uids || []).length > 0)
                            .map(([emoji, uids]) => (
                              <button
                                key={emoji}
                                type="button"
                                className={"shell-reaction-chip" + (uids.includes(user?.uid) ? " mine" : "")}
                                onClick={() => toggleReaction(m, emoji)}
                              >
                                {emoji} {uids.length}
                              </button>
                            ))}
                          <span style={{ position: "relative" }}>
                            <button
                              type="button"
                              className="shell-reaction-add"
                              onClick={() => setOpenReactionPicker(openReactionPicker === m.id ? null : m.id)}
                            >
                              +
                            </button>
                            {openReactionPicker === m.id && (
                              <div className="shell-reaction-picker">
                                {REACTION_EMOJI.map((emoji) => (
                                  <button key={emoji} type="button" onClick={() => toggleReaction(m, emoji)}>
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            )}
                          </span>
                        </div>
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

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 12px",
                          border: "1px solid var(--s-border)",
                          borderRadius: 7,
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "var(--s-text-2)",
                          cursor: chatFilePct !== null ? "not-allowed" : "pointer",
                        }}
                      >
                        {chatFilePct !== null ? `Uploading… ${chatFilePct}%` : "Upload from your computer"}
                        <input
                          type="file"
                          disabled={chatFilePct !== null}
                          onChange={(e) => e.target.files[0] && handleChatFileUpload(e.target.files[0])}
                          style={{ display: "none" }}
                        />
                      </label>
                      {myIntegrations?.driveAccessToken && project?.driveFolderId && (
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--s-text-2)", cursor: "pointer" }}>
                          <Toggle checked={alsoAddToDrive} onChange={setAlsoAddToDrive} />
                          Also add to Drive
                        </label>
                      )}
                    </div>
                    {chatFileError && <div style={{ fontSize: 11, color: "#e5534b" }}>{chatFileError}</div>}

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
                        Connect Drive or GitHub in <Link href="/account" style={{ color: "var(--s-amber)" }}>Preferences</Link> to browse and attach without pasting a link.
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

                {composerMode === null && recording && (
                  <div className="shell-composer shell-recording-bar">
                    <span className="shell-recording-dot" />
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600 }}>
                      Recording… {String(Math.floor(recordSeconds / 60)).padStart(1, "0")}:{String(recordSeconds % 60).padStart(2, "0")}
                    </span>
                    <button type="button" onClick={cancelVoiceRecording} className="ghost" style={{ marginLeft: "auto" }}>
                      Cancel
                    </button>
                    <button type="button" onClick={stopVoiceRecording}>
                      Send
                    </button>
                  </div>
                )}

                {composerMode === null && !recording && (
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
                          <div className="shell-proj-row" onClick={() => { setMeetingStartSignal(Date.now()); setComposerMenuOpen(false); }}>
                            Start a meeting
                          </div>
                          <div className="shell-proj-row" onClick={() => { sendActivitiesRef(); setComposerMenuOpen(false); }}>
                            Open Activities (whiteboard & retro)
                          </div>
                        </div>
                      )}
                    </div>
                    <div style={{ position: "relative", flex: 1 }}>
                      {mentionOpen && (() => {
                        const candidates = memberMentionNames()
                          .filter((m) => m.uid !== user?.uid && m.name.toLowerCase().includes(mentionQuery))
                          .slice(0, 6);
                        if (candidates.length === 0) return null;
                        return (
                          <div className="shell-composer-menu" style={{ position: "absolute", bottom: "100%", left: 0, marginBottom: 6, minWidth: 180, zIndex: 5 }}>
                            {candidates.map((m) => (
                              <div key={m.uid} className="shell-proj-row" onClick={() => pickMention(m.name)}>
                                @{m.name}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      <input
                        value={msgText}
                        onChange={handleMsgTextChange}
                        onKeyDown={(e) => e.key === "Escape" && setMentionOpen(false)}
                        placeholder="Message the team — @ to mention someone"
                        style={{ width: "100%" }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={startVoiceRecording}
                      disabled={voiceUploading}
                      className="shell-mic-btn"
                      aria-label="Record a voice message"
                      title="Record a voice message"
                    >
                      {voiceUploading ? "…" : <IconMic size={16} />}
                    </button>
                    <button type="submit">Send</button>
                  </form>
                )}
                {recordError && <div style={{ fontSize: 11.5, color: "#e5534b", padding: "0 14px 10px" }}>{recordError}</div>}
              </div>
            </div>
          )}

          {tab === "files" && (
            <div className="shell-view">
              {(() => {
                const files = messages
                  .filter((m) => m.type === "attachment" || m.type === "voice")
                  .slice()
                  .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
                if (files.length === 0) {
                  return (
                    <p style={{ fontSize: 13, color: "var(--s-text-3)" }}>
                      Nothing shared yet — files and links attached in Team chat show up here automatically.
                    </p>
                  );
                }
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {files.map((m) => (
                      <div
                        key={m.id}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 10, flexWrap: "wrap" }}
                      >
                        <span className={"shell-attachment-badge " + (m.provider || "voice")} style={{ flex: "none" }}>
                          {m.type === "voice" ? "Voice" : m.provider === "drive" ? "Drive" : m.provider === "github" ? "GitHub" : m.provider === "upload" ? "File" : "Link"}
                        </span>
                        <div style={{ flex: 1, minWidth: 140 }}>
                          <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--s-text)", fontSize: 13.5, textDecoration: "none" }}>
                            {m.type === "voice" ? "Voice message" : m.title || m.url}
                          </a>
                          <div style={{ fontSize: 11, color: "var(--s-text-3)", marginTop: 2 }}>
                            {m.senderName || "Unknown"}
                            {m.fileSize ? ` · ${Math.round(m.fileSize / 1024)}KB` : ""}
                            {m.createdAt?.toDate ? ` · ${m.createdAt.toDate().toLocaleDateString()}` : ""}
                          </div>
                        </div>
                        {m.provider === "upload" && guessCadKind(m.title) && (
                          <button
                            type="button"
                            className="ghost"
                            style={{ border: "1px solid var(--s-border)", borderRadius: 7, padding: "6px 10px", fontSize: 12 }}
                            onClick={() => { setTab("chat"); setViewingCad({ url: m.url, kind: guessCadKind(m.title) }); }}
                          >
                            View in 3D
                          </button>
                        )}
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setTab("chat")}
                          style={{ fontSize: 11.5 }}
                        >
                          Jump to chat
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {tab === "docs" && project && (
            <div className="shell-view" style={{ maxWidth: 720 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
                <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", margin: 0 }}>
                  Shared notes
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {docsSavedAt && !docsSaving && docsDraft === (project.docsContent || "") && (
                    <span style={{ fontSize: 11, color: "var(--s-text-3)" }}>Saved</span>
                  )}
                  <button
                    onClick={saveDocs}
                    disabled={docsSaving || docsDraft === (project.docsContent || "")}
                    className="shell-task-add-btn"
                    style={{ padding: "8px 16px" }}
                  >
                    {docsSaving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
              <p style={{ fontSize: 12, color: "var(--s-text-3)", marginBottom: 12 }}>
                Anything worth keeping handy — setup steps, decisions, links, glossary. Visible to every member, editable by every member.
              </p>
              <textarea
                value={docsDraft}
                onChange={(e) => setDocsDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveDocs();
                }}
                placeholder="Start writing…"
                className="shell-input"
                style={{ width: "100%", minHeight: 420, fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.6, padding: 16, resize: "vertical" }}
              />
            </div>
          )}

          {tab === "settings" && project && (
            <div className="shell-view" style={{ maxWidth: 560 }}>
              <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
                Image
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
                {project.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={project.imageUrl} alt="" style={{ width: 88, height: 88, borderRadius: 12, objectFit: "cover", border: "1px solid var(--s-border)" }} />
                ) : (
                  <div style={{ width: 88, height: 88, borderRadius: 12, background: "var(--s-bg-elevated)", border: "1px dashed var(--s-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--s-text-3)", textAlign: "center", padding: 6 }}>
                    No image
                  </div>
                )}
                <div>
                  <label
                    style={{
                      display: "inline-block",
                      padding: "9px 16px",
                      background: "var(--s-bg-elevated)",
                      border: "1px solid var(--s-border)",
                      borderRadius: 7,
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: imageUploadPct !== null ? "not-allowed" : "pointer",
                      color: "var(--s-text-2)",
                    }}
                  >
                    {imageUploadPct !== null ? `Uploading… ${imageUploadPct}%` : project.imageUrl ? "Change image" : "Upload image"}
                    <input
                      type="file"
                      accept="image/*"
                      disabled={imageUploadPct !== null}
                      onChange={(e) => e.target.files[0] && handleImageUpload(e.target.files[0])}
                      style={{ display: "none" }}
                    />
                  </label>
                  <div style={{ fontSize: 11, color: "var(--s-text-3)", marginTop: 6 }}>
                    From your device.
                  </div>
                  {imageError && <div style={{ fontSize: 11, color: "#e5534b", marginTop: 4 }}>{imageError}</div>}
                </div>
              </div>

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
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={leaveProject}
                  disabled={leaving}
                  style={{ background: "transparent", border: "1px solid #e5534b", color: "#e5534b", borderRadius: 7, padding: "10px 16px", fontFamily: "'DM Sans', sans-serif", fontSize: 12.5, cursor: "pointer" }}
                >
                  {leaving ? "Leaving…" : "Leave project"}
                </button>
                {user?.uid === project.ownerId && (
                  <button
                    onClick={deleteProject}
                    disabled={deletingProject}
                    style={{ background: "#e5534b", border: "1px solid #e5534b", color: "#fff", borderRadius: 7, padding: "10px 16px", fontFamily: "'DM Sans', sans-serif", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                  >
                    {deletingProject ? "Deleting…" : "Delete project"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {viewingCad && (
        <CADViewer url={viewingCad.url} kind={viewingCad.kind} onClose={() => setViewingCad(null)} />
      )}
    </div>
  );
}
