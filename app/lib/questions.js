// Questions: chats that belong to no subject, asked from Home. Each chat is its own conversation, saved in the app's
// folder, and each message runs one short turn of the learner's tutor (Claude Code `claude -p`, or Codex `codex exec`)
// that resumes that conversation and exits, the way LearnHarness runs its chats. The turn runs in an empty folder:
// Claude Code with no tools, hooks, skills, MCP servers or CLAUDE.md; Codex read-only with no user config. So it cannot
// write a learning record or reach a subject's log, and the subject tutor in the terminal is never touched.
// Tests: test/questions.test.js, against a stand-in tutor.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The chat's name is its first message, cut at a word (LearnHarness names a chat the same way).
function titleOf(text) {
  const t = String(text).replace(/\s+/g, " ").trim();
  if (t.length <= 60) return t;
  const cut = t.slice(0, 60), sp = cut.lastIndexOf(" ");
  return (sp > 30 ? cut.slice(0, sp) : cut).replace(/[,.;:!?-]+$/, "") + "…";
}

// One line of the tutor's JSON output, folded into the turn so far: Claude Code's stream-json, or Codex's --json
// events (thread.started carries the conversation's id; each agent_message arrives whole, with no deltas).
function readLine(turn, line) {
  let d;
  try { d = JSON.parse(line); } catch { return false; }
  if (d.type === "thread.started" && d.thread_id) { turn.threadId = d.thread_id; return false; }
  if (d.type === "item.completed" && d.item && d.item.type === "agent_message" && d.item.text) { turn.text += (turn.text.trim() ? "\n\n" : "") + d.item.text; return true; }
  if (d.type === "turn.failed" || (d.type === "error" && d.message)) { turn.result = { is_error: true, result: (d.error && d.error.message) || d.message || "Codex stopped" }; return false; }
  if (d.type === "turn.completed") { turn.result = turn.result || { is_error: false }; return false; }
  if (d.type === "system" && d.subtype === "init") { turn.started = true; return false; }
  if (d.type === "result") { turn.result = d; return false; }
  if (d.type !== "stream_event" || !d.event) return false;
  const e = d.event;
  if (e.type === "content_block_start" && e.content_block && e.content_block.type === "text" && turn.text.trim()) { turn.text += "\n\n"; return true; }
  if (e.type === "content_block_delta" && e.delta && e.delta.type === "text_delta") { turn.text += e.delta.text; return true; }
  return false;
}

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const TYPE = Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t]));
const FILE = /^[0-9]+-[0-9]+\.(png|jpg|gif|webp)$/;

