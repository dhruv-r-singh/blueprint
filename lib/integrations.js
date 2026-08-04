import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth, githubProvider } from "./firebase";
import { isDesktopApp, startDesktopLink } from "./desktopAuth";

// Client-side helpers for the Google Drive / GitHub connections.
//
// Design: rather than a separate OAuth app + "Connect" button, this piggybacks
// on the Google/GitHub sign-in Firebase Auth already does. googleProvider and
// githubProvider (lib/firebase.js) request the extra drive.file / repo scopes
// alongside the normal identity ones, so the SAME sign-in (or account-linking)
// popup hands back an OAuth access token we can use directly against the
// Drive/GitHub REST APIs — see saveGoogleCredential / saveGithubCredential,
// called right after signInWithPopup / linkWithPopup resolves. No separate
// client ID/secret, no extra consent step.
//
// That first token is still only good for about an hour (Firebase's client
// SDK doesn't expose a refresh token for it). To avoid ever having to
// reconnect, saveGoogleCredential ALSO kicks off a one-time "offline access"
// request via Google Identity Services (connectGoogleOffline below) in the
// background, right after sign-in. That flow gets a real refresh token,
// which app/api/oauth/google/exchange stores server-side, and
// ensureFreshGoogleToken silently exchanges for new access tokens forever
// after via app/api/oauth/google/refresh — no popup, no "reconnect" prompt.
// Requires GOOGLE_OAUTH_CLIENT_ID/SECRET + NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID
// to be configured (see SETUP_NOTES.md); until then this best-effort step
// just no-ops and Drive falls back to the old ~1hr-then-reconnect behavior.

// Where Drive/GitHub tokens live in Firestore. Deliberately NOT on
// profiles/{uid} directly — that document is readable by any signed-in user
// (needed so profiles are discoverable for matching), which would leak
// access tokens. This subcollection needs its own locked-down rule; see
// SETUP_NOTES.md.
export function integrationsDocPath(uid) {
  return ["profiles", uid, "private", "integrations"];
}

// Google access tokens obtained this way are good for ~1hr; keep a little
// buffer so we don't hand out a token that expires mid-request.
const GOOGLE_TOKEN_TTL_MS = 55 * 60 * 1000;

let gisScriptPromise = null;
/** Lazily loads Google Identity Services' client script (needed for the offline/refresh-token code flow). */
function loadGoogleIdentityScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("Client only."));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisScriptPromise) {
    gisScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Couldn't load Google's sign-in library."));
      document.head.appendChild(script);
    });
  }
  return gisScriptPromise;
}

/**
 * Requests one-time "offline" Drive/Calendar access via Google Identity
 * Services' authorization-code flow (separate from the Firebase sign-in
 * popup, since Firebase's own client SDK never exposes a refresh token).
 * Hands the resulting code to our server (app/api/oauth/google/exchange),
 * which exchanges it for a refresh token and stores it server-side. Returns
 * { accessToken, expiresAt } for immediate use. Throws if
 * NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID isn't configured, the popup is blocked,
 * or the user declines.
 */
export async function connectGoogleOffline(idToken) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error("Google Drive offline access isn't configured on this deployment yet.");
  }
  await loadGoogleIdentityScript();
  const code = await new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events",
      ux_mode: "popup",
      access_type: "offline",
      prompt: "consent",
      callback: (resp) => {
        if (resp?.error) reject(new Error(resp.error_description || resp.error));
        else resolve(resp.code);
      },
    });
    client.requestCode();
  });

  const res = await fetch("/api/oauth/google/exchange", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Couldn't connect Google Drive.");
  return data;
}

/**
 * Call right after signInWithPopup/linkWithPopup with googleProvider
 * resolves. Pulls the Drive-scoped access token out of the result and saves
 * it via setDoc-style saveFn. No-ops quietly if the user declined the Drive
 * scope on Google's consent screen (credential.accessToken will be missing).
 *
 * Also best-effort kicks off connectGoogleOffline right away, so Drive/
 * Calendar access keeps renewing itself indefinitely instead of dying after
 * ~1hr. If that step fails for any reason (not configured yet, popup
 * blocked, etc.) it's logged and swallowed — the short-lived token above
 * still works for now.
 */
