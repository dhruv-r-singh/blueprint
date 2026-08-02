// Client-side helpers for the Google Drive / GitHub connections.
//
// Design: the OAuth "authorization code -> token" exchange has to happen
// server-side (it needs the client secret), so that's the only part routed
// through our own API (app/api/oauth/**). Everything else — building the
// consent URL, calling the Drive/GitHub REST APIs to list files/repos, and
// storing the resulting tokens — happens directly from the browser using
// the already-authenticated Firestore client SDK. No firebase-admin/service
// account needed.
//
// Requires env vars (see SETUP_NOTES.md):
//   NEXT_PUBLIC_GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   NEXT_PUBLIC_GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GITHUB_SCOPE = "repo read:user";

// Where Drive/GitHub tokens live in Firestore. Deliberately NOT on
// profiles/{uid} directly — that document is readable by any signed-in user
// (needed so profiles are discoverable for matching), which would leak
// access tokens. This subcollection needs its own locked-down rule; see
// SETUP_NOTES.md.
export function integrationsDocPath(uid) {
  return ["profiles", uid, "private", "integrations"];
}

export function googleConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
}
export function githubConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID);
}

function redirectUri() {
  return `${window.location.origin}/account`;
}

export function startGoogleConnect() {
  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: "google",
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function startGithubConnect() {
  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: GITHUB_SCOPE,
    state: "github",
  });
  window.location.href = `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeGoogleCode(code) {
  const res = await fetch("/api/oauth/google/callback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, redirectUri: redirectUri() }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Google connection failed.");
  return data; // { access_token, refresh_token, expires_in }
}

export async function exchangeGithubCode(code) {
  const res = await fetch("/api/oauth/github/callback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, redirectUri: redirectUri() }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "GitHub connection failed.");
  return data; // { access_token }
}

export async function refreshGoogleToken(refreshToken) {
  const res = await fetch("/api/oauth/google/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Google token refresh failed.");
  return data; // { access_token, expires_in }
}

/** Returns a live Drive access token, refreshing it first if it's expired. */
export async function ensureFreshGoogleToken(profile, saveFn) {
  const expired = !profile.driveTokenExpiresAt || Date.now() > profile.driveTokenExpiresAt - 60_000;
  if (!expired) return profile.driveAccessToken;
  if (!profile.driveRefreshToken) throw new Error("Drive connection needs to be reconnected.");
  const { access_token, expires_in } = await refreshGoogleToken(profile.driveRefreshToken);
  const expiresAt = Date.now() + expires_in * 1000;
  await saveFn({ driveAccessToken: access_token, driveTokenExpiresAt: expiresAt });
  return access_token;
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

export async function listGithubRepos(accessToken, limit = 8) {
  const res = await fetch(`https://api.github.com/user/repos?per_page=${limit}&sort=updated`, {
    headers: { Authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error("Couldn't load GitHub repos.");
  return res.json();
}
