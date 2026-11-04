// The tutor session's states and transitions (docs/app-session.md), including
// the three live-session bugs fixed in 96f024c and 0a26006: the trust question
// holding the first message, Esc leaving interrupted text behind, and a message
// after /learn-end reopening the subject first.
const test = require("node:test");
const assert = require("node:assert");
const { createSession, quote, tutorEnv, tutorArgs, closeArgs } = require("../lib/session");

// A clock the tests turn by hand, so 1.5s waits cost nothing and never flake.
const drain = () => new Promise((r) => setImmediate(r));
function fakeClock() {
  let t = 0;
  const timers = new Set();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = { at: t + ms, fn }; timers.add(id); return id; },
    clearTimeout: (id) => timers.delete(id),
    async tick(ms) {
      const end = t + ms;
      for (;;) {
        await drain(); // let awaited chains run, so the timers they set are seen
        const due = [...timers].filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.delete(due);
        t = due.at;
        due.fn();
      }
      t = end;
      await drain();
    },
  };
}

// The trust question and the banner as Claude Code prints them, with ANSI moves.
const TRUST_TEXT = "\x1b[1mDo you trust the files in this folder?\x1b[0m\r\n\x1b[36m❯ 1. Yes, I trust this folder\x1b[0m\r\n  2. No, exit";
const BANNER_TEXT = "\x1b[38;5;208m Claude Code v2.1.34\x1b[0m";

function make(over = {}) {
  const c = fakeClock();
  const written = [];
  const events = [];
  const h = { written, events, clock: c, drafts: [], startPrompts: [], startResult: { running: true } };
  const io = {
    now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout,
    write: (d) => written.push(d),
    startProcess: async (prompt) => { h.startPrompts.push(prompt); return h.startResult; },
    stopProcess: async () => { h.stopped = true; },
    saveImage: async (_bytes, type) => `/tmp/flash/img.${(type || "").split("/")[1] || "png"}`,
    inputLine: () => h.input || "",
    cols: () => 80,
    currentSubject: () => h.subject || null,
    reopenCommand: (s) => `/learn-${s.status === "done" ? "practice" : "resume"} ${s.slug}`,
    hasWaitingQuestion: () => !!h.waiting,
    restoreDraft: (text) => h.drafts.push(text),
    onEvent: (kind, payload) => events.push([kind, payload]),
    ...over,
  };
  h.ses = createSession(io);
  h.st = h.ses.state;
  return h;
}
const kinds = (h) => h.events.map(([k]) => k);
const sent = (h) => h.written.filter((d) => d !== "\r" && d !== "\x15");
const returns = (h) => h.written.filter((d) => d === "\r").length;

// ---------- lifecycle ----------

test("a start moves idle through starting to running", async () => {
  const h = make();
  const p = h.ses.start("");
  assert.equal(h.st.starting, true);
  await p;
  assert.equal(h.st.starting, false);
  assert.equal(h.st.running, true);
  assert.equal(h.st.ended, null);
  assert.ok(kinds(h).includes("started"));
});

test("a start that fails records the error and stays stopped", async () => {
  const h = make();
  h.startResult = { error: "claude: command not found" };
  const r = await h.ses.start("");
  assert.equal(r.error, "claude: command not found");
  assert.equal(h.st.failed, "claude: command not found");
  assert.equal(h.st.running, false);
  assert.deepEqual(h.events.find(([k]) => k === "start-failed"), ["start-failed", "claude: command not found"]);
});

test("a second start while the first is still starting is ignored", async () => {
  let release;
  const h = make({ startProcess: () => new Promise((r) => { release = () => r({ running: true }); }) });
  const first = h.ses.start("");
  await drain();
  const second = await h.ses.start("");
  assert.equal(second, null);
  release();
  await first;
  assert.equal(h.startPrompts.length, 0); // the overridden startProcess records nothing
  assert.equal(h.st.running, true);
});

test("busy means output in the last 1.2s; workFrom marks where a turn began", async () => {
  const h = make();
  await h.ses.start("");
  await h.clock.tick(5000);
  assert.equal(h.ses.busy(), false);
  h.ses.onOutput("thinking");
  assert.equal(h.ses.busy(), true);
  assert.equal(h.st.workFrom, 5000);
  await h.clock.tick(600);
  h.ses.onOutput("still");
  assert.equal(h.st.workFrom, 5000); // not moved while busy
  await h.clock.tick(1300);
  assert.equal(h.ses.busy(), false);
});

