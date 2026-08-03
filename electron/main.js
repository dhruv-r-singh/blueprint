const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");

// Your live deployed app — the desktop shell just wraps this.
const APP_URL = "https://blueprint-app-dhruv-raj-singh-s-projects.vercel.app";

// Domains it's ever legitimate for the app to ask the OS to open in the
// user's real browser — Google/GitHub's OAuth screens, plus this app's own
// domain (the sign-in flow opens our /api/auth/*/desktop-start route
// directly, which immediately 302s to Google/GitHub — no separate fetch
// first, unlike the "connect" flow, which resolves the provider URL
// server-side and passes that along instead). Anything else gets ignored;
// openExternal is exposed to the renderer (see preload.js) and this
// allowlist is what keeps that from becoming a generic "open any URL on
// the user's machine" backdoor.
const EXTERNAL_ALLOWLIST = [
  /^https:\/\/accounts\.google\.com\//,
  /^https:\/\/github\.com\/login\/oauth\//,
  new RegExp(`^${APP_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`),
];

// Custom protocol scheme used to hand control back to this app once a
// Google/GitHub sign-in finishes in the system browser (see
// app/api/auth/google/desktop-callback and .../github/desktop-callback,
// and lib/desktopAuth.js for the full story of why this exists — it
// replaces an old approach that got the app flagged as malware).
const PROTOCOL = "blueprint";

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "Blueprint",
    autoHideMenuBar: true,
    backgroundColor: "#0b2340", // matches the app's navy so load-in doesn't flash white
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadURL(APP_URL);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Nothing in the app should ever need to open a new Electron window
  // anymore — Google/GitHub sign-in goes through the system browser via
  // openExternal below, and LinkedIn is already a same-window redirect. If
  // anything still tries window.open(), send it to the real browser instead
  // of spawning an embedded popup.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

/** Pulls a blueprint://auth-callback?... URL's query params into the loaded site as a normal query string, so the existing web app code (app/desktop-auth/page.js) can handle it exactly like any other redirect. */
function handleProtocolUrl(rawUrl) {
  if (!mainWindow) return;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== `${PROTOCOL}:`) return;
    mainWindow.loadURL(`${APP_URL}/desktop-auth${parsed.search}`);
    mainWindow.show();
    mainWindow.focus();
  } catch (err) {
    console.error("Couldn't parse protocol URL:", rawUrl, err);
  }
}

app.setAsDefaultProtocolClient(PROTOCOL);

// Windows/Linux: a blueprint:// link launches a *second* instance of the
// app, whose only job is to hand the URL to the already-running one, then
// quit. Must be requested before app.whenReady().
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (event, argv) => {
    const url = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (url) handleProtocolUrl(url);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // macOS: the OS delivers the link via this event instead, whether or not
  // the app was already running.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (mainWindow) handleProtocolUrl(url);
    else app.whenReady().then(() => { createWindow(); handleProtocolUrl(url); });
  });

  app.whenReady().then(() => {
    // Handle the case where this very launch *was* the protocol link
    // (Windows/Linux cold start via blueprint://...).
    const launchUrl = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    createWindow();
    if (launchUrl) handleProtocolUrl(launchUrl);

    ipcMain.handle("open-external", (event, url) => {
      if (typeof url === "string" && EXTERNAL_ALLOWLIST.some((re) => re.test(url))) {
        shell.openExternal(url);
        return true;
      }
      console.warn("Blocked an openExternal request to a non-allowlisted URL:", url);
      return false;
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