export async function saveGoogleCredential(result, saveFn) {
  const { GoogleAuthProvider } = await import("firebase/auth");
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) return false;
  await saveFn({
    driveAccessToken: credential.accessToken,
    driveTokenExpiresAt: Date.now() + GOOGLE_TOKEN_TTL_MS,
  });

  try {
    if (result.user) {
      const idToken = await result.user.getIdToken();
      const offline = await connectGoogleOffline(idToken);
      await saveFn({ driveAccessToken: offline.accessToken, driveTokenExpiresAt: offline.expiresAt });
    }
  } catch (err) {
    console.error("Couldn't set up offline Drive access (falling back to ~1hr token):", err);
  }

  return true;
}

/**
 * Same idea for GitHub. GitHub OAuth App tokens don't expire, so there's no
 * TTL bookkeeping needed here.
 *
 * Also looks up the user's GitHub username and, if savePublicFn is given,
 * saves it to their public profile doc (profiles/{uid} — not the locked-down
 * private/integrations doc). Other members need to be able to read *this*
 * one, since it's how the project owner's browser later knows who to invite
 * as a repo collaborator — see inviteGithubCollaborator.
 */
export async function saveGithubCredential(result, saveFn, savePublicFn) {
  const { GithubAuthProvider } = await import("firebase/auth");
  const credential = GithubAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) return false;

  // GitHub echoes back exactly which scopes a token actually carries in the
  // x-oauth-scopes response header on every authenticated API call — grab
  // it here and store it, so the app can proactively tell whether e.g.
  // delete_repo is actually granted *before* trying to delete something,
  // instead of only finding out from a failed request. See
  // hasGithubScope() below and lib/oauthScopes.js for why a token might not
  // carry a scope this app currently asks for (old connection, from before
  // that scope existed).
  let scopes = null;
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${credential.accessToken}`, accept: "application/vnd.github+json" },
    });
    scopes = res.headers.get("x-oauth-scopes") || "";
    if (res.ok && savePublicFn) {
      const me = await res.json();
      if (me.login) await savePublicFn({ githubUsername: me.login });
    }
  } catch (err) {
    console.error("Couldn't look up GitHub username/scopes:", err);
  }

  await saveFn({ githubAccessToken: credential.accessToken, githubScopes: scopes });
  return true;
}

/** True if the stored GitHub connection actually carries `scope` (e.g. "delete_repo") — checked proactively before attempting anything scope-gated, rather than only discovering it's missing from a failed API call. `integrations` is the private/integrations doc data (has `githubScopes`, a comma-space-separated string straight from GitHub's x-oauth-scopes header). Older connections made before scope tracking existed have no `githubScopes` at all — treated as "unknown," not "missing," so this doesn't nag someone whose connection is actually fine. */
export function hasGithubScope(integrations, scope) {
  const raw = integrations?.githubScopes;
  if (raw === undefined || raw === null) return true; // unknown — don't block on it, let the real API call be the judge
  return raw
    .split(",")
    .map((s) => s.trim())
    .includes(scope);
}

/**
 * Re-runs the GitHub OAuth flow for the signed-in user, callable from
 * anywhere (not just Preferences) — used right where a scope check comes
 * up short (see hasGithubScope), so fixing it is one click from wherever
 * the problem actually surfaced instead of "go find Preferences →
 * Connected accounts → click reconnect → come back."
 *
 * Web: goes through the same Firebase popup Preferences uses and saves the
 * (now broader) token immediately — resolves with `{ pending: false,
 * granted }`, so the caller can retry right after this returns. Desktop:
 * opens the OS browser (lib/desktopAuth.js's system-browser flow, same as
 * everywhere else in the app); that hands control back via a
 * `blueprint://` deep link that always lands on /account, since the
 * desktop OAuth handoff has no way to return to an arbitrary page — this
 * resolves with `{ pending: true }` so the caller shows "check the browser
 * that just opened" instead of silently waiting for a retry that isn't
 * coming.
 */
