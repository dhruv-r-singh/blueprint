"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
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
  listCalendarEvents,
  uploadFileToDrive,
} from "../../../lib/integrations";
import { uploadFile, safeFileName, compressImage } from "../../../lib/storage";
import { aiComplete, aiCompleteJSON } from "../../../lib/ai";
import Autocomplete from "../../components/Autocomplete";
import TopNav from "../../components/TopNav";
import CADViewer, { guessCadKind } from "../../components/CADViewer";
import GuidedTour from "../../components/GuidedTour";
import MessageRequestModal from "../../components/MessageRequestModal";
import VideoPlayer from "../../components/VideoPlayer";
import AudioPlayer from "../../components/AudioPlayer";
import Toggle from "../../components/Toggle";
import { IconGear, IconMic, IconSparkle, IconLayout, IconCheckSquare, IconTarget, IconCalendar, IconChat, IconGithubMark, IconDriveMark, IconReply, IconReact, IconTranslate, IconSearch, IconMailbox } from "../../components/icons";
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

// Rough keyword expansion for each short role code, so a role like
// "SW-101 Frontend Engineer" can be matched against a real profile's
// skills/headline even though nobody's typing "SW" into their own skill
// list. Not an exact taxonomy — just enough signal to rank real people
// instead of requiring a fake, hand-curated candidate pool.
const ROLE_KEYWORDS = {
  SW: ["software", "engineer", "engineering", "developer", "frontend", "front-end", "backend", "back-end", "full-stack", "fullstack", "web", "app", "mobile", "programming", "code", "javascript", "python"],
  AI: ["ai", "ml", "machine learning", "data", "model", "nlp", "vision", "pytorch", "tensorflow"],
  CAD: ["cad", "mechanical", "design", "prototyping", "hardware", "3d", "solidworks", "fusion"],
  HW: ["hardware", "electrical", "embedded", "firmware", "circuit", "pcb", "arduino"],
  BIZ: ["business", "finance", "financial", "marketing", "sales", "operations", "growth", "partnerships", "fundraising", "accounting", "legal"],
  UX: ["design", "ux", "ui", "product", "user", "research", "figma"],
};

/** Rough 0+ match score for how well a real profile fits an open role, from overlapping skills/headline keywords — not exact NLP, just enough to rank real people instead of needing a hand-curated fake candidate pool. */
function matchScoreForRole(role, profile) {
  const roleText = `${role.code || ""} ${role.title || ""}`.toLowerCase();
  const roleWords = new Set(roleText.split(/[\s/,-]+/).filter(Boolean));
  const prefix = (role.code || "").replace(/[0-9-]/g, "").toUpperCase();
  for (const w of ROLE_KEYWORDS[prefix] || []) roleWords.add(w);

  const skills = (profile.skills || []).map((s) => s.toLowerCase());
  const headline = (profile.headline || "").toLowerCase();

  let score = 0;
  for (const skill of skills) {
    if (roleText.includes(skill)) score += 2;
    else if ([...roleWords].some((w) => w.length > 2 && (skill.includes(w) || w.includes(skill)))) score += 2;
  }
  for (const w of roleWords) {
    if (w.length > 2 && headline.includes(w)) score += 1;
  }
  return score;
}

/** Turns a raw keyword-overlap score into a display percentage, roughly matching the range the old hand-picked match scores used. */
function matchScoreToPercent(score) {
  return Math.min(98, 52 + score * 9);
}

const CHANNELS = [
  { key: "overview", label: "Overview", desc: "Brief, roles, and status for this project", Icon: IconLayout },
  { key: "tasks", label: "Tasks", desc: "Drag cards between columns", Icon: IconCheckSquare },
  { key: "matches", label: "Matches", desc: "Ranked candidates for the roles still open", Icon: IconTarget },
  { key: "calendar", label: "Calendar", desc: "Shared events for this project", Icon: IconCalendar },
  { key: "chat", label: "Team chat", desc: "", Icon: IconChat },
];

const WHITEBOARD_COLORS = ["#1a1a1a", "#e5534b", "#e0a339", "#5fbf8f", "#6fa8d8", "#c46fd8"];

// First-login walkthrough — see components/GuidedTour.js. Each `selector`
// matches a `data-tour="..."` attribute already on the real element, so
// there's nothing fake to keep in sync as the UI changes.
const TOUR_STEPS = [
  {
    selector: "switcher",
    title: "This is your project switcher",
    body: "Jump between every project you're part of, or start a new one, from right here.",
  },
  {
    selector: "channels",
    title: "Everything for this project",
    body: "Overview, Tasks, Matches, Calendar, and Team chat all live in these channels.",
  },
  {
    selector: "settings-btn",
    title: "Invite your team",
    body: "Settings has your invite link and 8-character join code, plus project details and roles.",
  },
  {
    selector: "account-menu",
    title: "Your account",
    body: "Profile, Preferences (theme, accent color, notifications), and sign out all live up here.",
  },
];

const SETTINGS_CHANNEL = { key: "settings", label: "Settings", desc: "Project name, roles, and invites" };
const DOCS_CHANNEL = { key: "docs", label: "Documentation", desc: "Shared notes for this project" };
const FILES_CHANNEL = { key: "files", label: "Files", desc: "Every file and link shared in this project" };
// Activities has no sidebar nav entry (only reachable via chat's "Open
// Activities" attachment or from inside a Meeting), but still needs a
// label/desc for the header when it IS open — see activeChannel below.
const ACTIVITIES_CHANNEL = { key: "activities", label: "Whiteboard", desc: "Draw together in real time" };

