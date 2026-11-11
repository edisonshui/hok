// The wallpaper behind the window (macOS, 10 Nov 2026). The whole window (sidebar, panel, frame) always shows a
// wallpaper under its glass, whatever window sits behind it (Edison, 10 Nov: "the appearance of a wallpaper all the
// time no matter what screen its behind"). It plays a small, pre-blurred copy, never the 4K file: the glass blurs the
// picture anyway, and the copy costs about a fifth of the power (energy impact 9.5 against 49, measured 10 Nov in a
// test window). This module finds the picture, makes the copy once, and serves it to the page as wall-file:.
//
// A choice (config.wallpaper) is one of:
//   { kind: "desktop" }               your desktop's own picture: its Aerial if it plays one, else its still
//   { kind: "aerial", id }            an Apple Aerial; one not on this Mac streams from Apple once, while the copy is made
//   { kind: "mac", id }               one of the moving Mac wallpapers that ship with macOS (Sonoma, Tahoe Day)
//   { kind: "photo", file }           a picture you chose
//   { kind: "stone" }                 no picture: the page draws slow light in your stone
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const HOME = os.homedir();
const AERIALS = path.join(HOME, "Library/Application Support/com.apple.wallpaper/aerials");
const STORE = path.join(HOME, "Library/Application Support/com.apple.wallpaper/Store/Index.plist");
const MAC_DIR = "/System/Library/Desktop Pictures/.wallpapers";
const PICKS = require("./wallpaper-picks.json");   // the Aerials Edison chose to offer (10 Nov); Cities are left out as too busy
const CLIP_SECONDS = 90;   // a copy holds at most this much, then loops
// Copies are recorded at 2.4 Mbit/s (11 Nov, Edison: the picture looked "really grainy"; at 0.7 the smooth colours
// of Mac Blue broke into blocks and bands once stretched over the window), as H.264, which the Mac decodes in hardware:
// as VP9 the same copy cost energy impact 23.6 playing, as H.264 8.0 (measured 11 Nov, bench in home-r5). A copy is
// 10 to 27 MB. V marks this format in the file name, so older copies are made again and cleared at launch.
const COPY_BITS = 2400000, V = ".v3", COPY = /\.(webm|mp4)$/;

const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { maxBuffer: 1 << 24 }, (err, out) => resolve(err ? null : String(out))));
const exists = (f) => { try { return fs.statSync(f).size > 0; } catch { return false; } };

