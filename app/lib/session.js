// The tutor session's logic, with no DOM, Electron, or node-pty: what state a
// session is in and what each event does to it. The renderer paints from this
// state and hands in the effects (writing to the pty, saving an image, reading
// the input line); the main process builds its terminal command and
// environment with the helpers at the bottom. States and transitions:
// docs/app-session.md. Loads as a plain browser script (window.Session) and as
// a Node module for the tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Session = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Claude Code asks once per folder whether to trust it, and its default answer
  // is "No, exit". Its text arrives split by cursor moves, so it is matched
  // without spaces.
  const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78]/g;
  const TRUST_ASK = /Yes,Itrustthisfolder/;
  const BANNER = /ClaudeCodev\d/;
  // The vault's hook files a message under a subject only after /learn-start,
  // /learn-resume, or /learn-practice names it, and stops after /learn-end's
  // turn. The app follows the same rule so a message never lands outside the
  // thread.
  const ROUTE_CMD = /^\s*[/$]learn-(start|resume|practice)\s+([A-Za-z0-9][A-Za-z0-9_.-]*)/;
  const END_CMD = /^\s*[/$]learn-end(?:\s|$)/;
  const OWN_ROUTE = /^\s*[/$]learn-(start|resume|practice|review|end)\b/;
  const LEARN_CMD = /^\s*[/$]learn-/;

  // A message is its text, or { text, images } when screenshots were pasted.
  const msgText = (m) => (typeof m === "string" ? m : (m && m.text) || "");
  const msgImages = (m) => (m && typeof m === "object" && m.images) || [];

  // createSession(io) — the running tutor. io provides the effects:
  //   write(data)             type into the pty
  //   startProcess(prompt)    async; start the tutor, resolve {error?} or ok
  //   stopProcess()           async; kill the tutor
  //   prepare()               async, optional; ready the terminal before a start
  //   saveImage(bytes, type)  async; save a pasted image, resolve its path
  //   inputLine()             the text in Claude Code's input box
  //   cols()                  the terminal's width
  //   currentSubject()        the subject on screen, {slug, status} or null
  //   reopenCommand(subject)  the typed command that reopens its session
  //   hasWaitingQuestion()    a question the tutor is waiting on is on screen
  //   restoreDraft(text)      put dropped queue text back in the composer
  //   onEvent(kind, payload)  paint: "term" (lifecycle or trust changed),
  //                           "route", "queued", "flushed", "stick", "sent",
  //                           "started", "start-failed"
  //   state                   optional object to hold the fields (the renderer
  //                           passes its own T so paints read it directly)
  //   now, setTimeout, clearTimeout   injectable clocks for the tests
  function createSession(io) {
    const now = io.now || Date.now;
    const later = io.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const cancel = io.clearTimeout || ((id) => clearTimeout(id));
    const sleep = (ms) => new Promise((r) => later(r, ms));
    const emit = (kind, payload) => { if (io.onEvent) io.onEvent(kind, payload); };
    const st = io.state || {};
    Object.assign(st, {
      running: false, starting: false, startedAt: 0, ended: null, failed: null, lastData: 0,
      queue: [], raw: "", trust: false, trustSeen: false, route: null, routeEnded: false,
      lastSent: "", interrupted: 0, typed: "", workFrom: 0,
    });
    let queueTimer = null;

    const busy = () => st.running && now() - st.lastData < 1200;

    function noteRoute(text) {
      const m = String(text).match(ROUTE_CMD);
      if (m) { st.route = m[2].replace(/\.$/, "").replace(/\./g, "-"); st.routeEnded = false; }
      else if (END_CMD.test(text)) { st.route = null; st.routeEnded = true; }
      else return;
      emit("route");
    }

    // Output from the pty. Returns whether the tutor was already busy, so the
    // renderer can repaint its status line only on the change.
    function onOutput(d) {
      const was = busy();
      st.lastData = now();
      if (!was) st.workFrom = st.lastData;
      if (!st.trustSeen) {
        st.raw = (st.raw + d).slice(-8000);
        if (TRUST_ASK.test(st.raw.replace(ANSI, "").replace(/\s+/g, ""))) { st.trust = st.trustSeen = true; emit("term"); }
      }
      // Answered in the terminal instead: Claude Code's banner follows a yes.
      else if (st.trust && BANNER.test(d.replace(ANSI, "").replace(/\s+/g, ""))) { st.trust = false; emit("term"); }
      if (st.queue.length) { cancel(queueTimer); queueTimer = later(flushQueue, 1500); }
      return was;
    }

    function onExit() {
      st.running = false;
      st.ended = new Date(now());
      st.trust = false; st.route = null; st.routeEnded = false;
      emit("term");
    }

    // Keystrokes the learner types straight into the terminal: a command typed
    // there still moves the route. Escape sequences (arrows, function keys) are
    // skipped whole, and a bare Esc resets the tracked text, since it clears
    // Claude Code's input box too.
    function onUserInput(d) {
      const s = String(d);
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "\x1b") {
          if (s[i + 1] === "[" || s[i + 1] === "O") { i += 2; while (i < s.length && !(s[i] >= "@" && s[i] <= "~")) i++; }
          st.typed = "";
        }
        else if (ch === "\r") { noteRoute(st.typed); st.typed = ""; }
        else if (ch === "\x7f") st.typed = st.typed.slice(0, -1);
        else if (ch >= " ") st.typed += ch;
      }
    }

    async function start(prompt) {
      // A start while the tutor runs would not start a second process (the
      // main process keeps the one it has), but it would wipe the terminal and
      // forget the open route and an unanswered trust question. Do nothing.
      if (st.starting || st.running) return null;
      st.starting = true;
      emit("term");
      if (io.prepare) await io.prepare();
      st.raw = ""; st.trust = st.trustSeen = false; st.interrupted = 0; st.typed = ""; st.route = null; st.routeEnded = false;
      noteRoute(prompt || "");
      const result = await io.startProcess(prompt || "");
      st.starting = false;
      if (result && result.error) {
        st.failed = result.error;
        emit("term");
        emit("start-failed", result.error);
        return { error: result.error };
      }
      st.running = true; st.startedAt = now(); st.ended = null; st.failed = null;
      emit("term");
      emit("started");
      return { ok: true };
    }

    async function stop() {
      await io.stopProcess();
      st.running = false;
    }
    // The main process already stopped the tutor (a vault switch does).
    function markStopped() { st.running = false; }

    // Type into the running tutor as the learner would: the text, then Return.
    // Several lines go in as one bracketed paste, so the first line break does
    // not send. After Esc, Claude Code puts the interrupted message back in its
    // input box, where the app can't see it. Ctrl+U deletes one screen line or
    // line break per press, and an extra press on an empty box does nothing, so
    // the app presses it generously. Each press goes alone: sent in one burst
    // with the text, Claude Code reads the whole burst as a paste and Return no
    // longer sends. Pasted images go first, each as a temp file path, which
    // Claude Code attaches as an image ([Image #N]).
    async function send(message) {
      const text = msgText(message), images = msgImages(message);
      if (!text && !images.length) return;
      if (!st.running) return start(text);
      // Return on the trust question picks "No, exit" and Claude Code quits,
      // so nothing is typed while it is on screen. The message waits instead.
      if (st.trust) return hold(message);
      if (st.interrupted) {
        const presses = Math.min(60, st.interrupted + 4);
        st.interrupted = 0;
        for (let i = 0; i < presses; i++) { io.write("\x15"); await sleep(30); }
      }
      for (const image of images) {
        const file = await io.saveImage(image.bytes, image.type);
        io.write(`\x1b[200~${file}\x1b[201~`);
        await sleep(300);
      }
      const body = images.length && text ? ` ${text}` : text;
      if (body) io.write(body.includes("\n") ? `\x1b[200~${body}\x1b[201~` : body);
      later(() => io.write("\r"), 90);
      // Right after an interrupt, Claude Code can drop that Return. If the
      // message still sits in its input box 1.5s later, press Return once more.
      const probe = text.split("\n")[0].trim().slice(0, 24);
      later(() => { if (st.running && probe && io.inputLine().includes(probe)) io.write("\r"); }, 1500);
      st.lastSent = text;
      noteRoute(text);
      emit("sent");
    }

    function hold(message) {
      st.queue.push(message);
      emit("queued");
    }

    // What the learner says on a subject's Session goes to that subject. When
    // no session is open for it (never resumed, or saved with /learn-end), the
    // app reopens it first and sends the message once the tutor is quiet. A
    // message sent while others still wait joins the back of the queue, so
    // nothing arrives out of order.
    function say(message) {
      const s = io.currentSubject(), text = msgText(message);
      if (st.running && st.trust) return hold(message);
      const reopen = s && st.running && st.route !== s.slug && !OWN_ROUTE.test(text);
      if (reopen || (st.queue.length && !OWN_ROUTE.test(text))) {
        st.queue.push(message);
        emit("queued");
        if (reopen) return send(io.reopenCommand(s));
        return;
      }
      return send(message);
    }

    // The composer's send: a stopped tutor starts first, with the reopen
    // command as its CLI prompt, and the message joins the queue behind any
    // still waiting from before the tutor stopped.
    function submit(message, startPrompt) {
      if (!st.running) {
        st.queue.push(message);
        emit("stick");
        return start(startPrompt || "");
      }
      return say(message);
    }

    // Queued messages wait for a quiet terminal, and never go into a question
    // the tutor is waiting on or into Claude Code's trust question. One goes
    // per quiet spell, in order; with the route still closed, the reopen goes
    // instead and the queue holds.
    function flushQueue() {
      if (!st.running || !st.queue.length) return;
      if (st.trust || (io.hasWaitingQuestion && io.hasWaitingQuestion())) return;
      const s = io.currentSubject(), text = msgText(st.queue[0]);
      if (s && st.route !== s.slug && !OWN_ROUTE.test(text)) return send(io.reopenCommand(s));
      send(st.queue.shift());
      emit("flushed");
    }

    const sessionOpen = () => !st.running || !io.currentSubject() || st.route === io.currentSubject().slug;

    function interrupt() {
      if (!st.running) return;
      io.write("\x1b");
      const cols = Math.max(20, ((io.cols && io.cols()) || 80) - 6);
      st.interrupted = st.lastSent.split("\n").reduce((n, line) => n + 2 + Math.floor(line.length / cols), 0);
    }

    // Claude Code's trust question, answered from the thread: down selects
    // "Yes". A no drops queued commands, keeps the learner's own words.
    function answerTrust(answer) {
      if (!st.running || !st.trust) return;
      st.trust = false;
      if (answer === "yes") { io.write("\x1b[B"); later(() => io.write("\r"), 120); }
      else {
        const kept = st.queue.map(msgText).filter((q) => q && !LEARN_CMD.test(q)).join("\n\n");
        st.queue = [];
        if (kept) io.restoreDraft(kept);
        io.write("\r");
      }
      emit("term");
    }

    return { state: st, busy, noteRoute, onOutput, onExit, onUserInput, start, stop, markStopped, send, say, submit, flushQueue, sessionOpen, interrupt, answerTrust };
  }

  // createCloseout(io) — the close-out flow: unarmed → armed (4s) → queued →
  // closing → done, one subject at a time. io provides:
  //   closeOut(slug)          async; run /learn-close, resolve {ok, text}
  //   subject(slug)           the subject, {slug, status} or null
  //   onEvent(kind, payload)  paint: "changed", "queued-behind" (another runs),
  //                           "finished" ({slug, result})
  //   setTimeout, clearTimeout   injectable clocks for the tests
  function createCloseout(io) {
    const later = io.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const cancel = io.clearTimeout || ((id) => clearTimeout(id));
    const emit = (kind, payload) => { if (io.onEvent) io.onEvent(kind, payload); };
    const st = { closing: null, armed: null, queue: [] };
    let armTimer = null;

    const pending = (slug) => st.closing === slug || st.queue.includes(slug);
    const canClose = (s) => !!s && (s.status !== "done" || pending(s.slug));

    // The first click arms the button and a second within 4s runs it, since it
    // changes the record. Close-outs run one at a time (each is a background
    // tutor run of about a minute), so a click while another runs waits in line.
    function request(slug) {
      const s = io.subject(slug);
      if (!s || pending(slug) || s.status === "done") return;
      if (st.armed !== slug) {
        st.armed = slug; cancel(armTimer);
        armTimer = later(() => { st.armed = null; emit("changed"); }, 4000);
        return emit("changed");
      }
      st.armed = null; cancel(armTimer);
      st.queue.push(slug);
      if (st.closing) emit("queued-behind", slug);
      else next();
    }

    async function next() {
      st.closing = st.queue.shift() || null;
      emit("changed");
      if (!st.closing) return;
      const slug = st.closing;
      const result = await io.closeOut(slug);
      st.closing = null;
      emit("finished", { slug, result });
      next();
    }

    return { state: st, request, pending, canClose };
  }

  // ---------- the main process's terminal helpers ----------
  // Quote one shell argument, for the login shell on macOS and Linux or cmd on
  // Windows.
  function quote(arg, isWin) {
    return isWin ? '"' + String(arg).replace(/"/g, '""') + '"' : "'" + String(arg).replace(/'/g, "'\\''") + "'";
  }

  // The tutor gets the learner's own environment, minus anything that would
  // make it think it runs inside another agent session. An inherited
  // CLAUDE_CODE_CHILD_SESSION turns transcript saving off, and the live log is
  // built from the transcript.
  const AGENT_VARS = /^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK|CLAUDE_PID|CLAUDE_EFFORT|T3CODE_|ELECTRON_RUN_AS_NODE)/;
  function tutorEnv(base, { path, appName } = {}) {
    const out = { ...base, TERM: "xterm-256color", COLORTERM: "truecolor" };
    if (path) out.PATH = path;
    if (appName) out.TERM_PROGRAM = appName;
    for (const name of Object.keys(out)) {
      if (AGENT_VARS.test(name)) delete out[name];
    }
    return out;
  }

  // The shell arguments that run the tutor (its prompt rides as a quoted
  // argument), and the ones that run /learn-close in the background on Sonnet.
  function tutorArgs(host, prompt, isWin) {
    const command = [host, ...(prompt ? [quote(prompt, isWin)] : [])].join(" ");
    return isWin ? ["/d", "/s", "/c", command] : ["-ilc", `exec ${command}`];
  }
  function closeArgs(host, slug, isWin) {
    const command = [host, "-p", "--model", "sonnet", quote(`/learn-close${slug ? " " + slug : ""}`, isWin)].join(" ");
    return isWin ? ["/d", "/s", "/c", command] : ["-ilc", `exec ${command}`];
  }

  return { createSession, createCloseout, msgText, msgImages, quote, tutorEnv, tutorArgs, closeArgs };
});