export async function reconnectGithub() {
  if (!auth.currentUser) throw new Error("Not signed in.");

  if (isDesktopApp()) {
    const idToken = await auth.currentUser.getIdToken();
    await startDesktopLink("github", idToken);
    return { pending: true };
  }

  const { linkWithPopup, reauthenticateWithPopup } = await import("firebase/auth");
  let result;
  try {
    result = await reauthenticateWithPopup(auth.currentUser, githubProvider);
  } catch (err) {
    // Not yet linked as a sign-in method at all (e.g. this account signed
    // up with email/password and never connected GitHub before) —
    // reauthenticate only works on an already-linked provider.
    if (err?.code === "auth/user-mismatch" || err?.code === "auth/no-such-provider" || err?.code === "auth/user-not-found") {
      result = await linkWithPopup(auth.currentUser, githubProvider);
    } else {
      throw err;
    }
  }
  const uid = auth.currentUser.uid;
  const savePublicFn = (patch) => setDoc(doc(db, "profiles", uid), patch, { merge: true });
  const saveFn = (patch) => setDoc(doc(db, ...integrationsDocPath(uid)), patch, { merge: true });
  const granted = await saveGithubCredential(result, saveFn, savePublicFn);
  return { pending: false, granted };
}

/**
 * Returns a live Drive access token. If the cached one has expired, silently
 * asks the server (app/api/oauth/google/refresh) to mint a new one from the
 * refresh token captured by connectGoogleOffline — no popup, no "reconnect"
 * prompt — as long as that's been set up (either automatically at sign-in,
 * or via "Connect"/"Refresh Drive access" in Account settings). Falls back
 * to a clear "reconnect" error only if offline access was never granted or
 * the refresh token has been revoked.
 */
export async function ensureFreshGoogleToken(profile) {
  const expired = !profile?.driveTokenExpiresAt || Date.now() > profile.driveTokenExpiresAt - 60_000;
  if (!expired) return profile.driveAccessToken;

  const { auth, db } = await import("./firebase");
  if (!auth.currentUser) {
    throw new Error("Your Drive connection expired — sign in again to refresh it.");
  }
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch("/api/oauth/google/refresh", {
      method: "POST",
      headers: { authorization: `Bearer ${idToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Couldn't refresh Drive access.");

    // Best-effort cache update so other reads of the integrations doc (e.g.
    // the "Connected"/"active" badges in Account settings) stay in sync —
    // failing silently here doesn't affect the token we're about to return.
    const { doc, setDoc } = await import("firebase/firestore");
    setDoc(doc(db, ...integrationsDocPath(auth.currentUser.uid)), {
      driveAccessToken: data.accessToken,
      driveTokenExpiresAt: data.expiresAt,
    }, { merge: true }).catch(() => {});

    return data.accessToken;
  } catch (err) {
    throw new Error(err.message || "Your Drive connection expired — reconnect it in Account settings.");
  }
}

export async function listRecentDriveFiles(accessToken, limit = 8) {
  const params = new URLSearchParams({
    pageSize: String(limit),
    fields: "files(id,name,webViewLink,iconLink,mimeType)",
    orderBy: "modifiedTime desc",
    spaces: "drive",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Couldn't load Drive files.");
  const data = await res.json();
  return data.files || [];
}

/**
 * Saves the signed-in user's email/name onto their public profile doc.
 * Needed so teammates' browsers can look up an email to invite them to a
 * shared Calendar event (Google Calendar invites work by email, no token
 * from the invitee required) — mirrors how githubUsername is already
 * published for the GitHub-invite reconciliation loop. Call this after any
 * successful sign-in, regardless of provider.
 */
export async function savePublicIdentity(uid, user, savePublicFn) {
  if (!user?.email) return;
  const patch = { email: user.email, name: user.displayName || user.email };
  // Seed the avatar from whatever photo the sign-in provider handed back
  // (Google/GitHub/LinkedIn all give one), so teammates see a real photo
  // immediately after someone's first sign-in instead of a blank initial
  // until they separately visit their profile and save one via
  // AvatarEditor. Only fills it in if nothing's saved yet, so this never
  // clobbers a real custom photo on a later sign-in.
  if (user.photoURL) {
    try {
      const snap = await getDoc(doc(db, "profiles", uid));
      if (!snap.exists() || !snap.data()?.avatarUrl) {
        patch.avatarUrl = user.photoURL;
      }
    } catch (err) {
      console.error("Couldn't check for an existing avatar:", err);
    }
  }
  await savePublicFn(patch);
}

/**
 * Creates a Google Calendar event on the caller's primary calendar and
 * invites `attendeeEmails` directly — Calendar invites are email-based, so
 * (unlike GitHub collaborator invites) this works for any project member
 * with a known email, whether or not they've connected Google themselves.
 * Requires the calendar.events scope (see googleProvider in lib/firebase.js).
 */
export async function createCalendarEvent(accessToken, { summary, description, startISO, endISO, attendeeEmails = [] }) {
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      summary,
      description,
      start: { dateTime: startISO },
      end: { dateTime: endISO },
      attendees: attendeeEmails.map((email) => ({ email })),
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || "Couldn't create the calendar event.");
  }
  return res.json();
}

/**
 * Lists events on the caller's primary Google Calendar within a date range
 * — powers the Calendar tab's month grid so it shows real synced Calendar
 * data, not just the events this app itself created. Read-only; doesn't
 * need any scope beyond what createCalendarEvent already requires.
 */
export async function listCalendarEvents(accessToken, { timeMinISO, timeMaxISO }) {
  const params = new URLSearchParams({
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Couldn't load Google Calendar events.");
  const data = await res.json();
  return data.items || [];
}

export async function deleteCalendarEvent(accessToken, eventId) {
  await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}?sendUpdates=all`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {});
}

export async function listGithubRepos(accessToken, limit = 8) {
  const res = await fetch(`https://api.github.com/user/repos?per_page=${limit}&sort=updated`, {
    headers: { Authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error("Couldn't load GitHub repos.");
  return res.json();
}

/**
 * Public repo list for a given username — no access token needed, since
 * this is what powers the "GitHub repositories" section on a profile page,
 * which anyone signed in can view (not just the repo owner). Only ever
 * returns public repos, same as visiting github.com/{username} yourself.
 */
export async function listPublicGithubRepos(username, limit = 6) {
  const res = await fetch(`https://api.github.com/users/${username}/repos?per_page=${limit}&sort=updated&type=owner`, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error("Couldn't load GitHub repos.");
  return res.json();
}

/** Turns a project name into a GitHub-safe repo name (letters/digits/./-/_). */
export function slugifyRepoName(name) {
  const slug = (name || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "project";
}

/**
 * Creates a Drive folder named after the project. Uses the drive.file
 * scope, which is enough to create/manage files the app itself creates.
 * Returns { id, url }.
 *
 * Also opens the folder to "anyone with the link can edit." This is what
 * makes new members' access automatic — Drive has no per-user "invite"
 * primitive we can call on someone else's behalf without their own token
 * (unlike GitHub's collaborator invites), so link sharing is the practical
 * way to get every current *and future* project member in without needing
 * the folder owner's token to still be valid every time someone joins.
 * Trade-off: anyone who gets hold of the link can edit it, not just members
 * — worth knowing if a project folder ends up holding anything sensitive.
 */
export async function createDriveFolder(accessToken, name) {
  const res = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || "Couldn't create the Drive folder.");
  }
  const data = await res.json();

  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ role: "writer", type: "anyone" }),
    });
  } catch (err) {
    // Non-fatal — the folder still exists and the owner still has access;
    // it just won't auto-share with teammates until this is retried.
    console.error("Couldn't set Drive folder link-sharing:", err);
  }

  return { id: data.id, url: data.webViewLink || `https://drive.google.com/drive/folders/${data.id}` };
}