function questions({ root, command, env, prompt, send, host = () => "claude" }) {
  const chats = path.join(root, "chats"), run = path.join(root, "run"), files = path.join(root, "files");
  // A screenshot you pasted, by chat and file name, for the page to show (main.js serves it as q-file:).
  const imagePath = (id, name) => (ID.test(id || "") && FILE.test(name || "") ? path.join(files, id, name) : null);
  const live = new Map();   // id → { child, text, stopped }
  const file = (id) => path.join(chats, `${id}.json`);
  const read = (id) => { try { return JSON.parse(fs.readFileSync(file(id), "utf8")); } catch { return null; } };
  const save = (c) => { fs.mkdirSync(chats, { recursive: true }); fs.writeFileSync(file(c.id), JSON.stringify(c, null, 2)); };
  const changed = (id) => send("q:changed", { id });

  function list(all) {
    let names = [];
    try { names = fs.readdirSync(chats).filter((n) => n.endsWith(".json")); } catch { return []; }
    return names.map((n) => read(n.slice(0, -5))).filter((c) => c && (all || !c.archived))
      .map((c) => ({ id: c.id, title: c.title, updated: c.updated, running: live.has(c.id), archived: !!c.archived, lesson: c.lesson || null, moved: c.moved || null }))
      .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  }
  function get(id) {
    if (!ID.test(id || "")) return null;
    const c = read(id), t = live.get(id);
    return c ? { ...c, running: !!t, live: t ? t.text : "" } : null;
  }

  function ask(id, text, images = []) {
    text = String(text || "").trim();
    images = (images || []).filter((im) => im && EXT[im.type] && im.bytes).slice(0, 8);
    if (!text && !images.length) return { error: "empty" };
    let c = id ? read(id) : null;
    if (id && !c) return { error: "missing" };
    if (c && live.has(c.id)) return { error: "busy", id: c.id };
    if (c && c.archived && !c.lesson && !c.moved) delete c.archived;   // writing to an archived chat brings it back
    const now = new Date().toISOString();
    // Nothing exists until the first message: sending it makes the chat.
    if (!c) c = { id: crypto.randomUUID(), title: titleOf(text || "A screenshot"), created: now, started: false, messages: [] };
    const names = images.map((im, i) => {
      const name = `${Date.now()}-${i}.${EXT[im.type]}`;
      fs.mkdirSync(path.join(files, c.id), { recursive: true });
      fs.writeFileSync(path.join(files, c.id, name), Buffer.from(im.bytes));
      return name;
    });
    c.messages.push({ role: "you", text, at: now, ...(names.length ? { images: names } : {}) });
    c.updated = now;
    save(c);
    turn(c, text || "(a screenshot)", names.map((n) => path.join(files, c.id, n)));
    changed(c.id);
    return { id: c.id };
  }

  // The chat so far, for a tutor that hasn't seen it: the Settings switch went from Claude Code to Codex, or back.
  const earlier = (c) => c.messages.slice(0, -1).filter((m) => m.text).map((m) => `${m.role === "you" ? "Learner" : "Tutor"}: ${m.text}`).join("\n\n");
  function turn(c, text, images = []) {
    const codex = host() === "codex", resumes = codex ? !!c.codexId : !!c.started, before = resumes ? "" : earlier(c);
    if (before) text = `<earlier_in_this_chat>\n${before}\n</earlier_in_this_chat>\n\n${text}`;
    if (codex) return start(c, codexArgs(c, images), c.codexId ? `<app_instructions>\n${prompt()}\n</app_instructions>\n\n${text}` : text);
    // Claude Code takes the message as its own stream-json, so screenshots travel as images, not as file paths.
    const content = [...images.map((f) => ({ type: "image", source: { type: "base64", media_type: TYPE[f.split(".").pop()], data: fs.readFileSync(f).toString("base64") } })), { type: "text", text }];
    const args = ["-p", "--safe-mode", "--tools", "", "--disable-slash-commands",
      "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      c.started ? "--resume" : "--session-id", c.id, "--append-system-prompt", prompt(),
      // Fresh instructions on every message, so a chat begun before a change (the lesson card, the subject list) still
      // gets it. Claude Code otherwise keeps the first message's instructions for the whole chat (measured 8 Nov).
      "--system-prompt-snapshot", "off"];
    start(c, args, JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n");
  }
  // Codex: `codex exec` in the same empty folder, read-only, with no user config (so no MCP servers); the first turn
  // carries the instructions as developer instructions, and a resumed one repeats them with the message, since Codex
  // keeps a conversation's first instructions (measured 8 Nov, codex-cli 0.166.0).
  function codexArgs(c, images) {
    const common = ["--json", "--skip-git-repo-check", "--ignore-user-config", ...images.flatMap((f) => ["-i", f])];
    return c.codexId ? ["exec", "resume", c.codexId, ...common, "-"]
      : ["exec", ...common, "-s", "read-only", "-C", run, "-c", `developer_instructions=${JSON.stringify(prompt())}`, "-"];
  }
  function start(c, args, stdin) {
    fs.mkdirSync(run, { recursive: true });
    const { file: exe, args: argv, verbatim } = command(args, host());
    const child = spawn(exe, argv, { cwd: run, env: env(), stdio: ["pipe", "pipe", "pipe"], windowsVerbatimArguments: !!verbatim, windowsHide: true });
    const t = { child, text: "", started: c.started, result: null, stopped: false, err: "", threadId: null };
    live.set(c.id, t);
    let buf = "", pending = null;
    const flush = () => { pending = null; send("q:delta", { id: c.id, text: t.text }); };
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (readLine(t, line) && !pending) pending = setTimeout(flush, 40);
      }
    });
    child.stderr.on("data", (d) => { t.err = (t.err + d).slice(-4000); });
    child.on("error", (e) => { t.err += String(e.message || e); });
    child.on("close", (code) => {
      clearTimeout(pending);
      if (buf.trim()) readLine(t, buf);
      live.delete(c.id);
      const saved = read(c.id) || c;
      if (t.started) saved.started = true;
      if (t.threadId) saved.codexId = t.threadId;
      const r = t.result, words = t.text.trim() || (r && !r.is_error && typeof r.result === "string" ? r.result.trim() : "");
      const at = new Date().toISOString();
      if (words) saved.messages.push({ role: "tutor", text: words, at, ...(t.stopped ? { stopped: true } : {}) });
      else if (!t.stopped) {
        const why = (r && r.is_error && String(r.result || r.subtype || "")) || t.err.trim().split("\n").filter(Boolean).slice(-2).join(" ") || `exit ${code}`;
        saved.messages.push({ role: "tutor", error: why.slice(0, 400), at });
      }
      saved.updated = at;
      save(saved);
      changed(c.id);
    });
    child.stdin.end(stdin);
  }

  function stop(id) { const t = live.get(id); if (t) { t.stopped = true; try { t.child.kill("SIGTERM"); } catch { /* gone */ } } return true; }
  function stopAll() { for (const id of live.keys()) stop(id); }
  // Archive (T3 Code's hover button): the chat leaves the sidebar and waits in Search, where opening it or sending
  // to it brings it back. Nothing is deleted.
  function archive(id, on = true) {
    const c = ID.test(id || "") ? read(id) : null;
    if (!c) return false;
    if (on) { stop(id); c.archived = true; } else delete c.archived;
    save(c); changed(id);
    return true;
  }
  // A question that becomes a lesson: its conversation goes to a file the subject tutor reads before it starts, and
  // the chat is archived with a note of what it became. The offer can also be turned down, once per chat.
  function mark(id, patch) {
    const c = ID.test(id || "") ? read(id) : null;
    if (!c) return null;
    let file = null;
    if (patch.lesson) {
      c.lesson = String(patch.lesson).slice(0, 120); c.archived = true;
      fs.mkdirSync(path.join(root, "handoff"), { recursive: true });
      file = path.join(root, "handoff", `${id}.md`);
      fs.writeFileSync(file, `# ${c.title}\n\nA question the learner asked before this became a lesson. What it covered, oldest first:\n\n` +
        c.messages.map((m) => `**${m.role === "you" ? "Learner" : "Tutor"}:** ${m.text || m.error || ""}${m.images ? ` (with ${m.images.length} screenshot${m.images.length > 1 ? "s" : ""})` : ""}`).join("\n\n") + "\n");
    }
    if (patch.offer === "no") c.offer = "no";
    if (patch.moved && /^[a-z0-9][a-z0-9-]*$/.test(patch.moved)) { c.moved = patch.moved; c.archived = true; }
    save(c); changed(id);
    return { file };
  }
  return { list, get, ask, stop, stopAll, archive, mark, imagePath };
}

module.exports = { questions, titleOf, readLine };
