// The only bridge between the window and the main process. The window can ask
// for data, drive the terminal, and change settings; it cannot touch files.
const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("flash", {
  platform: process.platform,
  info: () => ipcRenderer.invoke("app:info"),
  config: () => ipcRenderer.invoke("config:get"),
  setConfig: (patch) => ipcRenderer.invoke("config:set", patch),
  setDockIcon: (png) => ipcRenderer.send("dock:icon", png),
  setupCheck: () => ipcRenderer.invoke("setup:check"),
  chooseVault: () => ipcRenderer.invoke("vault:choose"),
  createVault: (parent) => ipcRenderer.invoke("vault:create", parent),
  vaultTarget: (parent) => ipcRenderer.invoke("vault:target", parent),
  pickVaultParent: () => ipcRenderer.invoke("vault:pick-parent"),
  chooseFile: () => ipcRenderer.invoke("file:choose"),
  closeOut: (slug) => ipcRenderer.invoke("tutor:close", slug || ""),
  saveImage: (bytes, type) => ipcRenderer.invoke("image:save", bytes, type),
  state: () => ipcRenderer.invoke("state:get"),
  session: (slug) => ipcRenderer.invoke("session:get", slug),
  openExternal: (url) => ipcRenderer.invoke("open:external", url),
  showFile: (rel) => ipcRenderer.invoke("open:file", rel),
  questions: {
    list: (all) => ipcRenderer.invoke("q:list", !!all),
    get: (id) => ipcRenderer.invoke("q:get", id),
    ask: (id, text, images) => ipcRenderer.invoke("q:ask", id || "", text, images || []),
    archive: (id, on) => ipcRenderer.invoke("q:archive", id, on),
    mark: (id, patch) => ipcRenderer.invoke("q:mark", id, patch),
    stop: (id) => ipcRenderer.invoke("q:stop", id),
    onChanged: on("q:changed"),
    onDelta: on("q:delta"),
  },
  pty: {
    start: (opts) => ipcRenderer.invoke("pty:start", opts),
    running: () => ipcRenderer.invoke("pty:running"),
    stop: () => ipcRenderer.invoke("pty:stop"),
    write: (data) => ipcRenderer.send("pty:write", data),
    resize: (cols, rows) => ipcRenderer.send("pty:resize", { cols, rows }),
    onData: on("pty:data"),
    onExit: on("pty:exit"),
  },
  // The window: shown once Home is drawn, hidden while a quit waits for the reply.
  onZoom: on("zoom"),   // the page's zoom on this display (main.js fitZoom)
  windowReady: () => ipcRenderer.send("window:ready"),
  showWindow: () => ipcRenderer.send("window:show"),
  hideWindow: () => ipcRenderer.send("window:hide"),
  quitAck: () => ipcRenderer.send("quit:ack"),
  quitNow: () => ipcRenderer.send("quit:now"),
  onQuitRequest: on("quit:request"),
  quitWaiting: (on) => ipcRenderer.send("quit:waiting", on),
  onShown: on("window:shown"),
  seen: { get: () => ipcRenderer.invoke("seen:get"), set: (lines) => ipcRenderer.invoke("seen:set", lines) },
  onState: on("state:changed"),
  onSession: on("session:changed"),
  onMenu: on("menu"),
  onFocus: on("window:focus"),
  // the wallpaper behind the window (lib/wallpaper.js)
  dictation: {
    status: (kind) => ipcRenderer.invoke("dictation:status", kind),
    download: (kind) => ipcRenderer.invoke("dictation:download", kind),
    stop: () => ipcRenderer.invoke("dictation:stop"),
    remove: (kind) => ipcRenderer.invoke("dictation:remove", kind),
    mic: () => ipcRenderer.invoke("dictation:mic"),
    onProgress: on("dictation:progress"),
  },
  wall: {
    resolve: (night, force) => ipcRenderer.invoke("wall:resolve", !!night, !!force),
    catalog: () => ipcRenderer.invoke("wall:catalog"),
    clear: (night) => ipcRenderer.invoke("wall:clear", !!night),
    choosePhoto: () => ipcRenderer.invoke("wall:photo"),
    battery: () => ipcRenderer.invoke("wall:battery"),
    onPlace: on("wall:place"),
    onPower: on("wall:power"),
    onStatus: on("wall:status"),
  },
});
