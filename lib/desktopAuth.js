// Helpers for Google/GitHub sign-in when running inside the Electron
// desktop shell (electron/main.js + electron/preload.js).
//
// Why this exists: the desktop app used to load Google's OAuth screen in an
// embedded popup with a spoofed Chrome user-agent (the "standard" Electron
// workaround for Google's "disallowed_useragent" block). That combination —
// a non-browser window pretending to be Chrome in order to show a Google
// login page — is indistinguishable from how real credential-phishing
// malware behaves, and macOS's built-in malware scanner (XProtect) started
// deleting the app outright ("‘Blueprint’ was not opened because it
// contains malware") instead of just warning about it being unsigned.
//
// The fix: never load Google/GitHub's own pages inside the Electron window
// at all. Sign-in opens in the user's real, already-trusted browser via
// `blueprintDesktop.openExternal` (see electron/preload.js), completes a
// normal server-side OAuth code exchange (app/api/auth/google/desktop-*,
// app/api/auth/github/desktop-*), and hands control back to the app via a
// custom `blueprint://` link that the OS routes straight back into
// Electron (see electron/main.js's `open-url`/second-instance handling and
// app/desktop-auth/page.js). This is the same pattern Slack, Discord, and
// VS Code use for desktop OAuth.

/** True when running inside the Electron shell (see electron/preload.js). */
export function isDesktopApp() {
  return typeof window !== "undefined" && Boolean(window.blueprintDesktop?.isDesktop);
}

/**
 * Starts a fresh Google/GitHub sign-in via the system browser. No ID token
 * needed yet — the callback route creates/finds the matching Firebase user
 * itself and hands back a custom token through the blueprint:// redirect.
 */
export function startDesktopSignIn(kind, returnPath = "/") {
  const url = `${window.location.origin}/api/auth/${kind}/desktop-start?return=${encodeURIComponent(returnPath)}`;
  window.blueprintDesktop.openExternal(url);
}

/**
 * Starts a Google/GitHub *link* (or Drive/repo access refresh) for the
 * already-signed-in user, from /account. Mirrors the LinkedIn link-start
 * flow: POST the caller's ID token to get back a one-time URL, then open
 * that in the system browser rather than navigating there directly (the ID
 * token never sits in a URL this way).
 */
export async function startDesktopLink(kind, idToken) {
  const res = await fetch(`/api/auth/${kind}/desktop-link-start`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error(data.error || `Couldn't start connecting ${kind === "google" ? "Google" : "GitHub"}.`);
  window.blueprintDesktop.openExternal(data.url);
}
