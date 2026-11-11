// Flash: the main process. It owns the window, the tutor's terminal (the
// learner's own `claude` or `codex`, run in their vault), and every read of the
// vault. It writes no learning record: records change only through the tutor.

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, nativeImage, protocol, shell, net, screen, powerMonitor } = require("electron");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const env = require("./lib/env");
const { readLog, stripFrontmatter } = require("./lib/log");
const { questions } = require("./lib/questions");
const wallpaper = require("./lib/wallpaper");

const APP_NAME = "Obsidian Learning";   // a working name (Edison, 5 Nov); the real one is still to come
app.setName(APP_NAME);
// Never hand this to the tutor: it would make any Electron tool it starts run as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;

protocol.registerSchemesAsPrivileged([{ scheme: "vault-file", privileges: { standard: false, supportFetchAPI: true } }, { scheme: "q-file", privileges: { standard: false, supportFetchAPI: true } }, { scheme: "wall-file", privileges: { standard: false, supportFetchAPI: true, stream: true } }]);

// ---------- settings ----------
const CONFIG = path.join(app.getPath("userData"), "config.json");
// The first run under the new name starts from Flash's settings (the vault folder, the theme), so setup does not ask
// again. Flash keeps its own copy and still runs as before.
try { const old = path.join(app.getPath("appData"), "Flash", "config.json"); if (!fs.existsSync(CONFIG) && fs.existsSync(old)) { fs.mkdirSync(path.dirname(CONFIG), { recursive: true }); fs.copyFileSync(old, CONFIG); } } catch {}
const DEFAULTS = { vault: null, host: "claude", theme: "system", sidebar: true, sidebarMode: "full", panel: true, panelWidth: 400 };
let config = { ...DEFAULTS };
try { config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG, "utf8")) }; } catch { /* first run */ }
function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));
}

let win = null;
let quitting = false;   // true once Flash has decided to quit; until then ⌘Q and closing ask the window first
let PATH = process.env.PATH;
let tools = { python: null, tutor: null, problems: [] };
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