/**
 * Adds `username` as a collaborator on `ownerLogin/repoName`, using the
 * repo owner's own access token (only they can grant access — there's no
 * link-sharing equivalent for private GitHub repos). This creates a real
 * GitHub repo invitation the invitee accepts from their notifications or
 * the repo's Invitations page; it does not grant instant access.
 */
/**
 * Uploads `file` into a Drive folder using a simple multipart upload (metadata
 * + bytes in one request — fine for the chat-attachment sizes this app deals
 * with; a resumable session isn't worth the complexity here). Returns
 * { id, url }. Used by the chat attachment "also add to Drive" toggle.
 */
export async function uploadFileToDrive(accessToken, folderId, file) {
  const metadata = { name: file.name, parents: folderId ? [folderId] : undefined };
  const boundary = `blueprint-${Date.now()}`;
  const fileBuf = await file.arrayBuffer();
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\ncontent-type: ${file.type || "application/octet-stream"}\r\n\r\n`
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const body = new Blob([head, fileBuf, tail]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "content-type": `multipart/related; boundary=${boundary}` },
      body,
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || "Couldn't add that file to Drive.");
  }
  const data = await res.json();
  return { id: data.id, url: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view` };
}

export async function inviteGithubCollaborator(ownerAccessToken, fullName, username, permission = "push") {
  const res = await fetch(`https://api.github.com/repos/${fullName}/collaborators/${username}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${ownerAccessToken}`, accept: "application/vnd.github+json", "content-type": "application/json" },
    body: JSON.stringify({ permission }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Couldn't invite that GitHub collaborator.");
  }
}