test("an exit clears the route and trust but keeps queued messages", async () => {
  const h = make();
  await h.ses.start("/learn-resume cs124");
  h.st.queue.push("held");
  h.ses.onOutput(TRUST_TEXT);
  h.ses.onExit();
  assert.equal(h.st.running, false);
  assert.ok(h.st.ended instanceof Date);
  assert.equal(h.st.trust, false);
  assert.equal(h.st.route, null);
  assert.deepEqual(h.st.queue, ["held"]);
});

test("stop halts the tutor; markStopped records a stop made elsewhere", async () => {
  const h = make();
  await h.ses.start("");
  await h.ses.stop();
  assert.equal(h.stopped, true);
  assert.equal(h.st.running, false);
  h.st.running = true;
  h.ses.markStopped();
  assert.equal(h.st.running, false);
});

// ---------- sending ----------

test("a send types the text and presses Return", async () => {
  const h = make();
  await h.ses.start("");
  h.ses.send("hello");
  await h.clock.tick(100);
  assert.deepEqual(sent(h), ["hello"]);
  assert.equal(returns(h), 1);
  assert.equal(h.st.lastSent, "hello");
});

test("a multi-line send goes as one bracketed paste so Return does not fire early", async () => {
  const h = make();
  await h.ses.start("");
  h.ses.send("line one\nline two");
  await h.clock.tick(100);
  assert.deepEqual(sent(h), ["\x1b[200~line one\nline two\x1b[201~"]);
});

test("pasted images go first, each as a bracketed file path, then the text", async () => {
  const h = make();
  await h.ses.start("");
  const p = h.ses.send({ text: "what is this?", images: [{ bytes: new Uint8Array([1]), type: "image/png" }] });
  await h.clock.tick(2000);
  await p;
  assert.deepEqual(sent(h), ["\x1b[200~/tmp/flash/img.png\x1b[201~", " what is this?"]);
});

test("an empty message sends nothing", async () => {
  const h = make();
  await h.ses.start("");
  await h.ses.send("");
  await h.ses.send({ text: "", images: [] });
  assert.equal(h.written.length, 0);
});

test("a send while stopped starts the tutor with the text as its prompt", async () => {
  const h = make();
  h.ses.send("/learn-check");
  await drain();
  assert.deepEqual(h.startPrompts, ["/learn-check"]);
  assert.equal(h.st.running, true);
});

test("the composer's send queues the message and starts with the reopen prompt", async () => {
  const h = make();
  h.subject = { slug: "cs124", status: "active" };
  h.ses.submit("first question", "/learn-resume cs124");
  await drain();
  assert.deepEqual(h.startPrompts, ["/learn-resume cs124"]);
  assert.equal(h.st.route, "cs124");
  assert.deepEqual(h.st.queue, ["first question"]);
  // Output arrives, then 1.5s of quiet: the queued message goes in.
  h.ses.onOutput("ready ❯ ");
  await h.clock.tick(1600);
  assert.ok(sent(h).includes("first question"));
});

// ---------- the trust question (fixed in 96f024c) ----------

test("the trust question is spotted through ANSI moves and split chunks", async () => {
  const h = make();
  await h.ses.start("");
  const mid = Math.floor(TRUST_TEXT.length / 2);
  h.ses.onOutput(TRUST_TEXT.slice(0, mid));
  assert.equal(h.st.trust, false);
  h.ses.onOutput(TRUST_TEXT.slice(mid));
  assert.equal(h.st.trust, true);
  assert.equal(h.st.trustSeen, true);
});

test("the first message waits out the trust question instead of answering it", async () => {
  const h = make();
  h.subject = { slug: "cs124", status: "active" };
  h.ses.submit("hi there", "/learn-resume cs124");
  await drain();
  h.ses.onOutput(TRUST_TEXT);
  await h.clock.tick(5000);
  // Nothing typed, no Return: the default answer is "No, exit".
  assert.equal(h.written.length, 0);
  assert.deepEqual(h.st.queue, ["hi there"]);
});