// ---------- reading the vault ----------
let lastState = "";
function readState() {
  return new Promise((resolve) => {
    if (!config.vault || !tools.python) return resolve({ error: "no-vault" });
    const script = path.join(config.vault, ".claude", "hooks", "learn-status.py");
    execFile(tools.python, [script, "--json", "--host", config.host, "--vault", config.vault],
      { env: { ...process.env, PATH, PYTHONDONTWRITEBYTECODE: "1", PYTHONUTF8: "1" }, maxBuffer: 32 * 1024 * 1024, timeout: 20000 },   // UTF-8: Windows Python otherwise reads the records in the system code page
      (error, stdout, stderr) => {
        if (error) return resolve({ error: "status-failed", detail: String(stderr || error.message).trim().split("\n").slice(-4).join("\n") });
        lastState = stdout;
        try { resolve(JSON.parse(stdout)); } catch (e) { resolve({ error: "status-failed", detail: e.message }); }
      });
  });
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const logName = () => (config.host === "codex" ? "codex-log.md" : "log.md");
function readSession(slug) {
  if (!config.vault || !SLUG.test(slug || "")) return { slug, conversations: [], note: null };
  const folder = path.join(config.vault, "learn", "subjects", slug);
  // The vault's Codex hooks mirror a conversation to codex-log.md, Claude Code's to log.md (same layout).
  const log = path.join(folder, logName());
  const sessions = path.join(folder, "sessions");
  const notes = fs.existsSync(sessions) ? fs.readdirSync(sessions).filter((f) => f.endsWith(".md")).sort() : [];
  const latest = notes[notes.length - 1];
  return {
    slug,
    conversations: fs.existsSync(log) ? readLog(fs.readFileSync(log, "utf8")) : [],
    note: latest ? { name: latest.replace(/\.md$/, ""), text: stripFrontmatter(fs.readFileSync(path.join(sessions, latest), "utf8")) } : null,
    logMtime: fs.existsSync(log) ? fs.statSync(log).mtimeMs : 0,
  };
}

// ---------- watching ----------
// Any change under learn/ may change what the screens show. A log.md change is
// the tutor streaming, so it goes straight to the log panel; everything else
// re-reads the records, and only a real difference repaints.
let watcher = null, stateTimer = null;
const logTimers = {};
function watchVault() {
  if (watcher) watcher.close();
  watcher = null;
  if (!config.vault) return;
  try {
    watcher = fs.watch(path.join(config.vault, "learn"), { recursive: true }, (event, file) => {
      if (!file) return;
      const parts = file.split(path.sep);
      if (parts[0] === "subjects" && parts[1]) {
        const slug = parts[1];
        const isLog = parts[2] === "log.md" || parts[2] === "codex-log.md";
        if (isLog && parts[2] !== logName()) return;   // the other tool's mirror
        if (isLog || parts[2] === "sessions") {
          const kind = isLog ? "log" : "note";
          clearTimeout(logTimers[slug + kind]);
          logTimers[slug + kind] = setTimeout(() => send("session:changed", { slug, kind }), 120);
          if (isLog) return;
        }
        if (parts[2] === "progress.md") return;  // generated from the records; they are watched already
      }
      if (/^(Home|Dashboard)\.md$/.test(parts[0])) return;
      clearTimeout(stateTimer);
      stateTimer = setTimeout(async () => {
        const before = lastState;
        const state = await readState();
        if (lastState !== before) send("state:changed", state);
      }, 400);
    });
  } catch (e) {
    console.error("watch failed", e);
  }
}

// ---------- the terminal ----------
let pty = null, term = null;
let lastData = 0;   // the tutor's last terminal output: Claude Code animates its spinner for as long as a turn runs
const tutorWriting = () => !!term && Date.now() - lastData < 1200;
const isWin = process.platform === "win32";
function quote(arg) {
  return isWin ? '"' + String(arg).replace(/"/g, '""') + '"' : "'" + String(arg).replace(/'/g, "'\\''") + "'";
}
// The tutor gets the learner's own environment, minus anything that would make
// it think it runs inside another agent session. An inherited
// CLAUDE_CODE_CHILD_SESSION turns transcript saving off, and the live log is
// built from the transcript.
function tutorEnv() {
  const out = { ...process.env, PATH, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: APP_NAME, PYTHONUTF8: "1" };   // the vault's hooks are Python and read UTF-8 records
  for (const name of Object.keys(out)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK|CLAUDE_PID|CLAUDE_EFFORT|T3CODE_|ELECTRON_RUN_AS_NODE)/.test(name)) delete out[name];
  }
  return out;
}
// How to run a tutor command line. Mac and Linux: through the login shell, so the tutor sees the learner's own
// setup. Windows (never run on a Windows PC as of 11 Nov 2026): cmd.exe gets the line verbatim inside one pair of
// quotes, because Node and node-pty would otherwise backslash-escape the quotes around a prompt and split it.
function tutorCommand(cmd) {
  return isWin ? { file: env.loginShell(), args: ["/d", "/s", "/c", `"${cmd}"`], verbatim: true } : { file: env.loginShell(), args: ["-ilc", `exec ${cmd}`], verbatim: false };
}
function startTerminal({ cols, rows, prompt }) {
  if (term) return { running: true };
  if (!pty) pty = require("node-pty");
  const command = [config.host, ...(prompt ? [quote(prompt)] : [])].join(" ");
  const run = tutorCommand(command);
  term = pty.spawn(run.file, run.verbatim ? run.args.join(" ") : run.args, {   // node-pty passes a string to Windows as it is
    name: "xterm-256color",
    cols: Math.max(20, cols | 0), rows: Math.max(5, rows | 0),
    cwd: config.vault,
    env: tutorEnv(),
  });
  const mine = term;
  term.onData((data) => { if (term === mine) { lastData = Date.now(); send("pty:data", data); } });
  term.onExit(({ exitCode }) => { if (term === mine) { term = null; send("pty:exit", exitCode); } });
  return { running: true };
}
function stopTerminal() { if (term) { const t = term; term = null; try { t.kill(); } catch { /* gone */ } } }