export default function ProjectPage() {
  const { id } = useParams();
  const router = useRouter();
  const [user, setUser] = useState(undefined);
  const [tab, setTab] = useState("overview");
  // undefined = still loading (haven't heard back from Firestore yet);
  // null = Firestore confirmed the project doesn't exist (or isn't
  // accessible). Collapsing these into one state is what caused the old
  // "Project not found, or still loading" message to flash on every single
  // page load, even for projects that loaded fine a moment later.
  const [project, setProject] = useState(undefined);
  const [myProjects, setMyProjects] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [draggedId, setDraggedId] = useState(null);
  const [allProfiles, setAllProfiles] = useState([]);
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
  const [aiRolesLoading, setAiRolesLoading] = useState(false);
  const [aiSuggestedRoles, setAiSuggestedRoles] = useState([]);
  const [aiRolesError, setAiRolesError] = useState("");
  const [aiSummaryOpen, setAiSummaryOpen] = useState(false);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryText, setAiSummaryText] = useState("");
  const [aiSummaryError, setAiSummaryError] = useState("");
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
  const [customReactionInput, setCustomReactionInput] = useState("");
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
  const knownMessageIdsRef = useRef(new Set());
  const messagesFirstLoadRef = useRef(true);
  const msgsEndRef = useRef(null);
  // "Autoplay voice messages" (Preferences → Notifications → Composing) —
  // ids of voice messages that just arrived, so AudioPlayer knows to
  // autoplay only those and never a voice message you're scrolling past in
  // history. Populated by the same effect that detects new messages below.
  const [autoPlayVoiceIds, setAutoPlayVoiceIds] = useState(new Set());
  const recordChunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const recordCancelledRef = useRef(false);
  const recordSecondsRef = useRef(0);
  const spectrogramCanvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const audioAnalyserRef = useRef(null);
  const spectrogramRafRef = useRef(null);
  const [strokes, setStrokes] = useState([]);
  const [brushColor, setBrushColor] = useState(WHITEBOARD_COLORS[0]);
  const [brushWidth, setBrushWidth] = useState(3);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [boardTool, setBoardTool] = useState("pen"); // "pen" | "eraser"
  const [customColors, setCustomColors] = useState([]);
  const [boardBusy, setBoardBusy] = useState(false);
  const [boardError, setBoardError] = useState("");
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const currentPointsRef = useRef([]);
  const [viewingCad, setViewingCad] = useState(null); // { url, kind } | null
  const [memberProfiles, setMemberProfiles] = useState({}); // uid -> profile doc data
  const [translations, setTranslations] = useState({}); // messageId -> { text, loading, error, lang, sameLanguage }
  const [presenceTick, setPresenceTick] = useState(0); // bumps periodically so online/offline labels stay fresh
  const [replyingTo, setReplyingTo] = useState(null); // { id, senderName, text } | null
  const [chatSearch, setChatSearch] = useState("");
  const [messageTarget, setMessageTarget] = useState(null); // { toUid, toLabel } | null — toUid is null for a seed candidate
  const [stagedAttachment, setStagedAttachment] = useState(null); // attachment fields waiting for Send, not yet posted
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [googleCalEvents, setGoogleCalEvents] = useState([]);
  const [calSelectedDay, setCalSelectedDay] = useState(null); // "YYYY-MM-DD" | null — filters the list below the grid
  const [showTour, setShowTour] = useState(false);
  const tourDecidedRef = useRef(false);

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

  // Show the guided tour exactly once per account — first time this project
  // page loads with the viewer's own profile doc in hand and `tourSeen`
  // isn't set yet. tourDecidedRef guards against re-triggering off of every
  // later profile snapshot update (e.g. changing your avatar mid-tour).
  useEffect(() => {
    if (tourDecidedRef.current || !user?.uid) return;
    const mine = memberProfiles[user.uid];
    if (!mine) return; // still loading
    tourDecidedRef.current = true;
    if (!mine.tourSeen) setShowTour(true);
  }, [memberProfiles, user?.uid]);

  function finishTour() {
    setShowTour(false);
    if (user?.uid) {
      setDoc(doc(db, "profiles", user.uid), { tourSeen: true }, { merge: true }).catch((err) =>
        console.error("Couldn't save tour progress:", err)
      );
    }
  }

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

  // Matches now ranks real signed-up people instead of seeded fake
  // candidates — everyone's public profile doc (profiles/{uid}), minus
  // whoever's already on this project. A one-time fetch rather than a live
  // listener: this list only needs to be reasonably fresh when Matches is
  // opened, and Firestore doesn't support "not in this array" as a live
  // query filter anyway, so the membership exclusion happens client-side.
  useEffect(() => {
    if (tab !== "matches" || !user) return;
    (async () => {
      try {
        const snap = await getDocs(collection(db, "profiles"));
        const memberSet = new Set(project?.memberIds || []);
        setAllProfiles(
          snap.docs
            .filter((d) => !memberSet.has(d.id))
            // Discoverable defaults to on (undefined !== false) so existing
            // accounts keep showing up here unless they explicitly opt out
            // via the "Discoverable" switch in Preferences.
            .filter((d) => d.data()?.preferences?.discoverable !== false)
            .map((d) => ({ uid: d.id, ...d.data() }))
        );
      } catch (err) {
        console.error("Couldn't load profiles for matching:", err);
      }
    })();
  }, [tab, user, project?.memberIds]);

  useEffect(() => {
    // Deliberately NOT gated on tab (beyond needing a project loaded) — the
    // "new message" chime below needs this subscription live no matter which
    // tab of the project is open, not just while literally staring at Chat.
    if (!id) return;
    // Starting fresh for this project — don't let the "new message" sound
    // effect below treat the initial bulk load as a wave of new messages.
    knownMessageIdsRef.current = new Set();
    messagesFirstLoadRef.current = true;
    const q = query(collection(db, "projects", id, "messages"), orderBy("createdAt"));
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
    // Deliberately excludes `tab` — re-subscribing on every tab switch would
    // reset knownMessageIdsRef and risk re-chiming for messages that arrived
    // while on a different tab, which defeats the point of this change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Keep the chat pinned to the newest message — runs on every messages
  // change (new send, delete, reaction, etc.) while the chat tab is open.
  useEffect(() => {
    if (tab !== "chat") return;
    msgsEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, tab]);

  // "Sound on new message" / "Only for @mentions" preferences (Preferences
  // → Notifications). Plays a short two-tone chime via the Web Audio API
  // (no audio file to ship/load) whenever a message from someone else shows
  // up while this project's chat is mounted. Skips the initial bulk load
  // and anything the current user themself just sent.
  useEffect(() => {
    const incomingIds = messages.map((m) => m.id);
    if (messagesFirstLoadRef.current) {
      knownMessageIdsRef.current = new Set(incomingIds);
      messagesFirstLoadRef.current = false;
      return;
    }
    const prefs = memberProfiles[user?.uid]?.preferences || {};
    const myFocusMode = memberProfiles[user?.uid]?.focusMode || "available";
    const newOnes = messages.filter((m) => !knownMessageIdsRef.current.has(m.id) && m.senderId !== user?.uid);
    knownMessageIdsRef.current = new Set(incomingIds);
    if (newOnes.length === 0) return;

    // "Auto-translate incoming messages" (Preferences → Notifications →
    // Composing) — independent of the chime settings below, so it still
    // works with sound off. Only text messages have anything to translate.
    if (prefs.autoTranslate) {
      newOnes.filter((m) => (!m.type || m.type === "text") && m.text).forEach((m) => translateMessage(m));
    }
    if (prefs.autoPlayVoiceMessages) {
      const voiceIds = newOnes.filter((m) => m.type === "voice").map((m) => m.id);
      if (voiceIds.length > 0) setAutoPlayVoiceIds((prev) => new Set([...prev, ...voiceIds]));
    }

    // Only chime while status is "Available" — Focusing/In a meeting/Away
    // all mean "don't ping me." (Profile, Preferences, and Sign-in never
    // mount this component at all, so those are excluded automatically.)
    if (!prefs.messageSound || myFocusMode !== "available") return;
    const relevant = prefs.messageSoundMentionsOnly ? newOnes.some((m) => m.mentions?.includes(user?.uid)) : true;
    if (!relevant) return;
    try {
      // Chime tone + volume (Preferences → Notifications → Chat). Each
      // preset is just a different frequency sequence and gain envelope —
      // no audio files to ship/load, same as the original two-tone chime.
      const peak = 0.12 * (prefs.chimeVolume ?? 0.6) * (1 / 0.6);
      const tones = {
        classic: { freqs: [740, 990], step: 0.09, hold: 0.16 },
        soft: { freqs: [520, 660], step: 0.11, hold: 0.22 },
        chirp: { freqs: [900, 1300, 1700], step: 0.06, hold: 0.1 },
        marimba: { freqs: [660, 880, 660], step: 0.1, hold: 0.2 },
      };
      const { freqs, step, hold } = tones[prefs.chimeTone] || tones.classic;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const start = now + i * step;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + hold);
        osc.start(start);
        osc.stop(start + hold + 0.02);
      });
    } catch (err) {
      // Some browsers block audio until the user has interacted with the
      // page at least once — that's fine, just no chime this time.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  useEffect(() => {
    if (tab !== "calendar" || !id) return;
    const q = query(collection(db, "projects", id, "events"), orderBy("start"));
    const unsub = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [tab, id]);

  // Pulls the caller's own Google Calendar events for the visible month so
  // the grid reflects real Calendar data (meetings booked outside Blueprint
  // too), not just events this app itself created — merged with `events`
  // (the in-app/Firestore copy) at render time, de-duplicated by
  // googleEventId so an app-created event doesn't show up twice.
  useEffect(() => {
    if (tab !== "calendar" || !myIntegrations?.driveAccessToken) {
      setGoogleCalEvents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await ensureFreshGoogleToken(myIntegrations);
        const rangeStart = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
        const rangeEnd = new Date(calMonth.getFullYear(), calMonth.getMonth() + 2, 0);
        const items = await listCalendarEvents(token, {
          timeMinISO: rangeStart.toISOString(),
          timeMaxISO: rangeEnd.toISOString(),
        });
        if (!cancelled) setGoogleCalEvents(items);
      } catch (err) {
        console.error("Couldn't load Google Calendar events:", err);
        if (!cancelled) setGoogleCalEvents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, calMonth.getFullYear(), calMonth.getMonth(), myIntegrations?.driveAccessToken]);

  useEffect(() => {
    if (tab !== "activities" || !id) return;
    const q = query(collection(db, "projects", id, "whiteboard"), orderBy("createdAt"));
    const unsub = onSnapshot(q, (snap) => {
      setStrokes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [tab, id]);

  // Redraw the whole board any time strokes change — strokes are only
  // written to Firestore once a pen stroke is lifted (not live per-point),
  // so this keeps every member's canvas in sync without a huge write volume.
  useEffect(() => {
    if (tab !== "activities" || !canvasRef.current) return;
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
  }, [strokes, tab]);

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
    setBoardError("");
    try {
      await deleteDoc(doc(db, "projects", id, "whiteboard", last.id));
    } catch (err) {
      console.error("Failed to undo stroke:", err);
      setBoardError(
        err.code === "permission-denied"
          ? "Couldn't undo. You don't have permission to edit this board (check Firestore rules)."
          : "Couldn't undo that stroke. Try again."
      );
    }
  }

  function addCustomColor(hex) {
    setBrushColor(hex);
    setCustomColors((prev) => (prev.includes(hex) ? prev : [hex, ...prev].slice(0, 6)));
  }

  async function clearWhiteboard() {
    setBoardBusy(true);
    setBoardError("");
    try {
      const snap = await getDocs(collection(db, "projects", id, "whiteboard"));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    } catch (err) {
      console.error("Failed to clear whiteboard:", err);
      setBoardError(
        err.code === "permission-denied"
          ? "Couldn't clear the board. You don't have permission to edit this board (check Firestore rules)."
          : "Couldn't clear the board. Try again."
      );
    } finally {
      setBoardBusy(false);
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

  /** Writes a "message request" — a subject + message that shows up in the recipient's Mailbox (see components/Mailbox.js), rather than dropping straight into project chat. `toUid` is null when the target is a seed candidate on Matches, not a real account — it still gets saved (as an outreach record on this project), it's just never delivered anywhere, since there's no real user behind it. */
  async function sendMessageRequest({ toUid, toLabel, subject, message }) {
    if (!user) return;
    await addDoc(collection(db, "messageRequests"), {
      toUid: toUid || null,
      toLabel,
      fromUid: user.uid,
      fromName: user.displayName || user.email || "Unknown",
      projectId: id,
      subject,
      message,
      read: false,
      // Gates replies: a stranger's first message needs an explicit Accept
      // before either side can go back and forth — see Mailbox.js.
      status: "pending",
      replies: [],
      createdAt: serverTimestamp(),
    });
  }

  /** True if two messages were sent within 5 minutes of each other — used to decide whether consecutive messages from the same sender should visually collapse into one group. */
  function withinGroupWindow(a, b) {
    const at = a?.toMillis ? a.toMillis() : null;
    const bt = b?.toMillis ? b.toMillis() : null;
    if (!at || !bt) return false;
    return Math.abs(at - bt) < 5 * 60 * 1000;
  }

  /** True if a message's visible text/caption/attachment title/sender name contains the search query (case-insensitive). */
  function messageMatchesSearch(m, query) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const haystack = [m.text, m.caption, m.title, m.senderName].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(q);
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
  // for this browser. Target language defaults to the "Translation
  // language" preference set in Preferences → Appearance, falling back to
  // the browser's own language if that's unset.
  async function translateMessage(m) {
    const target = memberProfiles[user?.uid]?.preferences?.translateLanguage || (navigator.language || "en").split("-")[0];
    setTranslations((prev) => ({ ...prev, [m.id]: { ...(prev[m.id] || {}), loading: true, error: "" } }));
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: m.text, target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't translate that message.");
      setTranslations((prev) => ({
        ...prev,
        [m.id]: {
          text: data.translatedText,
          loading: false,
          error: "",
          lang: target,
          detected: data.detected || "",
          sameLanguage: Boolean(data.sameLanguage),
        },
      }));
    } catch (err) {
      setTranslations((prev) => ({ ...prev, [m.id]: { loading: false, error: err.message || "Couldn't translate that message." } }));
    }
  }

  /** Turns a language code ("es", "fr") into a readable name ("Spanish") via the browser's own locale data — falls back to the raw code if that API isn't available. */
  function languageName(code) {
    if (!code) return "";
    try {
      return new Intl.DisplayNames([navigator.language || "en"], { type: "language" }).of(code) || code;
    } catch {
      return code;
    }
  }

  /** Formats a message's Firestore Timestamp per the "24-hour clock" preference (Preferences → Appearance → Chat display). */
  function formatMsgTime(ts) {
    if (!ts?.toDate) return "";
    return ts.toDate().toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: memberProfiles[user?.uid]?.preferences?.use24HourClock ? false : true,
    });
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
    const text = msgText.trim();
    if ((!text && !stagedAttachment) || !user) return;
    setMsgText("");
    setMentionOpen(false);
    const replyTo = replyingTo ? { id: replyingTo.id, senderName: replyingTo.senderName, text: replyingTo.text } : null;
    setReplyingTo(null);
    const attachment = stagedAttachment;
    setStagedAttachment(null);
    await addDoc(collection(db, "projects", id, "messages"), {
      // A staged attachment becomes the message's actual type/payload; any
      // text typed alongside it rides along as `caption` rather than
      // replacing the normal `text` field a plain message uses.
      ...(attachment || { type: "text" }),
      ...(text ? (attachment ? { caption: text } : { text }) : {}),
      mentions: extractMentions(text),
      replyTo,
      senderId: user.uid,
      senderName: user.displayName || user.email || "Unknown",
      createdAt: serverTimestamp(),
    });
  }

  function startReply(m) {
    setReplyingTo({
      id: m.id,
      senderName: m.senderName,
      text: m.type === "voice" ? "Voice message" : m.type === "attachment" ? m.title || "Attachment" : m.text || "",
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

      // Live spectrogram, purely visual — piped from the same mic stream via
      // an AnalyserNode. Wrapped in its own try/catch so a browser that
      // balks at AudioContext (rare, but happens under some privacy
      // settings) still lets voice recording itself work fine.
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioCtx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.75;
        source.connect(analyser);
        audioCtxRef.current = audioCtx;
        audioAnalyserRef.current = analyser;
      } catch (err) {
        audioCtxRef.current = null;
        audioAnalyserRef.current = null;
      }

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(recordTimerRef.current);
        if (spectrogramRafRef.current) cancelAnimationFrame(spectrogramRafRef.current);
        spectrogramRafRef.current = null;
        audioAnalyserRef.current = null;
        audioCtxRef.current?.close().catch(() => {});
        audioCtxRef.current = null;
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
      drawSpectrogram();
    } catch (err) {
      setRecordError("Couldn't access your microphone. Check browser permissions.");
    }
  }

  /** Bar-style live spectrogram, drawn each frame from the recording mic's AnalyserNode onto the small canvas in the recording bar. No-ops quietly if either isn't available. */
  function drawSpectrogram() {
    const analyser = audioAnalyserRef.current;
    const canvas = spectrogramCanvasRef.current;
    if (!analyser || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    const barCount = 24;
    const step = Math.max(1, Math.floor(data.length / barCount));
    const barWidth = width / barCount;
    ctx.fillStyle = "#e5534b";
    for (let i = 0; i < barCount; i++) {
      const v = data[i * step] / 255;
      const barHeight = Math.max(2, v * height);
      ctx.fillRect(i * barWidth, height - barHeight, Math.max(1, barWidth - 2), barHeight);
    }
    spectrogramRafRef.current = requestAnimationFrame(drawSpectrogram);
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

  function sendPickedAttachment(item) {
    setStagedAttachment({ type: "attachment", url: item.url, provider: item.provider, title: item.title });
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

  function sendAttachment(e) {
    e.preventDefault();
    if (!attachUrl.trim()) return;
    const url = attachUrl.trim();
    const { provider, title } = guessLinkMeta(url);
    setStagedAttachment({ type: "attachment", url, provider, title });
    closeComposerExtra();
  }

  async function handleChatFileUpload(file) {
    if (!user) return;
    setChatFileError("");
    setChatFilePct(0);
    try {
      // Only images get downscaled — other file types (PDFs, CAD files,
      // zips, etc.) are uploaded as-is since there's no safe generic way to
      // shrink those client-side.
      const toUpload = file.type?.startsWith("image/") ? await compressImage(file) : file;
      const path = `projects/${id}/chat/${Date.now()}-${safeFileName(toUpload.name || file.name)}`;
      const url = await uploadFile(path, toUpload, setChatFilePct);

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

      setStagedAttachment({
        type: "attachment",
        url,
        provider: "upload",
        title: file.name,
        fileSize: toUpload.size,
        fileType: toUpload.type || file.type || "",
        driveUrl,
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

  /** Sender-only delete — the button that calls this is itself only ever rendered for the sender's own messages, and the Firestore rule for `messages` should mirror that (see SETUP_NOTES.md). */
  async function deleteMessage(message) {
    if (!user || message.senderId !== user.uid) return;
    const shouldConfirm = memberProfiles[user.uid]?.preferences?.confirmMessageDelete !== false;
    if (shouldConfirm && !window.confirm("Delete this message? This can't be undone.")) return;
    try {
      await deleteDoc(doc(db, "projects", id, "messages", message.id));
    } catch (err) {
      console.error("Failed to delete message:", err);
    }
  }

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

  // Activities (whiteboard) has no nav entry of its own anymore —
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

  /** AI role maker — asks the free AI for a short list of roles that make sense given the project's title/description, so the user isn't starting the "Roles needed" list from a blank input. Suggestions are shown as add-one-click chips, never written to Firestore automatically. */
  async function suggestRolesWithAI() {
    setAiRolesLoading(true);
    setAiRolesError("");
    setAiSuggestedRoles([]);
    try {
      const existing = (project.roles || []).map((r) => `${r.code}: ${r.title}`).join(", ") || "none yet";
      const data = await aiCompleteJSON(
        `Project title: "${project.title || "Untitled project"}"\nProject description: "${project.description || "No description given."}"\nRoles already on the team: ${existing}\n\nSuggest 4-6 NEW roles (not already listed) this project team likely needs to fill. For each, give a short uppercase code (2-4 letters, like SW, AI, UX, HW, BIZ), a role title, and a one-sentence description of what that role would do on this specific project.`,
        {
          system:
            'You are helping a hackathon/project team figure out what roles to recruit for. Return a JSON array like [{"code":"SW","title":"Software Engineer","description":"..."}].',
        }
      );
      const cleaned = (Array.isArray(data) ? data : [])
        .filter((r) => r && r.code && r.title)
        .map((r) => ({ code: String(r.code).toUpperCase().slice(0, 6), title: String(r.title), description: String(r.description || "") }));
      if (cleaned.length === 0) throw new Error("AI didn't return any usable suggestions — try again.");
      setAiSuggestedRoles(cleaned);
    } catch (err) {
      console.error("AI role suggestion failed:", err);
      setAiRolesError(err.message || "Couldn't get AI suggestions right now.");
    } finally {
      setAiRolesLoading(false);
    }
  }

  async function addSuggestedRole(role) {
    try {
      await updateDoc(doc(db, "projects", id), { roles: arrayUnion(role) });
      setAiSuggestedRoles((prev) => prev.filter((r) => r !== role));
    } catch (err) {
      console.error("Failed to add suggested role:", err);
    }
  }

  /** AI chat summary — summarizes the most recent messages in this channel so someone catching up doesn't have to scroll. Only ever runs on demand (button click), nothing is auto-summarized or stored. */
  async function summarizeChat() {
    setAiSummaryOpen(true);
    setAiSummaryLoading(true);
    setAiSummaryError("");
    try {
      const recent = messages.slice(-40);
      if (recent.length === 0) throw new Error("No messages yet to summarize.");
      const transcript = recent
        .map((m) => {
          const body = m.type === "voice" ? "[voice message]" : m.type === "attachment" ? `[shared file: ${m.title || m.url || "attachment"}]` : m.text || "";
          return body ? `${m.senderName || "Someone"}: ${body}` : null;
        })
        .filter(Boolean)
        .join("\n");
      const summary = await aiComplete(`Summarize this team chat transcript in 3-5 short bullet points, focused on decisions made, action items, and open questions:\n\n${transcript}`, {
        system: "You are summarizing a team's project chat for someone catching up. Be concise and specific. Use plain dashes for bullets, no markdown headers.",
      });
      setAiSummaryText(summary);
    } catch (err) {
      console.error("AI chat summary failed:", err);
      setAiSummaryError(err.message || "Couldn't summarize the chat right now.");
    } finally {
      setAiSummaryLoading(false);
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
      const compressed = await compressImage(file);
      const path = `projects/${id}/cover-${Date.now()}-${safeFileName(compressed.name || file.name)}`;
      const url = await uploadFile(path, compressed, setImageUploadPct);
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
        setEventError(err.message || "Saved to the project, but couldn't add it to Google Calendar. Connect Google in Preferences and try again.");
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
   * whiteboard, plus "retro" for older projects that still have leftover
   * retro-board docs from before that feature was removed) and removes
   * each doc before removing the project itself. Owner-only — enforced
   * both here and (should be) in Firestore rules.
   */
  async function deleteProject() {
    if (!user || !project || user.uid !== project.ownerId) return;
    if (!window.confirm(`Permanently delete "${project.name}"? This deletes every task, message, and file reference in it. There's no undo.`)) return;
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

  if (!user || project === undefined) return <div className="shell" />;

  if (project === null) {
    return (
      <div className="shell">
        <TopNav user={user} />
        <div className="shell-view">
          <p className="notice">
            Couldn&rsquo;t find that project. It may have been deleted, or you may not have access to it.{" "}
            <Link href="/" style={{ color: "var(--s-amber)" }}>Go home</Link>
          </p>
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
          <div className="shell-switcher" data-tour="switcher" onClick={() => setDropdownOpen((v) => !v)}>
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

          <div className="shell-chan-group" data-tour="channels">
            <div className="shell-chan-group-label">{project?.name}</div>
            {CHANNELS.map((c) => (
              <button
                key={c.key}
                className={"shell-chan" + (tab === c.key ? " active" : "")}
                onClick={() => setTab(c.key)}
              >
                <c.Icon size={14} />
                {c.label}
                {c.key === "tasks" && tasks.length > 0 && (
                  <span className="shell-fill-pill">{tasks.length}</span>
                )}
              </button>
            ))}
          </div>

          {(project?.driveFolderUrl || project?.githubRepoUrl) && (
            <div className="shell-chan-group" style={{ paddingTop: 4 }}>
              {project.driveFolderUrl && (
                <a
                  href={project.driveFolderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shell-chan"
                  style={{ textDecoration: "none" }}
                >
                  <IconDriveMark size={14} />
                  Drive folder
                </a>
              )}
              {project.githubRepoUrl && (
                <a
                  href={project.githubRepoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shell-chan"
                  style={{ textDecoration: "none" }}
                >
                  <IconGithubMark size={14} />
                  GitHub repo
                </a>
              )}
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Files/Documentation/Settings pinned to the true bottom of the
              sidebar, separated from everything above by the divider. */}
          <div className="shell-chan-group" style={{ paddingTop: 10, borderTop: "1px solid var(--s-border)" }}>
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
              data-tour="settings-btn"
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
            <div className="shell-view">
              <div className="shell-overview-grid">
                <div style={{ minWidth: 0 }}>
                  {project.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={project.imageUrl}
                      alt=""
                      style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 14, border: "1px solid var(--s-border)", marginBottom: 22 }}
                    />
                  )}

                  <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 6 }}>
                    Brief
                  </p>
                  <p className="shell-brief-text" style={{ marginBottom: 24 }}>
                    {project.brief || "No brief yet."}
                  </p>

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

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", margin: 0 }}>
                      Roles needed
                    </p>
                    <button
                      type="button"
                      className="shell-btn-outline"
                      style={{ fontSize: 11, height: 26, padding: "0 10px", display: "inline-flex", alignItems: "center", gap: 5 }}
                      onClick={suggestRolesWithAI}
                      disabled={aiRolesLoading}
                    >
                      <IconSparkle size={12} />
                      {aiRolesLoading ? "Thinking…" : "Suggest roles with AI"}
                    </button>
                  </div>
                  {aiRolesError && (
                    <p style={{ fontSize: 12, color: "var(--s-red, #d86f6f)", marginBottom: 10 }}>{aiRolesError}</p>
                  )}
                  {aiSuggestedRoles.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                      {aiSuggestedRoles.map((r, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            border: "1px dashed var(--s-border)",
                            borderRadius: 8,
                            padding: "8px 10px",
                          }}
                        >
                          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--s-amber)", flex: "none" }}>{r.code}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.title}</div>
                            {r.description && (
                              <div style={{ fontSize: 11, color: "var(--s-text-3)" }}>{r.description}</div>
                            )}
                          </div>
                          <button
                            type="button"
                            className="shell-btn-outline"
                            style={{ fontSize: 11, height: 26, padding: "0 10px", flex: "none" }}
                            onClick={() => addSuggestedRole(r)}
                          >
                            Add
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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

                <div className="shell-overview-rail">
                  <div>
                    <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
                      At a glance
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
                  </div>

                  <div>
                    <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
                      Team
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(project.memberIds || []).map((uid) => {
                        void presenceTick; // re-evaluate isOnline() on each tick
                        const profile = memberProfiles[uid] || {};
                        const online = isOnline(profile.lastActiveAt);
                        const name = profile.name || (uid === user?.uid ? user?.displayName || user?.email : profile.email) || "Member";
                        return (
                          <div
                            key={uid}
                            style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 6px", background: "var(--s-bg-side)", border: "1px solid var(--s-border)", borderRadius: 999 }}
                          >
                            <span className="shell-presence-wrap">
                              {profile.avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={profile.avatarUrl}
                                  alt=""
                                  style={{
                                    width: 26,
                                    height: 26,
                                    borderRadius: "50%",
                                    objectFit: "cover",
                                    ...(focusModeInfo(profile.focusMode) ? { boxShadow: `0 0 0 2px ${focusModeInfo(profile.focusMode).color}` } : {}),
                                  }}
                                />
                              ) : (
                                <span
                                  className="shell-avatar"
                                  style={focusModeInfo(profile.focusMode) ? { boxShadow: `0 0 0 2px ${focusModeInfo(profile.focusMode).color}` } : undefined}
                                >
                                  {(name || "?")[0]?.toUpperCase()}
                                </span>
                              )}
                              <span className={"shell-presence-dot" + (online ? " online" : "")} title={online ? "Online" : lastSeenLabel(profile.lastActiveAt)} />
                            </span>
                            <span style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
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
                  </div>
                </div>
              </div>
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
                          {col.key === "todo" ? "Nothing here yet. Add a task above." : "Drag a task here."}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "matches" && project && (
            <div className="shell-view">
              {(project.roles || []).length === 0 && (
                <p style={{ fontSize: 13, color: "var(--s-text-3)" }}>
                  Add roles in Overview first, then matches will show up here.
                </p>
              )}
              {(project.roles || []).map((role) => {
                const matched = allProfiles
                  .map((p) => ({ ...p, matchScore: matchScoreForRole(role, p) }))
                  .filter((p) => p.matchScore > 0)
                  .sort((a, b) => b.matchScore - a.matchScore)
                  .slice(0, 8);
                if (matched.length === 0) return null;
                return (
                  <div key={role.code} className="shell-match-role-block">
                    <div className="shell-match-role-head">
                      <span className="shell-match-role-code">{role.code}-101</span>
                      <span className="shell-match-role-title">{role.title}</span>
                    </div>
                    {matched.map((p, i) => (
                      <div key={p.uid} className={"shell-cand-card" + (i === 0 ? " top-match" : "")}>
                        <div className="shell-cand-top">
                          {i === 0 && <span className="shell-top-badge">Top match</span>}
                          <span className="shell-cand-name">{p.name || p.email || "Someone new"}</span>
                          <span style={{ marginLeft: "auto", fontFamily: "'DM Sans', sans-serif", fontSize: 10, color: "var(--s-green)" }}>
                            {matchScoreToPercent(p.matchScore)}%
                          </span>
                        </div>
                        {p.headline && <div className="shell-cand-headline">{p.headline}</div>}
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                          {(p.skills || []).slice(0, 6).map((s, si) => (
                            <span key={si} className="shell-mini-chip">{s}</span>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="shell-btn-outline"
                          style={{ fontSize: 11.5, height: 28, padding: "0 12px" }}
                          onClick={() => setMessageTarget({ toUid: p.uid, toLabel: p.name || p.email || "them" })}
                        >
                          Message
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
              {allProfiles.length === 0 && (
                <p style={{ fontSize: 13, color: "var(--s-text-3)" }}>
                  No other Blueprint members yet to match against — once more people sign up and add skills to their
                  profile, they'll show up here ranked against your open roles.
                </p>
              )}
            </div>
          )}

          {tab === "calendar" && (() => {
            function localKey(d) {
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            }
            function googleEventDate(g) {
              const raw = g.start?.dateTime || g.start?.date;
              if (!raw) return null;
              return new Date(raw.includes("T") ? raw : raw + "T00:00:00");
            }
            const usedGoogleIds = new Set(events.map((e) => e.googleEventId).filter(Boolean));
            const byDay = {};
            for (const evt of events) {
              if (!evt.start) continue;
              const key = localKey(new Date(evt.start));
              (byDay[key] ||= []).push({ id: evt.id, title: evt.title, url: evt.googleEventUrl || null, google: Boolean(evt.googleEventId) });
            }
            for (const g of googleCalEvents) {
              if (usedGoogleIds.has(g.id)) continue; // already represented via the app-created copy above
              const d = googleEventDate(g);
              if (!d) continue;
              const key = localKey(d);
              (byDay[key] ||= []).push({ id: g.id, title: g.summary || "(untitled)", url: g.htmlLink, google: true });
            }

            // "Week starts on Monday" (Preferences → Appearance → Calendar) —
            // shifts both the grid's leading padding and the day-of-week
            // header row below (0 = the week's first column either way).
            const mondayStart = Boolean(memberProfiles[user?.uid]?.preferences?.weekStartsMonday);
            const startWeekday = mondayStart ? (calMonth.getDay() + 6) % 7 : calMonth.getDay();
            const gridStart = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1 - startWeekday);
            const todayKey = localKey(new Date());
            const cells = Array.from({ length: 42 }, (_, i) => {
              const d = new Date(gridStart);
              d.setDate(gridStart.getDate() + i);
              return d;
            });

            const filteredEvents = calSelectedDay
              ? events.filter((evt) => evt.start && localKey(new Date(evt.start)) === calSelectedDay)
              : events;

            return (
            <div className="shell-view">
              <div className="shell-cal-head">
                <button type="button" className="shell-cal-nav-btn" onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))} aria-label="Previous month">
                  ‹
                </button>
                <span className="shell-cal-month-label">{calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
                <button type="button" className="shell-cal-nav-btn" onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))} aria-label="Next month">
                  ›
                </button>
                {!myIntegrations?.driveAccessToken && (
                  <span style={{ fontSize: 11, color: "var(--s-text-3)", marginLeft: "auto" }}>
                    Connect Google in <Link href="/account" style={{ color: "var(--s-amber)" }}>Preferences</Link> to see your synced Calendar events here too.
                  </span>
                )}
              </div>

              <div className="shell-cal-grid">
                {(mondayStart
                  ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
                  : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
                ).map((d) => (
                  <div key={d} className="shell-cal-dow">{d}</div>
                ))}
                {cells.map((d, i) => {
                  const key = localKey(d);
                  const dayEvents = byDay[key] || [];
                  const outside = d.getMonth() !== calMonth.getMonth();
                  return (
                    <div
                      key={i}
                      className={"shell-cal-cell" + (outside ? " outside" : "") + (key === todayKey ? " today" : "")}
                      onClick={() => setCalSelectedDay(calSelectedDay === key ? null : key)}
                      style={{ cursor: dayEvents.length ? "pointer" : "default" }}
                    >
                      <span className="shell-cal-day-num">{d.getDate()}</span>
                      {dayEvents.slice(0, 3).map((ev) => (
                        <span key={ev.id} className={"shell-cal-event-chip" + (ev.google ? " google" : "")} title={ev.title}>
                          {ev.title}
                        </span>
                      ))}
                      {dayEvents.length > 3 && (
                        <span style={{ fontSize: 10, color: "var(--s-text-3)" }}>+{dayEvents.length - 3} more</span>
                      )}
                    </div>
                  );
                })}
              </div>

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
              </form>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", margin: 0 }}>
                  {calSelectedDay
                    ? new Date(calSelectedDay + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
                    : "All events"}
                </p>
                {calSelectedDay && (
                  <button type="button" className="ghost" style={{ fontSize: 11.5 }} onClick={() => setCalSelectedDay(null)}>
                    Show all
                  </button>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filteredEvents.map((evt) => {
                  const start = evt.start ? new Date(evt.start) : null;
                  const end = evt.end ? new Date(evt.end) : null;
                  const dateLabel = start
                    ? start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
                    : "";
                  const timeLabel =
                    start && end
                      ? `${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} to ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
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
                {filteredEvents.length === 0 && (
                  <p style={{ fontSize: 13, color: "var(--s-text-3)" }}>
                    {calSelectedDay ? "No events on this day." : "No events yet. Add one above."}
                  </p>
                )}
              </div>
            </div>
            );
          })()}

          {tab === "activities" && (
            <div className="shell-view">
                <div>
                  {boardError && <p className="notice" style={{ marginBottom: 14 }}>{boardError}</p>}
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
                      className={boardTool === "eraser" ? "shell-task-add-btn" : "shell-btn-outline"}
                      style={{ height: 32, padding: "0 14px", fontSize: 12 }}
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
                      <button type="button" onClick={undoLastStroke} disabled={strokes.length === 0} className="shell-btn-outline" style={{ height: 32, padding: "0 14px", fontSize: 12 }}>
                        Undo
                      </button>
                      <button type="button" onClick={clearWhiteboard} disabled={boardBusy} className="shell-btn-outline" style={{ height: 32, padding: "0 14px", fontSize: 12 }}>
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
                      maxWidth: 900,
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
            </div>
          )}

          {tab === "chat" && (
            <div className="shell-view" style={{ display: "flex", flexDirection: "column" }}>
              <VideoCall
                projectId={id}
                onOpenActivities={() => setTab("activities")}
                startSignal={meetingStartSignal}
                preferredMicId={memberProfiles[user?.uid]?.preferences?.micId}
                preferredCamId={memberProfiles[user?.uid]?.preferences?.camId}
                joinMicMuted={Boolean(memberProfiles[user?.uid]?.preferences?.micOffOnJoin)}
                joinCamOff={Boolean(memberProfiles[user?.uid]?.preferences?.camOffOnJoin)}
              />
              <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 16 }}>
              <div className="shell-chat-panel" style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div className="shell-chat-search" style={{ flex: 1 }}>
                    <IconSearch size={13} />
                    <input
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                      placeholder="Search messages"
                    />
                    {chatSearch && (
                      <button type="button" className="shell-chat-search-clear" onClick={() => setChatSearch("")} aria-label="Clear search">
                        ×
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    className="shell-btn-outline"
                    style={{ fontSize: 11, height: 32, padding: "0 10px", display: "inline-flex", alignItems: "center", gap: 5, flex: "none" }}
                    onClick={summarizeChat}
                    disabled={aiSummaryLoading}
                    title="Summarize recent messages with AI"
                  >
                    <IconSparkle size={12} />
                    {aiSummaryLoading ? "Summarizing…" : "Summarize"}
                  </button>
                </div>
                {aiSummaryOpen && (
                  <div
                    style={{
                      border: "1px solid var(--s-border)",
                      borderRadius: 8,
                      padding: "10px 12px",
                      margin: "8px 0",
                      fontSize: 12.5,
                      lineHeight: 1.55,
                      background: "var(--s-bg-elevated)",
                      whiteSpace: "pre-wrap",
                      position: "relative",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setAiSummaryOpen(false)}
                      aria-label="Close summary"
                      style={{ position: "absolute", top: 8, right: 10, background: "none", border: "none", color: "var(--s-text-3)", cursor: "pointer", fontSize: 14 }}
                    >
                      ×
                    </button>
                    <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 6 }}>
                      AI summary · last {Math.min(messages.length, 40)} messages
                    </div>
                    {aiSummaryLoading && "Reading the conversation…"}
                    {!aiSummaryLoading && aiSummaryError && <span style={{ color: "var(--s-red, #d86f6f)" }}>{aiSummaryError}</span>}
                    {!aiSummaryLoading && !aiSummaryError && aiSummaryText}
                  </div>
                )}
                <div className="shell-msgs">
                  {chatSearch.trim() && messages.filter((m) => messageMatchesSearch(m, chatSearch)).length === 0 && (
                    <div style={{ textAlign: "center", color: "var(--s-text-3)", fontSize: 13, padding: 20 }}>
                      No messages match &ldquo;{chatSearch.trim()}&rdquo;.
                    </div>
                  )}
                  {(() => {
                    const visible = messages.filter((m) => messageMatchesSearch(m, chatSearch));
                    return visible.map((m, i) => {
                    const isTextMsg = !m.type || m.type === "text";
                    const canTranslate = isTextMsg && m.text && !translations[m.id]?.sameLanguage;
                    const prevM = visible[i - 1];
                    const grouped = Boolean(
                      prevM && prevM.senderId === m.senderId && !m.replyTo && withinGroupWindow(prevM.createdAt, m.createdAt)
                    );
                    const fm = focusModeInfo(memberProfiles[m.senderId]?.focusMode);
                    const ringStyle = fm ? { boxShadow: `0 0 0 2px ${fm.color}` } : undefined;
                    return (
                    <div key={m.id} className={"shell-msg" + (m.mentions?.includes(user?.uid) ? " mentioned" : "") + (grouped ? " grouped" : "")}>
                      <div className="shell-msg-actions">
                        <button type="button" className="shell-msg-action-btn" title="Reply" onClick={() => startReply(m)}>
                          <IconReply size={13} />
                        </button>
                        {canTranslate && (
                          <button type="button" className="shell-msg-action-btn" title="Translate" onClick={() => translateMessage(m)}>
                            <IconTranslate size={13} />
                          </button>
                        )}
                        {/* One-click "Quick-react emoji" (Preferences → Notifications →
                            Composing) — reacts instantly with your chosen default emoji;
                            the button below still opens the full picker for anything else. */}
                        <button
                          type="button"
                          className="shell-msg-action-btn"
                          title="Quick react"
                          onClick={() => toggleReaction(m, memberProfiles[user?.uid]?.preferences?.defaultReactionEmoji || "👍")}
                        >
                          {memberProfiles[user?.uid]?.preferences?.defaultReactionEmoji || "👍"}
                        </button>
                        <span style={{ position: "relative" }}>
                          <button
                            type="button"
                            className="shell-msg-action-btn"
                            title="React"
                            onClick={() => setOpenReactionPicker(openReactionPicker === m.id ? null : m.id)}
                          >
                            <IconReact size={13} />
                          </button>
                          {openReactionPicker === m.id && (
                            <div className="shell-reaction-picker" style={{ position: "absolute", top: "calc(100% + 6px)", bottom: "auto", left: "auto", right: 0 }}>
                              <div style={{ display: "flex", gap: 4 }}>
                                {REACTION_EMOJI.map((emoji) => (
                                  <button key={emoji} type="button" onClick={() => toggleReaction(m, emoji)}>
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const val = customReactionInput.trim();
                                  if (val) toggleReaction(m, val);
                                  setCustomReactionInput("");
                                }}
                                style={{ display: "flex", marginTop: 4, borderTop: "1px solid var(--s-border)", paddingTop: 4 }}
                              >
                                <input
                                  value={customReactionInput}
                                  onChange={(e) => setCustomReactionInput(e.target.value)}
                                  placeholder="Any emoji…"
                                  maxLength={8}
                                  style={{ width: "100%", background: "var(--s-bg-elevated)", border: "1px solid var(--s-border)", borderRadius: 6, padding: "4px 6px", fontSize: 13, color: "var(--s-text)" }}
                                />
                              </form>
                            </div>
                          )}
                        </span>
                        {m.senderId === user?.uid && (
                          <button type="button" className="shell-msg-action-btn" title="Delete" onClick={() => deleteMessage(m)}>
                            ×
                          </button>
                        )}
                      </div>
                      <span className="shell-presence-wrap" style={{ marginTop: 2, visibility: grouped ? "hidden" : "visible" }}>
                        {memberProfiles[m.senderId]?.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={memberProfiles[m.senderId].avatarUrl} alt="" className="shell-avatar" style={ringStyle} />
                        ) : (
                          <span className="shell-avatar" style={ringStyle}>{m.senderName?.[0]?.toUpperCase()}</span>
                        )}
                        {(() => {
                          void presenceTick;
                          const online = isOnline(memberProfiles[m.senderId]?.lastActiveAt);
                          return <span className={"shell-presence-dot" + (online ? " online" : "")} />;
                        })()}
                      </span>
                      <div className="shell-msg-body" style={{ flex: 1 }}>
                        {m.replyTo && (
                          <div className="shell-msg-reply-quote">
                            <IconReply size={11} />
                            <b>{m.replyTo.senderName}</b>: {m.replyTo.text.length > 80 ? m.replyTo.text.slice(0, 80) + "…" : m.replyTo.text}
                          </div>
                        )}
                        {!grouped && (
                          <span>
                            <b>{m.senderName}</b>
                            <span className="shell-msg-time">{formatMsgTime(m.createdAt)}</span>
                          </span>
                        )}

                        {isTextMsg && (
                          <>
                            <p>{renderMessageText(m.text)}</p>
                            {translations[m.id]?.loading && (
                              <div style={{ fontSize: 11, color: "var(--s-text-3)", marginTop: 2 }}>Translating…</div>
                            )}
                            {translations[m.id]?.error && (
                              <div style={{ fontSize: 11, color: "#e5534b", marginTop: 2 }}>{translations[m.id].error}</div>
                            )}
                            {translations[m.id]?.sameLanguage && (
                              <div style={{ fontSize: 11, color: "var(--s-text-3)", marginTop: 2, fontStyle: "italic" }}>
                                Already in your language.
                              </div>
                            )}
                            {translations[m.id]?.text && !translations[m.id]?.sameLanguage && (
                              <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--s-border)" }}>
                                {translations[m.id]?.detected && (
                                  <div style={{ fontSize: 10.5, color: "var(--s-text-3)", marginBottom: 2 }}>
                                    Translated from {languageName(translations[m.id].detected)}
                                  </div>
                                )}
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

                        {m.caption && <p style={{ marginTop: 4 }}>{renderMessageText(m.caption)}</p>}

                        {m.type === "attachment" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {m.provider === "upload" && m.fileType?.startsWith("image/") && (
                              <a href={m.url} target="_blank" rel="noopener noreferrer">
                                <img src={m.url} alt={m.title} style={{ maxWidth: 320, maxHeight: 260, borderRadius: 10, border: "1px solid var(--s-border)", display: "block" }} />
                              </a>
                            )}
                            {m.provider === "upload" && m.fileType?.startsWith("video/") && (
                              <VideoPlayer src={m.url} style={{ width: 320, maxWidth: 360 }} />
                            )}
                            {m.provider === "upload" && m.fileType?.startsWith("audio/") && (
                              <AudioPlayer src={m.url} style={{ maxWidth: 320 }} />
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
                            <AudioPlayer src={m.url} voice style={{ maxWidth: 260 }} autoPlay={autoPlayVoiceIds.has(m.id)} />
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
                            Open whiteboard
                          </button>
                        )}

                        {Object.entries(m.reactions || {}).some(([, uids]) => (uids || []).length > 0) && (
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
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  });
                  })()}
                  <div ref={msgsEndRef} />
                  {messages.length === 0 && (
                    <p style={{ fontSize: 12, color: "var(--s-text-3)" }}>No messages yet, say hi.</p>
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
                          Add to Drive
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
                    <canvas ref={spectrogramCanvasRef} className="shell-spectrogram" width={90} height={22} />
                    <button type="button" onClick={cancelVoiceRecording} className="ghost" style={{ marginLeft: "auto" }}>
                      Cancel
                    </button>
                    <button type="button" onClick={stopVoiceRecording}>
                      Send
                    </button>
                  </div>
                )}

                {composerMode === null && !recording && replyingTo && (
                  <div className="shell-reply-preview">
                    Replying to <b>{replyingTo.senderName}</b>: {replyingTo.text.length > 60 ? replyingTo.text.slice(0, 60) + "…" : replyingTo.text}
                    <button type="button" className="shell-reply-preview-close" onClick={() => setReplyingTo(null)} aria-label="Cancel reply">
                      ×
                    </button>
                  </div>
                )}

                {composerMode === null && !recording && stagedAttachment && (
                  <div className="shell-staged-attachment">
                    <span className={"shell-attachment-badge " + stagedAttachment.provider}>
                      {stagedAttachment.provider === "drive" ? "Drive" : stagedAttachment.provider === "github" ? "GitHub" : stagedAttachment.provider === "upload" ? "File" : "Link"}
                    </span>
                    <span className="shell-attachment-title" style={{ fontSize: 13 }}>{stagedAttachment.title}</span>
                    <button type="button" className="shell-staged-attachment-remove" onClick={() => setStagedAttachment(null)} aria-label="Remove attachment">
                      ×
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
                            Open whiteboard
                          </div>
                          <div
                            className="shell-proj-row"
                            onClick={() => {
                              summarizeChat();
                              setComposerMenuOpen(false);
                            }}
                            style={{ display: "flex", alignItems: "center", gap: 6 }}
                          >
                            <IconSparkle size={12} />
                            Summarize with AI
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
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setMentionOpen(false);
                            return;
                          }
                          // "Send with" preference (Preferences → Notifications →
                          // Composing) — default "enter" leaves the input's normal
                          // submit-on-Enter behavior alone; "ctrlEnter" swallows a
                          // plain Enter (so it does nothing) and only sends on
                          // Ctrl/Cmd+Enter, for people who'd rather not risk an
                          // accidental send.
                          if (e.key !== "Enter") return;
                          const shortcut = memberProfiles[user?.uid]?.preferences?.sendShortcut || "enter";
                          if (shortcut !== "ctrlEnter") return;
                          if (e.metaKey || e.ctrlKey) sendMessage(e);
                          else e.preventDefault();
                        }}
                        placeholder={stagedAttachment ? "Add a caption (optional)" : "Message the team, @ to mention someone"}
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

              <div style={{ width: 216, flex: "none", overflowY: "auto", paddingTop: 4 }}>
                <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--s-text-3)", marginBottom: 10 }}>
                  Team ({(project?.memberIds || []).length})
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {(project?.memberIds || [])
                    .slice()
                    .sort((a, b) => {
                      void presenceTick;
                      const aOn = isOnline(memberProfiles[a]?.lastActiveAt) ? 0 : 1;
                      const bOn = isOnline(memberProfiles[b]?.lastActiveAt) ? 0 : 1;
                      return aOn - bOn;
                    })
                    .map((uid) => {
                      void presenceTick;
                      const profile = memberProfiles[uid] || {};
                      const online = isOnline(profile.lastActiveAt);
                      const name = profile.name || (uid === user?.uid ? user?.displayName || user?.email : "Member");
                      const fm = focusModeInfo(profile.focusMode);
                      const ringStyle = fm ? { boxShadow: `0 0 0 2px ${fm.color}` } : undefined;
                      return (
                        <div key={uid} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <span className="shell-presence-wrap">
                            {profile.avatarUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={profile.avatarUrl} alt="" className="shell-avatar" style={{ width: 32, height: 32, ...ringStyle }} />
                            ) : (
                              <span className="shell-avatar" style={{ width: 32, height: 32, fontSize: 13, ...ringStyle }}>{(name || "?")[0]?.toUpperCase()}</span>
                            )}
                            <span className={"shell-presence-dot" + (online ? " online" : "")} />
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 13.5, color: online ? "var(--s-text)" : "var(--s-text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                              {name}
                            </span>
                            {fm && (
                              <span style={{ fontSize: 10.5, color: fm.color }}>{fm.label}</span>
                            )}
                          </span>
                          {uid !== user?.uid && (
                            <button
                              type="button"
                              onClick={() => setMessageTarget({ toUid: uid, toLabel: name })}
                              title={`Message ${name}`}
                              aria-label={`Message ${name}`}
                              style={{ background: "transparent", border: "none", color: "var(--s-text-3)", cursor: "pointer", flex: "none", padding: 2, display: "flex" }}
                            >
                              <IconMailbox size={13} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
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
                      Nothing shared yet. Files and links attached in Team chat show up here automatically.
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
                        {memberProfiles[m.senderId]?.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={memberProfiles[m.senderId].avatarUrl} alt="" className="shell-avatar" style={{ width: 26, height: 26, flex: "none" }} />
                        ) : (
                          <span className="shell-avatar" style={{ width: 26, height: 26, fontSize: 10, flex: "none" }}>{(m.senderName || "?")[0]?.toUpperCase()}</span>
                        )}
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
            <div className="shell-view" style={{ maxWidth: 900 }}>
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
                Anything worth keeping handy: setup steps, decisions, links, glossary. Visible to every member, editable by every member.
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
            <div className="shell-view" style={{ maxWidth: 720 }}>
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
                  <p style={{ fontSize: 13, color: "var(--s-text-3)" }}>No roles yet. Add them from the Overview tab.</p>
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
                    Or share the code: <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, color: "var(--s-text)", letterSpacing: "0.08em" }}>{project.inviteCode || "None yet"}</span>
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

      {showTour && <GuidedTour steps={TOUR_STEPS} onDone={finishTour} />}

      {messageTarget && (
        <MessageRequestModal
          toUid={messageTarget.toUid}
          toLabel={messageTarget.toLabel}
          onClose={() => setMessageTarget(null)}
          onSend={({ subject, message }) =>
            sendMessageRequest({ toUid: messageTarget.toUid, toLabel: messageTarget.toLabel, subject, message })
          }
        />
      )}
    </div>
  );
}
