const { contextBridge, ipcRenderer } = require("electron");

// Exposed to the site running inside the desktop window (contextIsolation
// is on, nodeIntegration is off — this is the only bridge between the two).
// `isDesktop` lets the web app's own code (lib/desktopAuth.js) detect it's
// running in Electron and route Google/GitHub sign-in through the system
// browser instead of an embedded popup. `openExternal` is how it actually
// does that — routed through the main process, which only allows it for
// Google/GitHub's own OAuth URLs (see main.js's EXTERNAL_ALLOWLIST), so this
// can't be used as a generic "open anything" bridge.
contextBridge.exposeInMainWorld("blueprintDesktop", {
  isDesktop: true,
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
