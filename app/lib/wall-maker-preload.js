// The hidden page that makes a wallpaper's small copy (lib/wallpaper.js) reports back through this bridge only.
// The channel comes from the page's own URL, read when a message goes out: at preload time the URL may not be set yet.
const { contextBridge, ipcRenderer } = require("electron");
const chan = () => new URLSearchParams(location.search).get("chan");
contextBridge.exposeInMainWorld("maker", {
  progress: (p) => ipcRenderer.send(`${chan()}:progress`, p),
  done: (bytes) => ipcRenderer.send(`${chan()}:done`, bytes),
  fail: () => ipcRenderer.send(`${chan()}:fail`),
});
