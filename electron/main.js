const { app, BrowserWindow, session } = require("electron");

// Your live deployed app — the desktop shell just wraps this.
const APP_URL = "https://blueprint-app-dhruv-raj-singh-s-projects.vercel.app";

// Google refuses to show its OAuth consent screen inside the default
// Electron user agent ("disallowed_useragent" error). Spoofing a normal
// desktop Chrome UA is the standard, documented fix.
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function createWindow() {
  const win = new BrowserWindow({
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
    },
  });

  win.webContents.setUserAgent(CHROME_UA);
  win.loadURL(APP_URL);

  // The Google/GitHub OAuth popup opens as a new window (signInWithPopup).
  // Let it open as a real window rather than blocking it.
  win.webContents.setWindowOpenHandler(() => ({
    action: "allow",
    overrideBrowserWindowOptions: {
      webPreferences: { contextIsolation: true },
    },
  }));
}

app.whenReady().then(() => {
  session.defaultSession.setUserAgent(CHROME_UA);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