// ---------- IPC ----------
// The first name for Home's greeting, until the learner sets one in Settings.
let firstName = "";
function readFirstName() {
  if (process.platform !== "darwin") return;
  execFile("id", ["-F"], { timeout: 2000 }, (error, stdout) => {
    const full = String(stdout || "").trim();
    firstName = !error && full ? full.split(/\s+/)[0] : "";
  });
}
ipcMain.handle("app:info", () => ({ name: APP_NAME, version: app.getVersion(), platform: process.platform, firstName }));
ipcMain.handle("config:get", () => config);
// The wallpaper behind the window (lib/wallpaper.js). Paths reach the page as wall-file: URLs, nothing else.
let WALL = null;
const wallUrl = (f) => (f ? "wall-file:///" + encodeURIComponent(f) : null);
ipcMain.handle("wall:resolve", async (_e, night, force) => { if (!WALL) return { type: "none" }; const r = await WALL.resolve(config.wallpaper, !!night, !!force); return { ...r, url: wallUrl(r.file), file: undefined }; });
// Apple's Aerial server, for the wallpaper's copy-maker only: macOS decides (lib/wallpaper.js trustApple)
app.on("certificate-error", (event, wc, url, _error, cert, callback) => {
  if (!WALL || !WALL.isMaker(wc)) return;
  event.preventDefault();
  WALL.trustApple(url, cert).then((ok) => callback(ok), () => callback(false));
});
ipcMain.handle("wall:catalog", async () => { if (!WALL) return { aerials: [], mac: [] }; const c = await WALL.catalog(config.wallpaper); return { desktopThumb: wallUrl(c.desktopThumb), photoThumb: wallUrl(c.photoThumb), aerials: c.aerials.map((a) => ({ ...a, thumb: wallUrl(a.thumb) })), mac: c.mac.map((m) => ({ ...m, thumb: wallUrl(m.thumb) })) }; });
ipcMain.handle("wall:photo", async () => { const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: "Pictures", extensions: ["jpg", "jpeg", "png", "heic", "webp"] }] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle("wall:battery", () => !!(powerMonitor && powerMonitor.isOnBatteryPower()));
// The Dock icon wears your stone (10 Nov 2026). The window draws it and sends a PNG; only the running Dock icon
// changes, the icon Finder shows stays the one in the app bundle.
ipcMain.on("dock:icon", (_e, url) => { if (app.dock && typeof url === "string" && url.startsWith("data:image/png")) app.dock.setIcon(nativeImage.createFromDataURL(url)); });
ipcMain.handle("config:set", async (_e, patch) => {
  const hostChanged = patch.host && patch.host !== config.host;
  const vaultChanged = "vault" in patch && patch.vault !== config.vault;
  if (vaultChanged && env.checkVault(patch.vault)) delete patch.vault;
  config = { ...config, ...patch };
  saveConfig();
  if (vaultChanged && "vault" in patch) { stopTerminal(); lastState = ""; watchVault(); }
  if (patch.theme) nativeTheme.themeSource = config.theme === "night" ? "dark" : config.theme === "light" ? "light" : "system";
  if (hostChanged) { tools = env.checkTools(PATH, config.host); lastState = ""; }
  return config;
});
ipcMain.handle("setup:check", async () => {
  PATH = await env.shellPath();   // read again: a tool installed since launch may sit in a folder that was not on PATH then
  tools = env.checkTools(PATH, config.host);
  const problems = [...tools.problems];
  if (tools.tutor && !(await signedIn(tools.tutor, config.host))) {
    problems.push(config.host === "codex"
      ? { what: "Codex isn't signed in", fix: "Open Terminal, run codex login, and sign in with your ChatGPT account. Then check again." }
      : { what: "Claude Code isn't signed in", fix: "Open Terminal, run claude, and sign in with your Claude account. Then check again." });
  }
  return { vaultProblem: env.checkVault(config.vault), vault: config.vault, problems, host: config.host, starter: hasStarter(), places: vaultPlaces() };
});
// Whether the tutor has an account to run on: `claude auth status` says loggedIn, `codex login status` exits 0.
// A check that can't run (an older version, a timeout) counts as signed in, so it never blocks a working setup.
function signedIn(tutor, host) {
  return new Promise((resolve) => {
    try {
      execFile(tutor, host === "codex" ? ["login", "status"] : ["auth", "status"], { env: tutorEnv(), timeout: 6000, shell: isWin && /\.(cmd|bat)$/i.test(tutor), windowsHide: true }, (error, stdout, stderr) => {
        if (host === "codex") return resolve(!error || !/not logged in/i.test(`${stdout}\n${stderr}`));   // Codex says so on stderr
        try { resolve(JSON.parse(String(stdout)).loggedIn !== false); } catch { resolve(true); }
      });
    } catch { resolve(true); }   // a check that can't start never blocks setup
  });
}
// A new learner's vault, copied from the starter the app carries (scripts/make-starter-vault.js). Setup offers it only
// when a starter is there; a build carries one only after its review (starter-vault-review.md) has been read.
const STARTER = app.isPackaged ? path.join(process.resourcesPath, "starter-vault") : path.join(__dirname, "starter-vault");
const hasStarter = () => fs.existsSync(path.join(STARTER, ".starter-vault"));
// Setup offers Documents (the default), the Desktop, or a folder you pick (11 Nov, Edison), and says the exact folder
// it will make: "Learning vault" inside the one chosen, numbered when that name is taken, never into a folder that exists.
function vaultPlaces() {
  const at = (k) => { try { return app.getPath(k); } catch { return null; } };
  return { documents: at("documents"), desktop: at("desktop"), home: at("home") };
}
const isFolderArg = (p) => typeof p === "string" && path.isAbsolute(p);
function newVaultDir(parent) {
  let dir = path.join(parent, "Learning vault");
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(parent, `Learning vault ${n}`);
  return dir;
}
ipcMain.handle("vault:target", (_e, parent) => (isFolderArg(parent) ? newVaultDir(parent) : null));
ipcMain.handle("vault:pick-parent", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Where should your learning vault go?", properties: ["openDirectory", "createDirectory"], buttonLabel: "Choose", defaultPath: app.getPath("documents") });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
ipcMain.handle("vault:create", async (_e, parent) => {
  if (!hasStarter()) return { problem: "This copy of the app has no starter vault." };
  if (!isFolderArg(parent)) {
    const result = await dialog.showOpenDialog(win, { title: "Where should your learning vault go?", properties: ["openDirectory", "createDirectory"], buttonLabel: "Make it here", defaultPath: app.getPath("documents") });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    parent = result.filePaths[0];
  }
  let dir;
  try { fs.mkdirSync(parent, { recursive: true }); dir = newVaultDir(parent); fs.cpSync(STARTER, dir, { recursive: true }); fs.rmSync(path.join(dir, ".starter-vault"), { force: true }); }
  catch (e) { return { problem: `Couldn't make the vault there: ${e.message}` }; }
  const problem = env.checkVault(dir);
  if (problem) return { problem, dir };
  stopTerminal();
  config.vault = dir;
  saveConfig();
  lastState = "";
  watchVault();
  return { dir };
});
ipcMain.handle("vault:choose", async () => {
  const result = await dialog.showOpenDialog(win, { title: "Open your learning vault", properties: ["openDirectory"], buttonLabel: "Open vault" });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const dir = result.filePaths[0];
  const problem = env.checkVault(dir);
  if (problem) return { problem, dir };
  stopTerminal();
  config.vault = dir;
  saveConfig();
  lastState = "";
  watchVault();
  return { dir };
});
ipcMain.handle("state:get", () => readState());
// The composer's attach button: the learner picks a file, and its path goes into the message.
ipcMain.handle("file:choose", async () => {
  const result = await dialog.showOpenDialog(win, { title: "Attach a file", properties: ["openFile"], defaultPath: config.vault || undefined });
  return result.canceled ? null : result.filePaths[0] || null;
});
ipcMain.handle("session:get", (_e, slug) => readSession(slug));
ipcMain.handle("pty:start", (_e, opts) => {
  try { return startTerminal(opts || {}); } catch (e) { term = null; console.error("tutor failed to start", e); return { error: String(e.message || e) }; }
});
ipcMain.handle("pty:running", () => !!term);
ipcMain.on("pty:write", (_e, data) => { if (term) term.write(data); });
ipcMain.on("pty:resize", (_e, { cols, rows }) => { if (term && cols > 0 && rows > 0) try { term.resize(cols, rows); } catch { /* exiting */ } });
ipcMain.handle("pty:stop", () => { stopTerminal(); return true; });
// A pasted image goes to the tutor as a file: Flash saves it to a temp folder
// and the renderer pastes the file's path, which Claude Code attaches as an
// image ([Image #N]). Your clipboard is left alone.
let imageCount = 0;
ipcMain.handle("image:save", (_e, bytes, type) => {
  const dir = path.join(app.getPath("temp"), "flash-images");
  fs.mkdirSync(dir, { recursive: true });
  const ext = { "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[type] || "png";
  const file = path.join(dir, `${Date.now()}-${++imageCount}.${ext}`);
  fs.writeFileSync(file, Buffer.from(bytes));
  return file;
});
// Settles session notes left open with /learn-close, in the background and on
// Sonnet: the skill edits a few lines, and the learner may be mid-session in the
// terminal. Its stdin is closed at once, since `claude -p` waits on a piped stdin.
let closing = null;
ipcMain.handle("tutor:close", (_e, slug) => {
  if (closing) return { ok: false, text: "Another close-out is still running. Try again in a minute." };
  if (!config.vault) return { ok: false, text: "No vault is open." };
  // Codex runs the vault's $learn-close skill (.agents/skills/learn-close) with write access to the vault only; a vault
  // made from the starter is not a git repository, which `codex exec` otherwise refuses (measured 9 Nov).
  const cmd = config.host === "codex"
    ? ["codex", "exec", "--skip-git-repo-check", "-s", "workspace-write", "-C", quote(config.vault), quote(`$learn-close${slug ? " " + slug : ""}`)].join(" ")
    : [config.host, "-p", "--model", "sonnet", quote(`/learn-close${slug ? " " + slug : ""}`)].join(" ");
  const run = tutorCommand(cmd);
  closing = new Promise((resolve) => {
    const child = execFile(run.file, run.args, { cwd: config.vault, env: tutorEnv(), timeout: 5 * 60 * 1000, maxBuffer: 4e6, windowsVerbatimArguments: run.verbatim, windowsHide: true }, (error, stdout, stderr) => {
      closing = null;
      resolve({ ok: !error, text: String(stdout || "").trim() || String(stderr || (error && error.message) || "").trim() });
    });
    child.stdin.end();
  });
  return closing;
});
// Questions from Home: their own chats, one short Claude Code turn per message (lib/questions.js).
const QPROMPT = `You are the learner's tutor in Obsidian Learning, answering a question they asked from Home. This chat belongs to no subject, and nothing in it is recorded as learning, so never say you saved progress or updated a record. You have no tools: answer from what you know, and say so plainly when you are not sure of a fact.

Teach the way this learner prefers:
{prefs}

Write math in LaTeX between $ signs. Keep a reply short enough to read in one go, and ask at most one question at a time.

This app can turn a question into a lesson: a subject with a plan, tracked skills and reviews, taught by the subject tutor. When the learner asks for that, or clearly wants to learn the topic properly (they keep going deeper, mention an exam or homework, or ask to practise), end your reply with one line in exactly this form, and the app offers them a button:
<lesson>the topic in a few words</lesson>
If the topic is for a class, start with the course code, like <lesson>MATH 241 polar integrals</lesson>. Offer it at most once unless they ask, and never mention the tag itself.
{subjects}
When they ask for a lesson outright, offer it straight away: one or two sentences saying the lesson tutor will build a plan from where they are, then the tag. Don't teach, give an example, or ask a practice question first; the lesson does that.`;
function questionPrompt() {
  let prefs = "";
  try {
    const text = fs.readFileSync(path.join(config.vault, "learn", "me", "preferences.md"), "utf8");
    const m = text.match(/^## Operational summary\n([\s\S]*?)(?=\n## |$)/m);
    prefs = m ? m[1].trim().split("\n").filter((l) => l.startsWith("- ")).join("\n") : "";
  } catch { /* no vault or no preferences yet */ }
  // The subjects they already have, so a question that fits one can be offered back to it.
  let subjects = "";
  try {
    const open = (JSON.parse(lastState || "{}").subjects || []).filter((x) => x.status !== "done").map((x) => `- ${x.slug}: ${x.title}`);
    if (open.length) subjects = `The learner already has these subjects (slug: title):\n${open.join("\n")}\nIf the question belongs to one of them, answer it briefly as usual, then end your reply with one line in exactly this form, using a slug from the list, and the app offers to continue there: <subject>the-slug</subject>\nUse it instead of <lesson> when a subject fits, and at most once unless they ask.\n`;
  } catch { /* no state read yet */ }
  return QPROMPT.replace("{prefs}", prefs || "- One step at a time, with a concrete example before the rule.").replace("{subjects}", subjects);
}
const Q = questions({
  root: path.join(app.getPath("userData"), "questions"),
  // On Windows a tutor that is a real program (claude.exe) runs directly with its arguments untouched: the question
  // prompt has line breaks, which cmd.exe cannot carry. An npm shim (.cmd) still goes through cmd.exe.
  command: (args, host) => {
    if (isWin && tools.tutor && /\.exe$/i.test(tools.tutor)) return { file: tools.tutor, args, verbatim: false };
    return tutorCommand([host === "codex" ? "codex" : "claude", ...args.map(quote)].join(" "));
  },
  host: () => config.host,
  env: tutorEnv,
  prompt: questionPrompt,
  send,
});
ipcMain.handle("q:list", (_e, all) => Q.list(!!all));
ipcMain.handle("q:get", (_e, id) => Q.get(id));
ipcMain.handle("q:ask", (_e, id, text, images) => {
  try { return Q.ask(id || null, text, images); } catch (e) { return { error: String(e.message || e) }; }
});
ipcMain.handle("q:archive", (_e, id, on) => Q.archive(id, on !== false));
ipcMain.handle("q:mark", (_e, id, patch) => Q.mark(id, patch || {}));
ipcMain.handle("q:stop", (_e, id) => Q.stop(id));
ipcMain.handle("open:external", (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle("open:file", (_e, rel) => {
  if (!config.vault) return;
  const full = path.resolve(config.vault, rel);
  if (full.startsWith(path.resolve(config.vault) + path.sep) && fs.existsSync(full)) shell.showItemInFolder(full);
});

// ---------- menus ----------
// Native menus carry every shortcut; each item sends its command to the window.
function buildMenu() {
  const cmd = (id) => () => send("menu", id);
  const isMac = process.platform === "darwin";
  // On Windows and Linux, Ctrl+letter belongs to the terminal (Ctrl+C stops a
  // command, Ctrl+R searches history), so the app's keys add Shift there.
  const a = (key) => (isMac ? "Cmd+" : "Ctrl+Shift+") + key;
  const template = [
    ...(isMac ? [{ label: APP_NAME, submenu: [
      { role: "about", label: `About ${APP_NAME}` },
      { type: "separator" },
      { label: "Settings…", accelerator: a(","), click: cmd("settings") },
      { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
      { type: "separator" }, { role: "quit" },
    ] }] : []),
    { label: "File", submenu: [
      { label: "Open Vault…", accelerator: a("O"), click: cmd("open-vault") },
      ...(isMac ? [] : [{ label: "Settings…", accelerator: a(","), click: cmd("settings") }]),
      { type: "separator" }, isMac ? { role: "close" } : { role: "quit" },
    ] },
    { label: "Edit", submenu: [
      // Roles, so inputs behave natively; the terminal answers the same copy and
      // paste events with its own selection.
      { role: "undo" }, { role: "redo" }, { type: "separator" },
      { role: "cut" }, { role: "copy", ...(isMac ? {} : { accelerator: "Ctrl+Shift+C" }) },
      { role: "paste", ...(isMac ? {} : { accelerator: "Ctrl+Shift+V" }) }, { role: "selectAll" },
      { type: "separator" }, { label: "Insert Math", accelerator: a("E"), click: cmd("math") },
    ] },
    { label: "Go", submenu: [
      { label: "Home", accelerator: a("1"), click: cmd("go:home") },
      { label: "Session", accelerator: a("2"), click: cmd("go:session") },
      { label: "All Skills", accelerator: a("3"), click: cmd("go:system") },
      { label: "Dashboard", accelerator: a("4"), click: cmd("go:dashboard") },
      { label: "Subject Progress", accelerator: a("5"), click: cmd("go:progress") },
      { label: "Subject Skill Map", accelerator: a("6"), click: cmd("go:map") },
      { type: "separator" },
      { label: "Search and Commands…", accelerator: a("K"), click: cmd("palette") },
    ] },
    { label: "Session", submenu: [
      { label: "Do the Next Step", accelerator: a("Enter"), click: cmd("ink") },
      { label: "Start a Review", accelerator: a("R"), click: cmd("review") },
      { label: "Check Me", accelerator: a("J"), click: cmd("check") },
      { label: "Ask for a Hint", accelerator: a("/"), click: cmd("hint") },
      { label: "Take a Break", accelerator: a("B"), click: cmd("break") },
      { label: "End and Save", accelerator: isMac ? "Shift+Cmd+E" : "Ctrl+Shift+Alt+E", click: cmd("end") },
      { label: "Start a Subject…", accelerator: a("N"), click: cmd("start") },
      { type: "separator" },
      { label: "Restart the Tutor", click: cmd("restart") },
    ] },
    { label: "View", submenu: [
      { label: "Fold Sidebar", accelerator: a("\\"), click: cmd("toggle-side") },
      { label: "Hide Sidebar", accelerator: isMac ? "Shift+Cmd+\\" : "Ctrl+Shift+Alt+\\", click: cmd("hide-side") },
      { label: "Toggle Plan", accelerator: isMac ? "Alt+Cmd+0" : "Ctrl+Shift+Alt+0", click: cmd("toggle-panel") },
      { label: "Show Terminal", accelerator: "Ctrl+`", click: cmd("toggle-term") },
      { label: "Show Session Note", accelerator: isMac ? "Alt+Cmd+2" : "Ctrl+Shift+Alt+2", click: cmd("tab:note") },
      { type: "separator" },
      { label: "Zoom In", accelerator: a("="), click: cmd("zoom-in") },
      { label: "Zoom Out", accelerator: a("-"), click: cmd("zoom-out") },
      { label: "Fit Map", accelerator: a("0"), click: cmd("zoom-fit") },
      { type: "separator" },
      { role: "togglefullscreen" },
      ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }, { role: "reload" }]),
    ] },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- window ----------
// The window comes back at the size and place you left it, on the same display
// (spec, opening and quitting rule 2). A place on a display that's gone is dropped.
const PLACE = path.join(app.getPath("userData"), "window-place.json");
function loadPlace() {
  try {
    const p = JSON.parse(fs.readFileSync(PLACE, "utf8"));
    const on = screen.getAllDisplays().some(({ workArea: a }) => p.x < a.x + a.width - 40 && p.x + p.width > a.x + 40 && p.y < a.y + a.height - 40 && p.y + p.height > a.y);
    return on && p.width >= 980 && p.height >= 600 ? p : null;
  } catch { return null; }
}
function savePlace() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  try { fs.mkdirSync(path.dirname(PLACE), { recursive: true }); fs.writeFileSync(PLACE, JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch { /* best effort */ }
}
let placeTimer = null;
const savePlaceSoon = () => { clearTimeout(placeTimer); placeTimer = setTimeout(savePlace, 400); };
// macOS 26 glass (10 Nov, Edison: the window "doesn't feel like glass at all"; with the old vibrancy no wallpaper colour
// came through on macOS 26, measured by dragging the window over his wallpaper). NSGlassEffectView sits behind the page
// through electron-liquid-glass; older macOS keeps the vibrancy.
const LIQUID = (() => { if (process.platform !== "darwin") return null; try { const lg = require("electron-liquid-glass"); return lg.isGlassSupported() ? lg : null; } catch { return null; } })();
function createWindow() {
  const night = nativeTheme.shouldUseDarkColors;
  const place = loadPlace();
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 980, minHeight: 600,
    ...(place ? { x: place.x, y: place.y, width: place.width, height: place.height } : {}),
    title: APP_NAME,
    // macOS: the window is glass over the real desktop (vibrancy). The page draws only tints on top, so the wallpaper's
    // colours come through the sidebar and the panel the way the prototype drew them.
    ...(process.platform === "darwin" ? (LIQUID ? { transparent: true, backgroundColor: "#00000000" } : { vibrancy: "under-window", visualEffectState: "active", backgroundColor: "#00000000" }) : { backgroundColor: night ? "#1E1F22" : "#F4F6F8" }),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 14, y: 17 },   // 4 px lower than it was (13), on one line with the title-strip button and clear of the window's top edge (Edison, 5 Nov)
    ...(process.platform === "darwin" ? {} : { titleBarOverlay: { color: process.platform === "win32" ? "#00000000" : night ? "#1E1F22" : "#F4F6F8", symbolColor: night ? "#AEB2B9" : "#4B525C", height: 38 } }   /* Windows: clear, so the window buttons sit on the glass (untested on a PC) */),
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  if (LIQUID) {
    win.setWindowButtonVisibility(true);
    const glassWin = win;
    glassWin.webContents.once("did-finish-load", () => { try { LIQUID.addView(glassWin.getNativeWindowHandle(), { cornerRadius: 16 }); } catch (e) { console.error("glass", e); } });
  }
  // On a big display (2200+ points wide, Edison's 27" at 2560) the whole page draws 8% larger (6 Nov, "the text is kind
  // of small"): that screen has about 9% fewer points per inch than the MacBook's (109 vs 120, inferred from its size)
  // and sits further away. One factor keeps every size in proportion. The traffic lights don't zoom, so the page moves
  // what lines up with them by the same factor (--z, styles.css). OL_ZOOM pins it for tests.
  const zoomed = win;
  const fitZoom = () => {
    if (zoomed.isDestroyed() || process.platform !== "darwin") return;
    const z = +process.env.OL_ZOOM || (screen.getDisplayMatching(zoomed.getBounds()).workAreaSize.width >= 2200 ? 1.08 : 1);
    if (Math.abs(zoomed.webContents.getZoomFactor() - z) > 0.001) zoomed.webContents.setZoomFactor(z);
    zoomed.webContents.send("zoom", z);
  };
  win.webContents.on("did-finish-load", fitZoom);
  const placed = win;
  const sendPlace = () => {
    if (placed.isDestroyed()) return;
    const b = placed.getContentBounds(), d = screen.getDisplayMatching(b).bounds;
    placed.webContents.send("wall:place", { x: b.x - d.x, y: b.y - d.y, dw: d.width, dh: d.height });
  };
  win.webContents.on("did-finish-load", sendPlace);
  win.on("move", sendPlace); win.on("resize", sendPlace); win.on("moved", sendPlace);
  screen.on("display-metrics-changed", sendPlace);
  win.on("closed", () => screen.removeListener("display-metrics-changed", sendPlace));
  win.on("moved", fitZoom);
  screen.on("display-metrics-changed", fitZoom);
  win.on("closed", () => screen.removeListener("display-metrics-changed", fitZoom));
  // the renderer's frame log (perfWatch in app.js) goes to perf.log beside config.json
  win.webContents.on("console-message", (e, level, message) => { const m = String((e && e.message) || message || ""); if (m.startsWith("[perf]")) fs.appendFile(path.join(app.getPath("userData"), "perf.log"), `${new Date().toISOString()} ${m.slice(7)}\n`, () => {}); });
  // The window shows once Home is fully drawn (data, fonts, math), so its first
  // frame is final and "Reading your records…" never flashes. The renderer says
  // when (window:ready); if it never does, the window shows anyway.
  const shown = win;
  let revealed = false;   // once: a window you have since closed never comes back by itself
  // The renderer is told directly: the "show" event isn't a reliable signal for the first show.
  const reveal = () => { if (revealed || shown.isDestroyed()) return; revealed = true; if (place && place.maximized) shown.maximize(); shown.show(); send("window:shown"); };
  ipcMain.removeAllListeners("window:ready");
  ipcMain.once("window:ready", reveal);
  setTimeout(reveal, 5000);
  win.on("resize", savePlaceSoon);
  win.on("move", savePlaceSoon);
  // Closing the window keeps Flash and the tutor running, like Messages; the Dock
  // brings it back where you were. Off the Mac there is no Dock, so closing quits.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    savePlace();
    if (process.platform !== "darwin") return requestQuit();
    if (win.isFullScreen()) { win.once("leave-full-screen", () => win.hide()); win.setFullScreen(false); } else win.hide();
  });
  if (!app.isPackaged || process.env.FLASH_SHOTS) win.webContents.on("console-message", (e) => { if (e.level !== "info" && e.level !== "debug") console.log(`[window ${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`); });
  if (process.env.FLASH_SHOTS) win.webContents.once("did-finish-load", () => shots(process.env.FLASH_SHOTS));
  win.on("focus", () => send("window:focus"));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:")) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.on("closed", () => { win = null; stopTerminal(); });
}

// ---------- quitting ----------
// ⌘Q asks the window first: while the tutor writes it shows the quit card, and
// otherwise it quits at once. A window that doesn't answer in 2.5s is quit anyway.
let quitTimer = null;
function requestQuit() {
  if (!win || win.isDestroyed() || !term) return setImmediate(quitNow);   // a nested app.quit() is ignored, so a tick later
  send("quit:request");
  clearTimeout(quitTimer);
  quitTimer = setTimeout(quitNow, 2500);
}
function quitNow() {
  clearTimeout(quitTimer);
  quitting = true;
  savePlace();
  app.quit();
}
ipcMain.on("quit:ack", () => clearTimeout(quitTimer));   // the window is asking; the learner decides
ipcMain.on("quit:now", () => quitNow());
// While a quit waits for the reply with the window hidden, the window's timers run
// at full speed: hidden pages are throttled, which would delay the quit by up to a minute.
ipcMain.on("quit:waiting", (_e, on) => { if (win && !win.isDestroyed()) win.webContents.setBackgroundThrottling(!on); });
ipcMain.on("window:show", () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } });
ipcMain.on("window:hide", () => { if (win && !win.isDestroyed()) win.hide(); });
// Home's "seen" record: what Home last showed you, line by line, in Flash's own
// data folder and never the vault, so motion can mark only what changed.
const SEEN = path.join(app.getPath("userData"), "home-seen.json");
ipcMain.handle("seen:get", () => { try { return JSON.parse(fs.readFileSync(SEEN, "utf8")); } catch { return {}; } });
ipcMain.handle("seen:set", (_e, lines) => { try { fs.mkdirSync(path.dirname(SEEN), { recursive: true }); fs.writeFileSync(SEEN, JSON.stringify(lines)); } catch { /* best effort */ } return true; });

// Development only: FLASH_SHOTS=<dir> FLASH_STEPS='<js>;;<js>' npm start runs
// each step in the window and saves a screenshot after it, then quits.
async function shots(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  fs.mkdirSync(dir, { recursive: true });
  const steps = (process.env.FLASH_STEPS || "0").split(";;");
  await wait(Number(process.env.FLASH_WAIT || 2500));
  for (let i = 0; i < steps.length; i++) {
    try { await win.webContents.executeJavaScript(steps[i]); } catch (e) { console.error("step", i, e.message); }
    await wait(Number(process.env.FLASH_STEP_WAIT || 1500));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${String(i).padStart(2, "0")}.png`), image.toPNG());
  }
  app.quit();
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
// The Dock brings the window back exactly as it was: same screen, same scroll.
let windowMade = false;
app.on("activate", () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } else if (windowMade) createWindow(); });

app.whenReady().then(async () => {
  nativeTheme.themeSource = config.theme === "night" ? "dark" : config.theme === "light" ? "light" : "system";
  // Images the log embeds: screenshots the learner pasted, from the vault's
  // attachments folder, and the tutor's SVG figures, found by file name in any
  // subject's figures folder the way Obsidian finds them. Nothing else.
  protocol.handle("vault-file", (request) => {
    const name = path.basename(decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, "")));
    const vault = config.vault || "/nonexistent";
    let full = null;
    if (/\.svg$/i.test(name)) {
      const subjects = path.join(vault, "learn", "subjects");
      const dirs = fs.existsSync(subjects) ? fs.readdirSync(subjects) : [];
      full = dirs.map((d) => path.join(subjects, d, "figures", name)).find((f) => fs.existsSync(f)) || null;
    } else if (/\.(png|jpe?g|gif|webp)$/i.test(name)) {
      full = path.join(vault, "Claude outputs", "attachments", name);
    }
    if (!full || !fs.existsSync(full)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(full).toString());
  });
  // A screenshot pasted into a question: q-file:///<chat id>/<file name>, from the app's own questions folder only.
  protocol.handle("q-file", (request) => {
    const [id, name] = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "").split("/");
    const full = Q.imagePath(id, name);
    if (!full || !fs.existsSync(full)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(full).toString());
  });
  // The wallpaper's copies and thumbnails: wall-file:///<path>, only from the folders lib/wallpaper.js allows.
  if (process.platform === "darwin") {
    WALL = wallpaper.make({ BrowserWindow, userData: app.getPath("userData"), onStatus: (st) => { if (process.env.WALL_DEBUG) console.log("[wall]", JSON.stringify(st)); send("wall:status", st); } });
    protocol.handle("wall-file", (request) => {
      const full = path.normalize(decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, "")));
      if (!WALL.allowed(full) || !fs.existsSync(full)) return new Response("not found", { status: 404 });
      return wallpaper.serve(full, request);
    });
  }
  // every system: the stone glass also holds still on battery. A system that can't report power just keeps it moving.
  try { powerMonitor.on("on-battery", () => send("wall:power", true)); powerMonitor.on("on-ac", () => send("wall:power", false)); } catch { /* no power events here */ }
  readFirstName();
  PATH = await env.shellPath();
  tools = env.checkTools(PATH, config.host);
  buildMenu();
  watchVault();
  windowMade = true;
  createWindow();
  // Logging out, restarting, or shutting down: never stand in the way.
  if (powerMonitor) powerMonitor.on("shutdown", () => { quitting = true; });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") quitNow(); });
// ⌘Q, the Dock's Quit, or logging out. Flash asks only while the tutor is writing;
// otherwise it lets the quit through untouched, so a Mac logout or restart is never
// cancelled. (Holding a quit back cancels the logout that asked for it.)
app.on("before-quit", (e) => {
  if (!quitting && tutorWriting() && win && !win.isDestroyed()) { e.preventDefault(); requestQuit(); return; }
  quitting = true;
  savePlace();
  stopTerminal();
  Q.stopAll();
  if (watcher) watcher.close();
});