test("trusting the folder picks Yes with Down then Return, and the queue flows after", async () => {
  const h = make();
  h.subject = { slug: "cs124", status: "active" };
  h.ses.submit("hi there", "/learn-resume cs124");
  await drain();
  h.ses.onOutput(TRUST_TEXT);
  h.ses.answerTrust("yes");
  await h.clock.tick(200);
  assert.deepEqual(h.written, ["\x1b[B", "\r"]);
  assert.equal(h.st.trust, false);
  h.ses.onOutput(BANNER_TEXT + " ❯ ");
  await h.clock.tick(1600);
  assert.ok(sent(h).includes("hi there"));
});

test("declining trust drops queued commands but keeps the learner's words as a draft", async () => {
  const h = make();
  await h.ses.start("");
  h.ses.onOutput(TRUST_TEXT);
  h.st.queue.push("/learn-resume cs124", "my actual question");
  h.ses.answerTrust("no");
  assert.deepEqual(h.st.queue, []);
  assert.deepEqual(h.drafts, ["my actual question"]);
  assert.deepEqual(h.written, ["\r"]);
});

test("a trust question answered in the terminal clears when the banner follows", async () => {
  const h = make();
  await h.ses.start("");
  h.ses.onOutput(TRUST_TEXT);
  h.ses.onOutput(BANNER_TEXT);
  assert.equal(h.st.trust, false);
});

// ---------- Esc and the interrupted message (fixed in 96f024c) ----------

test("Esc writes an interrupt and counts the lines Claude Code puts back", async () => {
  const h = make();
  await h.ses.start("");
  h.ses.send("a question about recursion");
  await h.clock.tick(100);
  h.ses.interrupt();
  assert.ok(h.written.includes("\x1b"));
  assert.equal(h.st.interrupted, 2); // one short line: 2 + 0 wraps
});

test("the next send clears the interrupted text with one Ctrl+U per press", async () => {
  const h = make();
  await h.ses.start("");
  h.ses.send("old message");
  await h.clock.tick(100);
  h.ses.interrupt();
  h.written.length = 0;
  const p = h.ses.send("new message");
  await h.clock.tick(1000);
  await p;
  const presses = h.written.filter((d) => d === "\x15");
  assert.equal(presses.length, 6); // 2 counted + 4 for safety
  assert.ok(h.written.indexOf("new message") > h.written.lastIndexOf("\x15"));
  assert.equal(h.st.interrupted, 0);
});

test("the Ctrl+U presses are capped at 60", async () => {
  const h = make();
  await h.ses.start("");
  h.st.lastSent = Array(40).fill("line").join("\n");
  h.ses.interrupt();
  assert.equal(h.st.interrupted, 80);
  const p = h.ses.send("next");
  await h.clock.tick(3000);
  await p;
  assert.equal(h.written.filter((d) => d === "\x15").length, 60);
});

test("a Return dropped after an interrupt is pressed again", async () => {
  const h = make();
  await h.ses.start("");
  h.input = "❯ still sitting here";
  h.ses.send("still sitting here");
  await h.clock.tick(1600);
  assert.equal(returns(h), 2);
});

test("no second Return when the message went through", async () => {
  const h = make();
  await h.ses.start("");
  h.input = "";
  h.ses.send("went through");
  await h.clock.tick(1600);
  assert.equal(returns(h), 1);
});

// ---------- the route (fixed in 96f024c: a message after /learn-end) ----------

test("route commands open the route and /learn-end closes it", async () => {
  const h = make();
  await h.ses.start("");
  h.ses.send("/learn-resume cs124");
  await h.clock.tick(100);
  assert.equal(h.st.route, "cs124");
  assert.equal(h.st.routeEnded, false);
  h.ses.send("/learn-end");
  await h.clock.tick(100);
  assert.equal(h.st.route, null);
  assert.equal(h.st.routeEnded, true);
});

test("sessionOpen is true when stopped, off a subject, or on the open route", async () => {
  const h = make();
  assert.equal(h.ses.sessionOpen(), true); // not running
  await h.ses.start("/learn-resume cs124");
  assert.equal(h.ses.sessionOpen(), true); // no subject on screen
  h.subject = { slug: "cs124", status: "active" };
  assert.equal(h.ses.sessionOpen(), true); // route matches
  h.subject = { slug: "phys", status: "active" };
  assert.equal(h.ses.sessionOpen(), false); // another subject's screen
});

