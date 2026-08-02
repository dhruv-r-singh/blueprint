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
// Trade-off: Firebase's client SDK doesn't expose a refresh token for the
// Google credential, so a Drive connection is only good for about an hour.
// ensureFreshGoogleToken() surfaces a clear "reconnect" error once it's
// stale — signing in (or re-linking Google) again is what refreshes it.

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

/**
 * Call right after signInWithPopup/linkWithPopup with googleProvider
 * resolves. Pulls the Drive-scoped access token out of the result and saves
 * it via setDoc-style saveFn. No-ops quietly if the user declined the Drive
 * scope on Google's consent screen (credential.accessToken will be missing).
 */
export async function saveGoogleCredential(result, saveFn) {
  const { GoogleAuthProvider } = await import("firebase/auth");
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) return false;
  await saveFn({
    driveAccessToken: credential.accessToken,
    driveTokenExpiresAt: Date.now() + GOOGLE_TOKEN_TTL_MS,
  });
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
  await saveFn({ githubAccessToken: credential.accessToken });

  if (savePublicFn) {
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${credential.accessToken}`, accept: "application/vnd.github+json" },
      });
      if (res.ok) {
        const me = await res.json();
        if (me.login) await savePublicFn({ githubUsername: me.login });
      }
    } catch (err) {
      console.error("Couldn't look up GitHub username:", err);
    }
  }
  return true;
}

/**
 * Returns a live Drive access token, or throws a message telling the user
 * how to fix it. There's no refresh token available via this flow, so
 * "fixing it" means signing in with Google again (or re-linking it in
 * Account settings), which re-runs saveGoogleCredential with a fresh token.
 */
export async function ensureFreshGoogleToken(profile) {
  const expired = !profile?.driveTokenExpiresAt || Date.now() > profile.driveTokenExpiresAt - 60_000;
  if (!expired) return profile.driveAccessToken;
  throw new Error("Your Drive connection expired — sign in with Google again (or reconnect it in Account settings) to refresh it.");
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
  await savePublicFn({ email: user.email, name: user.displayName || user.email });
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