function make({ BrowserWindow, userData, onStatus }) {
  const CACHE = path.join(userData, "wallpapers");
  fs.mkdirSync(CACHE, { recursive: true });
  const copyFile = (key) => path.join(CACHE, `${key}${V}.mp4`);
  try { fs.readdirSync(CACHE).filter((f) => /\.(webm|mp4)(\.part)?$/.test(f) && !f.endsWith(`${V}.mp4`)).forEach((f) => fs.rmSync(path.join(CACHE, f), { force: true })); } catch { /* nothing to clear */ }
  const jobs = new Map();   // key -> promise of the finished copy, so a second ask waits for the first
  const stops = new Map();  // key -> stops that copy, when you pick another wallpaper before it finishes
  const failed = new Map();   // key -> when its copy last failed: not retried on its own for ten minutes
  const makers = new Set();   // the hidden pages making copies, by webContents id (main.js trusts Apple's server for these only)

  let manifest = null;
  function aerialEntries() {
    if (manifest) return manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(AERIALS, "manifest/entries.json"), "utf8")).assets || []; } catch { manifest = []; }
    return manifest;
  }
  const aerial = (id) => aerialEntries().find((a) => a.id === id) || null;
  const localAerial = (id) => { const f = path.join(AERIALS, "videos", `${id}.mov`); return exists(f) ? f : null; };

  // The moving Mac wallpapers macOS ships with: a folder per wallpaper holding one .mov, or a Light and a Dark one.
  function macWallpapers() {
    let dirs = []; try { dirs = fs.readdirSync(MAC_DIR); } catch { return []; }
    return dirs.map((name) => {
      const files = (() => { try { return fs.readdirSync(path.join(MAC_DIR, name)); } catch { return []; } })();
      const movs = files.filter((f) => f.endsWith(".mov") && !/Portrait/i.test(f));
      if (!movs.length) return null;
      const pick = (night) => movs.find((f) => (night ? /Dark/ : /Light/).test(f)) || movs[0];
      const thumb = files.find((f) => /Thumbnail\.png$/.test(f));
      return { id: name, name, day: path.join(MAC_DIR, name, pick(false)), night: path.join(MAC_DIR, name, pick(true)), thumb: thumb ? path.join(MAC_DIR, name, thumb) : macThumb(name, path.join(MAC_DIR, name, pick(false))) };
    }).filter(Boolean);
  }

  // a Mac wallpaper's thumbnail, made once from the HEIC macOS keeps for System Settings, or from its video
  function macThumb(name, mov) {
    const out = path.join(CACHE, `thumb-mac-${name.replace(/\W+/g, "-")}.png`);
    if (exists(out)) return out;
    const src = [`${name}.heic`, `${name} Dark.heic`].map((f) => path.join("/System/Library/Desktop Pictures/.thumbnails", f)).find(exists);
    const sync = require("child_process").execFileSync;
    try {
      if (src) sync("/usr/bin/sips", ["-s", "format", "png", "-Z", "320", src, "--out", out], { stdio: "ignore", timeout: 5000 });
      else if (mov) {   // macOS keeps no still for this one (Tahoe Day): Quick Look draws a frame of its video
        sync("/usr/bin/qlmanage", ["-t", "-s", "320", "-o", CACHE, mov], { stdio: "ignore", timeout: 10000 });
        fs.renameSync(path.join(CACHE, path.basename(mov) + ".png"), out);
      }
    } catch { return null; }
    return exists(out) ? out : null;
  }

  // Your desktop's picture: the Aerial it plays (System Settings keeps the asset id in its store), else the still
  // macOS reports for the main screen.
  async function desktopPicture() {
    // plutil can't turn this store into JSON (it holds dates and data), so read the one field: the choice's
    // Configuration is itself a small plist holding the Aerial's assetID
    const b64 = await run("/usr/bin/plutil", ["-extract", "AllSpacesAndDisplays.Linked.Content.Choices.0.Configuration", "raw", "-o", "-", STORE]);
    if (b64 && b64.trim()) {
      const tmp = path.join(CACHE, "store-config.plist");
      try {
        fs.writeFileSync(tmp, Buffer.from(b64.trim(), "base64"));
        const id = ((await run("/usr/bin/plutil", ["-extract", "assetID", "raw", "-o", "-", tmp])) || "").trim();
        if (id && (localAerial(id) || aerial(id))) return { kind: "aerial", id };
        const mac = macWallpapers().find((m) => id && id.toLowerCase().includes(m.id.toLowerCase()));
        if (mac) return { kind: "mac", id: mac.id };
      } catch { /* a store this macOS writes differently */ }
    }
    const still = await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", 'ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.desktopImageURLForScreen($.NSScreen.mainScreen).path.js']);
    return still && still.trim() ? { kind: "photo", file: still.trim() } : { kind: "stone" };
  }

  // A still becomes a 1280-wide JPEG in the cache (sips reads HEIC, which Chromium can't); the page blurs it once.
  async function stillCopy(file) {
    const key = "still-" + crypto.createHash("sha1").update(file + (fs.statSync(file).mtimeMs || 0)).digest("hex").slice(0, 12);
    const out = path.join(CACHE, `${key}.jpg`);
    if (!exists(out)) await run("/usr/bin/sips", ["-s", "format", "jpeg", "-Z", "1280", file, "--out", out]);
    return exists(out) ? out : null;
  }

  // The small copy: a hidden page plays the source once at its own speed, draws each frame into a 640x360 canvas
  // through a 3 px blur, and records that canvas. A 90-second clip takes 90 seconds, once, and comes out near 4 MB.
  // The page runs with web security off so a video streamed from Apple can be drawn into its canvas (a cross-origin
  // frame taints the canvas and the recorder refuses it); it is the app's own page and loads only that one video.
  function videoCopy(key, src, label) {
    const out = copyFile(key);
    if (exists(out)) return Promise.resolve(out);
    if (jobs.has(key)) return jobs.get(key);
    const job = new Promise((resolve) => {
      const w = new BrowserWindow({ width: 640, height: 360, show: false, webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true, webSecurity: false, preload: path.join(__dirname, "wall-maker-preload.js") } });
      makers.add(w.webContents.id);
      const done = (file, stopped) => { if (jobs.get(key) !== job) return; jobs.delete(key); stops.delete(key); if (stopped) { makers.delete(w.webContents.id); if (!w.isDestroyed()) w.destroy(); onStatus({ key, label, done: true, ok: false, stopped: true }); return resolve(null); } if (!file) failed.set(key, Date.now()); makers.delete(w.webContents.id); if (!w.isDestroyed()) w.destroy(); onStatus({ key, label, done: true, ok: !!file }); resolve(file); };
      const { ipcMain } = require("electron");
      const chan = `wall-maker:${key}`;
      ipcMain.once(`${chan}:done`, (_e, bytes) => { try { fs.writeFileSync(out + ".part", Buffer.from(bytes)); fs.renameSync(out + ".part", out); done(out); } catch { done(null); } });
      ipcMain.on(`${chan}:progress`, (_e, p) => onStatus({ key, label, progress: p }));
      ipcMain.once(`${chan}:fail`, () => done(null));
      w.webContents.once("destroyed", () => { ipcMain.removeAllListeners(`${chan}:progress`); ipcMain.removeAllListeners(`${chan}:done`); ipcMain.removeAllListeners(`${chan}:fail`); });
      if (process.env.WALL_DEBUG) w.webContents.on("console-message", (e) => console.log("[wall-maker]", e.message));
      w.webContents.on("render-process-gone", (_e, d) => { console.error("[wall-maker] gone", d.reason); done(null); });
      w.loadFile(path.join(__dirname, "..", "renderer", "wall-maker.html"), { query: { src, chan, secs: String(CLIP_SECONDS), bits: String(COPY_BITS) } });
      stops.set(key, () => done(null, true));
      setTimeout(() => { if (jobs.get(key) === job) done(null); }, (CLIP_SECONDS + 120) * 1000);   // a stalled stream gives up
      onStatus({ key, label, progress: 0 });
    });
    jobs.set(key, job);
    return job;
  }

  // What the page should show for a choice: { type: "video" | "image" | "stone", file?, preparing? }.
  async function resolve(choice, night, force) {
    const c = choice && choice.kind ? choice : { kind: "desktop" };
    if (c.kind === "desktop") return resolve(await desktopPicture(), night, force);
    if (c.kind === "stone") return { type: "stone" };
    if (c.kind === "photo") { const f = c.file && fs.existsSync(c.file) ? await stillCopy(c.file) : null; return f ? { type: "image", file: f } : { type: "stone" }; }
    if (c.kind === "mac") {
      const m = macWallpapers().find((x) => x.id === c.id); if (!m) return { type: "stone" };
      const src = night ? m.night : m.day, key = "mac-" + c.id.replace(/\W+/g, "-") + (src === m.night && m.night !== m.day ? "-dark" : "");
      return ready(key, src, m.name, force, m.thumb);
    }
    if (c.kind === "aerial") {
      const a = aerial(c.id), src = localAerial(c.id) || (a && a["url-4K-SDR-240FPS"]);
      if (!src) return { type: "stone" };
      return ready("aerial-" + c.id, src, (a && a.accessibilityLabel) || "Aerial", force, aerialThumb(c.id));
    }
    return { type: "stone" };
  }
  // A copy on disk is used now; one still being made says so, and the page hears again when it lands.
  // Until the moving copy lands, the page shows the wallpaper's still (its thumbnail, blurred), so a pick shows at
  // once (11 Nov, Edison: "nothing was loading when I was selecting wallpapers"). Picking another wallpaper stops
  // the copies still being made for the ones you passed over.
  async function ready(key, src, label, force, still) {
    [...stops.keys()].filter((k) => k !== key).forEach((k) => stops.get(k)());
    const out = copyFile(key);
    if (exists(out)) return { type: "video", file: out };
    if (!force && Date.now() - (failed.get(key) || 0) < 10 * 60e3) return { type: "stone", failed: { key, label }, still };
    videoCopy(key, src.startsWith("http") ? src : "file://" + src, label);
    return { type: "stone", preparing: { key, label }, still };
  }
  // The copies kept on this Mac, and clearing them (all but the one in use) to give the space back.
  function copies() {
    let files = []; try { files = fs.readdirSync(CACHE).filter((f) => COPY.test(f)); } catch { /* none */ }
    return { count: files.length, bytes: files.reduce((n, f) => { try { return n + fs.statSync(path.join(CACHE, f)).size; } catch { return n; } }, 0) };
  }
  async function clear(choice, night) {
    const now = await resolve(choice, night).catch(() => null), keep = now && now.file ? path.basename(now.file) : null;
    try { fs.readdirSync(CACHE).filter((f) => COPY.test(f) && f !== keep).forEach((f) => fs.rmSync(path.join(CACHE, f), { force: true })); } catch { /* nothing to clear */ }
    return copies();
  }

  // The choices Settings offers. Thumbnails are files already on this Mac.
  const aerialThumb = (id) => { const f = path.join(AERIALS, "thumbnails", `${id}.png`); return exists(f) ? f : null; };
  // what "Your desktop" and "A photo" look like right now, for their tiles
  async function thumbOf(choice) {
    if (!choice) return null;
    if (choice.kind === "aerial") return aerialThumb(choice.id);
    if (choice.kind === "mac") { const m = macWallpapers().find((x) => x.id === choice.id); return m && m.thumb; }
    if (choice.kind === "photo" && choice.file && fs.existsSync(choice.file)) return stillCopy(choice.file);
    return null;
  }
  async function catalog(current) {
    const thumb = aerialThumb;
    return {
      desktopThumb: await desktopPicture().then(thumbOf).catch(() => null),
      photoThumb: current && current.kind === "photo" ? await thumbOf(current) : null,
      aerials: PICKS.map((p) => ({ ...p, thumb: thumb(p.id), local: !!localAerial(p.id), key: `aerial-${p.id}`, ready: exists(copyFile(`aerial-${p.id}`)), busy: jobs.has(`aerial-${p.id}`) })),
      mac: macWallpapers().map((m) => { const key = "mac-" + m.id.replace(/\W+/g, "-"); return { id: m.id, name: m.name, thumb: m.thumb, key, ready: exists(copyFile(key)) || exists(copyFile(key + "-dark")), busy: jobs.has(key) || jobs.has(key + "-dark") }; }),
      copies: copies(),
    };
  }

  // Only files this module chose may be served: the cache, Apple's Aerial thumbnails, the Mac wallpaper thumbnails.
  const allowed = (f) => [CACHE, path.join(AERIALS, "thumbnails"), MAC_DIR].some((d) => f.startsWith(d + path.sep)) && !f.includes("..");

  // Apple's Aerial server (sylvan.apple.com) has a certificate from Apple's own authority, which macOS trusts and
  // Chromium's root store does not (net error -202, measured 11 Nov). For a copy-maker page only, and for that host
  // only, ask macOS whether it trusts the chain; anything else keeps Chromium's answer.
  const isMaker = (wc) => !!wc && makers.has(wc.id);
  async function trustApple(url, cert) {
    let host = ""; try { host = new URL(url).hostname; } catch { return false; }
    if (host !== "sylvan.apple.com" || !cert) return false;
    const files = []; for (let c = cert, i = 0; c && c.data && i < 4; c = c.issuerCert, i++) { const f = path.join(CACHE, `chain-${i}.pem`); fs.writeFileSync(f, c.data); files.push("-c", f); }
    return (await run("/usr/bin/security", ["verify-cert", ...files, "-p", "ssl", "-s", host])) !== null;
  }

  return { resolve, catalog, clear, allowed, isMaker, trustApple, CACHE };
}

// A file for the page, with the byte ranges a <video> asks for.
function serve(file, request) {
  const size = fs.statSync(file).size;
  const type = file.endsWith(".mp4") ? "video/mp4" : file.endsWith(".webm") ? "video/webm" : file.endsWith(".png") ? "image/png" : "image/jpeg";
  const m = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") || "");
  if (!m) return new Response(fs.readFileSync(file), { headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" } });
  const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
  const buf = Buffer.alloc(end - start + 1); const fd = fs.openSync(file, "r"); fs.readSync(fd, buf, 0, buf.length, start); fs.closeSync(fd);
  return new Response(buf, { status: 206, headers: { "Content-Type": type, "Content-Length": String(buf.length), "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" } });
}

module.exports = { make, serve };