test("a message after /learn-end reopens the subject first, then sends", async () => {
  const h = make();
  h.subject = { slug: "cs124", status: "active" };
  await h.ses.start("/learn-resume cs124");
  h.ses.send("/learn-end");
  await h.clock.tick(100);
  h.written.length = 0;
  h.ses.say("one more question");
  assert.deepEqual(sent(h), ["/learn-resume cs124"]);
  assert.deepEqual(h.st.queue, ["one more question"]);
  assert.equal(h.st.route, "cs124"); // reopened by the resume it just sent
  h.ses.onOutput("resumed ❯ ");
  await h.clock.tick(1600);
  assert.ok(sent(h).includes("one more question"));
});

test("a done subject reopens with practice, not resume", async () => {
  const h = make();
  h.subject = { slug: "cs124", status: "done" };
  await h.ses.start("");
  h.ses.say("quiz me");
  assert.deepEqual(sent(h), ["/learn-practice cs124"]);
});

test("the learner's own /learn-* command never triggers a reopen", async () => {
  const h = make();
  h.subject = { slug: "cs124", status: "active" };
  await h.ses.start("");
  h.ses.say("/learn-review");
  assert.deepEqual(sent(h), ["/learn-review"]);
  assert.deepEqual(h.st.queue, []);
});

test("the queue holds while a question waits on screen", async () => {
  const h = make();
  await h.ses.start("");
  h.st.queue.push("my answer comes by chat");
  h.waiting = true;
  h.ses.onOutput("❯ ");
  await h.clock.tick(1600);
  assert.equal(h.written.length, 0);
  h.waiting = false;
  h.ses.onOutput("❯ ");
  await h.clock.tick(1600);
  assert.ok(sent(h).includes("my answer comes by chat"));
});

test("a command typed straight into the terminal still moves the route", async () => {
  const h = make();
  await h.ses.start("");
  h.ses.onUserInput("/learn-resume phys");
  h.ses.onUserInput("\r");
  assert.equal(h.st.route, "phys");
  h.ses.onUserInput("/learn-endd\x7f\r"); // backspace fixes the typo
  assert.equal(h.st.route, null);
  assert.equal(h.st.routeEnded, true);
});

// ---------- the main process's helpers ----------

test("quote wraps for the login shell and for cmd", () => {
  assert.equal(quote("it's here", false), "'it'\\''s here'");
  assert.equal(quote('say "hi"', true), '"say ""hi"""');
});

test("tutorEnv hands over the learner's environment minus agent markers", () => {
  const out = tutorEnv(
    { HOME: "/Users/e", CLAUDECODE: "1", CLAUDE_CODE_CHILD_SESSION: "1", CLAUDE_EFFORT: "high", T3CODE_X: "1", ELECTRON_RUN_AS_NODE: "1", EDITOR: "vi" },
    { path: "/usr/bin", appName: "Flash" },
  );
  assert.equal(out.HOME, "/Users/e");
  assert.equal(out.EDITOR, "vi");
  assert.equal(out.PATH, "/usr/bin");
  assert.equal(out.TERM, "xterm-256color");
  assert.equal(out.TERM_PROGRAM, "Flash");
  for (const k of ["CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_EFFORT", "T3CODE_X", "ELECTRON_RUN_AS_NODE"]) assert.ok(!(k in out), k);
});

test("tutorArgs runs the host with the prompt as one quoted argument", () => {
  assert.deepEqual(tutorArgs("claude", "/learn-resume cs124", false), ["-ilc", "exec claude '/learn-resume cs124'"]);
  assert.deepEqual(tutorArgs("claude", "", false), ["-ilc", "exec claude"]);
  assert.deepEqual(tutorArgs("claude", "hi", true), ["/d", "/s", "/c", 'claude "hi"']);
});

test("closeArgs runs /learn-close in print mode on Sonnet", () => {
  assert.deepEqual(closeArgs("claude", "cs124", false), ["-ilc", "exec claude -p --model sonnet '/learn-close cs124'"]);
  assert.deepEqual(closeArgs("claude", "", false), ["-ilc", "exec claude -p --model sonnet '/learn-close'"]);
});