/**
 * Creates a GitHub repo named after the project (private by default). If
 * the name is taken, GitHub 422s — this retries once with a short random
 * suffix rather than failing project creation outright.
 * Returns { fullName, url }.
 */
export async function createGithubRepo(accessToken, name, { private: isPrivate = true } = {}) {
  async function attempt(repoName) {
    const res = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json", "content-type": "application/json" },
      body: JSON.stringify({ name: repoName, private: isPrivate, auto_init: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.message || "Couldn't create the GitHub repo.");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return { fullName: data.full_name, url: data.html_url };
  }

  const base = slugifyRepoName(name);
  try {
    return await attempt(base);
  } catch (err) {
    const nameTaken = err.status === 422 && JSON.stringify(err.data).includes("already exists");
    if (!nameTaken) throw err;
    return attempt(`${base}-${Math.random().toString(36).slice(2, 6)}`);
  }
}

/**
 * Permanently deletes a Drive folder (and everything in it) — used when a
 * project owner switches off the "Connect Drive" toggle in Settings. This
 * is a real Drive delete (not just moving to trash), matching what the
 * confirmation warning shown before calling this actually promises. Needs
 * the same drive.file scope createDriveFolder already uses, and only works
 * if the calling account is the one that owns the folder (i.e. whoever's
 * Drive connection originally created it).
 */
export async function deleteDriveFolder(accessToken, folderId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // Drive returns 204 with an empty body on success; a 404 here almost
  // always means the folder was already removed by hand (e.g. from
  // drive.google.com directly) — treat that as success too rather than
  // blocking the toggle from turning off.
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || "Couldn't delete the Drive folder.");
  }
}

/**
 * Permanently deletes a GitHub repo — used when a project owner switches
 * off the "Connect GitHub" toggle in Settings. GitHub gates this specific
 * endpoint behind the `delete_repo` OAuth scope, which is separate from
 * (and not included by) the plain `repo` scope this app's sign-in already
 * requests — see the `delete_repo` addScope call in lib/firebase.js.
 * Anyone who connected GitHub before that scope was added will get a 403
 * here until they reconnect (Preferences → Connected accounts →
 * Refresh/Reconnect GitHub) to re-grant access with the new scope.
 */
export async function deleteGithubRepo(accessToken, fullName) {
  const res = await fetch(`https://api.github.com/repos/${fullName}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json" },
  });
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    const missingScope = res.status === 403;
    const err = new Error(
      missingScope
        ? "GitHub refused to delete this repo — your connection is missing delete permission."
        : data.message || "Couldn't delete the GitHub repo."
    );
    // Lets callers show a "Reconnect GitHub" button specifically, rather
    // than string-matching the message — see reconnectGithub() above.
    if (missingScope) err.missingGithubScope = true;
    throw err;
  }
}

/**
 * Lists every file directly inside a Drive folder (one level, not
 * recursive — matches how createDriveFolder/uploadFileToDrive use these
 * folders as a flat drop point, not a nested tree). Powers the "Download
 * files" action next to the Drive toggle in project Settings.
 */
export async function listDriveFolderFiles(accessToken, folderId) {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id,name,mimeType,size)",
    pageSize: "1000",
    spaces: "drive",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Couldn't list the files in that Drive folder.");
  const data = await res.json();
  return data.files || [];
}

/**
 * Downloads a single Drive file's bytes as a Blob. Native Google Workspace
 * files (Docs/Sheets/Slides — mimeType starting "application/vnd.google-
 * apps.") have no raw bytes to download directly; those get exported as a
 * PDF instead (a reasonable universal fallback that opens anywhere,
 * without needing to pick a different export format per file type).
 * Everything else (uploads: images, PDFs already, zips, code files, etc.)
 * downloads via the plain media endpoint.
 */
export async function downloadDriveFile(accessToken, file) {
  const isGoogleNative = file.mimeType?.startsWith("application/vnd.google-apps.");
  const url = isGoogleNative
    ? `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=application/pdf`
    : `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Couldn't download "${file.name}".`);
  return res.blob();
}
