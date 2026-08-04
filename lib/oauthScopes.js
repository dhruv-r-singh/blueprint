// Single source of truth for the OAuth scopes this app requests from
// Google and GitHub — shared between the web flow (Firebase's own provider
// objects, lib/firebase.js) and the desktop flow (app/api/auth/*/desktop-*
// routes, which talk to Google/GitHub directly since Firebase's client SDK
// can't be used from inside Electron — see lib/desktopAuth.js).
//
// Why this file exists: these two flows drifted out of sync once already.
// `delete_repo` got added to the Firebase GitHub provider (so repo
// deletion would work) but nobody updated the desktop routes' own
// hand-typed `scope` string — they're a completely separate code path that
// doesn't read lib/firebase.js at all. The result: reconnecting GitHub
// from inside the desktop app could never actually grant delete
// permission, no matter how many times someone did it, because the
// authorize request itself never asked GitHub for it. Every scope list in
// the app now reads from here instead of being hand-typed in four
// different places, so this specific class of bug can't happen again —
// add a scope once, here, and both flows pick it up.

// Added on top of whatever base identity scopes Firebase's own GitHub
// provider config already requests by default.
export const GITHUB_EXTRA_SCOPES = ["repo", "delete_repo"];

// The desktop flow isn't going through Firebase's OAuth config at all, so
// it has to spell out the identity scopes explicitly too.
export const GITHUB_DESKTOP_SCOPE = ["repo", "delete_repo", "read:user", "user:email"].join(" ");

// Added on top of Firebase's own default `openid profile email` for Google.
export const GOOGLE_EXTRA_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.events",
];

export const GOOGLE_DESKTOP_SCOPE = ["openid", "email", "profile", ...GOOGLE_EXTRA_SCOPES].join(" ");
