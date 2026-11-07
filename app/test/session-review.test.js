// Tests from the review of the session-logic move (review/app-session.md).
// Each test states the behavior the learner should get. A failing test here is
// a confirmed bug, left unfixed on purpose: the fixes get reviewed separately.
const test = require("node:test");
const assert = require("node:assert");
const { createSession } = require("../lib/session");

// The same hand-turned clock and fake effects as session.test.js.
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
        await drain();
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

// The trust question as Claude Code 2.1.318 prints it, captured from a live run
// in a pseudo-terminal: the highlighted default is "No, exit", Return picks it.
const TRUST_TEXT = "\x1b[2GSecurity\x1b[11Gguide\r\r\n\r\r\n\x1b[2G\x1b[38;2;177;185;249m❯\x1b[4GNo,\x1b[8Gexit\x1b[39m\r\r\n\x1b[4GYes,\x1b[9GI\x1b[11Gtrust\x1b[17Gthis\x1b[22Gfolder\r\r\n";

function make(over = {}) {
  const c = fakeClock();
  const written = [];
  const h = { written, clock: c, drafts: [], startPrompts: [], startResult: { running: true } };
  const io = {
    now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout,
    write: (d) => written.push(d),
    startProcess: async (prompt) => { h.startPrompts.push(prompt); return h.startResult; },
    stopProcess: async () => { h.stopped = true; },
    saveImage: async () => "/tmp/flash/img.png",
    inputLine: () => h.input || "",
    cols: () => 80,
    currentSubject: () => h.subject || null,
    reopenCommand: (s) => `/learn-${s.status === "done" ? "practice" : "resume"} ${s.slug}`,
    hasWaitingQuestion: () => !!h.waiting,
    restoreDraft: (text, images) => h.drafts.push({ text, images }),
    ...over,
  };
  h.ses = createSession(io);
  h.st = h.ses.state;
  return h;
}
const sent = (h) => h.written.filter((d) => d !== "\r" && d !== "\x15");
const returns = (h) => h.written.filter((d) => d === "\r").length;
const A = { slug: "a", status: "active" };
const B = { slug: "b", status: "active" };

// ---------- the trust question ----------

test("review: a reply sent while the trust question is on screen waits instead of answering it", async () => {
  const h = make();
  h.subject = A;
  await h.ses.start("/learn-resume a"); // Resume clicked, no message: the queue is empty
  h.ses.onOutput(TRUST_TEXT);
  assert.equal(h.st.trust, true);
  h.written.length = 0;
  h.ses.say("Can I have a hint?"); // the composer, Hint, and Check me all go through say()
  await h.clock.tick(200);
  assert.equal(returns(h), 0, "a Return on the trust question picks \"No, exit\" and Claude Code quits");
  assert.deepEqual(sent(h), []);
});

test("review: End while the trust question is on screen does not answer it", async () => {
  const h = make();
  h.subject = A;
  await h.ses.start("/learn-resume a");
  h.ses.onOutput(TRUST_TEXT);
  h.written.length = 0;
  assert.equal(h.ses.sessionOpen(), true); // so ACTIONS.end calls send() directly
  h.ses.send("/learn-end");
  await h.clock.tick(200);
  assert.equal(returns(h), 0);
});

// ---------- commands that open no route ----------

test("review: a reply during /learn-review is not preceded by /learn-resume for the subject on screen", async () => {
  const h = make();
  h.subject = A; // ACTIONS.review leaves the Session screen on the default subject
  await h.ses.start("/learn-review");
  h.ses.onOutput("Question 1 of 5 ...");
  h.written.length = 0;
  h.ses.say("A copy constructor makes a deep copy");
  await h.clock.tick(5000);
  assert.ok(!sent(h).includes("/learn-resume a"), `the review was interrupted by: ${JSON.stringify(sent(h))}`);
  assert.ok(sent(h).includes("A copy constructor makes a deep copy"));
});

test("review: a reply during /learn-start of a new subject is not preceded by /learn-resume", async () => {
  const h = make();
  await h.ses.start("");
  h.ses.send("/learn-start linear algebra");
  // The tutor creates linear-algebra; the thread follows its log (app.js F.onSession).
  h.subject = { slug: "linear-algebra", status: "active" };
  h.ses.onOutput("What do you want to be able to do?");
  h.written.length = 0;
  h.ses.say("Pass the midterm");
  await h.clock.tick(5000);
  assert.ok(!sent(h).includes("/learn-resume linear-algebra"), `the start was interrupted by: ${JSON.stringify(sent(h))}`);
});

// ---------- the queue ----------

test("review: a queued message goes to the subject it was written for, not the one on screen", async () => {
  const h = make();
  h.subject = A;
  await h.ses.submit("my answer about a", "/learn-resume a"); // sent while stopped, on a's Session
  h.subject = B; // the learner opens b's Session before the tutor is quiet
  h.ses.onOutput("resuming a ...");
  await h.clock.tick(1600);
  assert.ok(!sent(h).includes("/learn-resume b"), `sent: ${JSON.stringify(sent(h))}`);
});

test("review: messages queued before a vault switch are not sent into the next vault's tutor", async () => {
  const h = make();
  h.subject = A;
  await h.ses.start("");
  h.st.route = null;
  h.ses.say("an answer meant for the old vault"); // queued behind the reopen
  assert.equal(h.st.queue.length, 1);
  h.ses.markStopped(); // chooseVault()
  h.subject = null; // the new vault's Home
  await h.ses.start("");
  h.written.length = 0;
  h.ses.onOutput("Claude Code v2.1.318");
  await h.clock.tick(1600);
  assert.ok(!sent(h).includes("an answer meant for the old vault"));
});

test("review: a flush timer armed before a restart does not type into the new tutor before it prints", async () => {
  const h = make();
  h.subject = A;
  await h.ses.start("");
  h.st.route = null;
  h.ses.say("hi"); // queued; /learn-resume a sent
  h.ses.onOutput("resuming"); // arms the flush for 1.5s of quiet
  await h.clock.tick(300);
  await h.ses.stop(); // ACTIONS.restart: stop, then start ""
  await h.ses.start("");
  h.written.length = 0;
  await h.clock.tick(1500); // the new Claude Code has printed nothing yet
  assert.deepEqual(h.written, [], "typed into a tutor that has not drawn its first screen");
});

test("review: End while a message waits does not jump ahead of it and then reopen", async () => {
  const h = make();
  h.subject = A;
  await h.ses.start("");
  h.ses.send("/learn-end");
  h.ses.say("one more thing"); // queued; /learn-resume a sent, route opens optimistically
  assert.equal(h.ses.sessionOpen(), true);
  h.ses.send("/learn-end"); // ACTIONS.end
  for (let i = 0; i < 4; i++) { h.ses.onOutput("..."); await h.clock.tick(1600); }
  const out = sent(h);
  const msg = out.indexOf("one more thing"), lastEnd = out.lastIndexOf("/learn-end");
  assert.ok(msg !== -1 && msg < lastEnd, `order: ${JSON.stringify(out)}`);
  assert.equal(out.filter((d) => d === "/learn-resume a").length, 1, `order: ${JSON.stringify(out)}`);
});

test("review: a route command typed in the composer while stopped is the start prompt", async () => {
  const h = make();
  h.subject = A;
  await h.ses.submit("/learn-review", "/learn-resume a");
  assert.equal(h.startPrompts[0], "/learn-review", "a resumes first and its session note is left open");
});

test("review: Check me while the tutor is stopped runs inside the subject's session", async () => {
  const h = make();
  h.subject = A;
  await h.ses.say("/learn-check"); // ACTIONS.check with route.slug set, from the menu shortcut
  assert.equal(h.startPrompts[0], "/learn-resume a", `started with ${JSON.stringify(h.startPrompts[0])}`);
});

test("review: Check me while the tutor is starting is not dropped", async () => {
  let release;
  const h = make({ startProcess: () => new Promise((r) => { release = r; }) });
  h.subject = A;
  const p = h.ses.start("/learn-resume a");
  await drain();
  h.ses.say("/learn-check");
  release({ running: true });
  await p;
  h.ses.onOutput("ready");
  await h.clock.tick(1600);
  assert.ok(sent(h).includes("/learn-check") || h.st.queue.length > 0, "the check vanished");
});

// ---------- sending ----------

test("review: two sends in quick succession arrive whole and in order (images)", async () => {
  const h = make();
  h.subject = A;
  await h.ses.start("/learn-resume a");
  h.ses.send({ text: "here is my screen", images: [{ bytes: new Uint8Array(1), type: "image/png" }] });
  h.ses.send("and a second thought");
  await h.clock.tick(3000);
  const out = h.written.filter((d) => d !== "\x15");
  const first = out.indexOf(" here is my screen"), second = out.indexOf("and a second thought");
  assert.ok(first !== -1 && first < second, `typed: ${JSON.stringify(out)}`);
});

test("review: two sends in quick succession after Esc: the second is not wiped by the first's Ctrl+U", async () => {
  const h = make();
  h.subject = A;
  await h.ses.start("/learn-resume a");
  h.ses.send("x".repeat(400) + "\n" + "y".repeat(400));
  h.ses.interrupt();
  h.written.length = 0;
  h.ses.send("stop, I meant the other one");
  h.ses.send("the copy constructor");
  await h.clock.tick(5000);
  const i = h.written.indexOf("the copy constructor");
  const wipedAfter = h.written.slice(i + 1).some((d) => d === "\x15");
  assert.equal(wipedAfter, false, "Ctrl+U presses landed after the second message was typed");
});

test("review: a dropped Return is retried for a message Claude Code shows as a collapsed paste", async () => {
  const h = make();
  h.subject = A;
  await h.ses.start("/learn-resume a");
  h.ses.send("short");
  await h.clock.tick(2000); // short's own Return and retry check are done
  h.ses.interrupt();
  h.written.length = 0;
  const code = ["class A {", "  int x;", "  A(A o) { x = o.x; }", "}", "// output: 3", "// done"].join("\n");
  h.ses.send(code);
  // Claude Code 2.1.318 shows a paste of five or more lines as a placeholder.
  h.input = "[Pasted text #1 +5 lines]";
  await h.clock.tick(2500);
  assert.equal(returns(h), 2, "the message sits unsent in the input box");
});

// ---------- typed-command tracking ----------

test("review: a command pasted into the terminal moves the route", () => {
  const h = make();
  h.st.running = true;
  h.ses.onUserInput("\x1b[200~/learn-resume a\x1b[201~"); // xterm's bracketed paste
  h.ses.onUserInput("\r");
  assert.equal(h.st.route, "a");
});

test("review: Ctrl+U typed in the terminal clears the tracked command, as it clears the input box", () => {
  const h = make();
  h.st.running = true;
  h.ses.onUserInput("hello");
  h.ses.onUserInput("\x15");
  h.ses.onUserInput("/learn-resume a");
  h.ses.onUserInput("\r");
  assert.equal(h.st.route, "a");
});

test("review: a command finished with Tab completion in the terminal moves the route", () => {
  const h = make();
  h.st.running = true;
  // Claude Code 2.1.318, live: "/learn-res" then Tab shows "/learn-resume" in the box.
  h.ses.onUserInput("/learn-res");
  h.ses.onUserInput("\t");
  h.ses.onUserInput(" a");
  h.ses.onUserInput("\r");
  assert.equal(h.st.route, "a");
});

// ---------- stopping ----------

test("review: stopping the tutor clears the trust question", async () => {
  const h = make();
  await h.ses.start("");
  h.ses.onOutput(TRUST_TEXT);
  assert.equal(h.st.trust, true);
  // main.js stopTerminal() nulls term before kill(), so no pty:exit reaches
  // the renderer and onExit() never runs after a host or vault switch.
  await h.ses.stop();
  assert.equal(h.st.trust, false, "the trust card stays in the thread with buttons that do nothing");
});

test("review: declining trust keeps the screenshots of a waiting message", async () => {
  const h = make();
  await h.ses.submit({ text: "what is this error", images: [{ bytes: new Uint8Array(1), type: "image/png" }] }, "");
  h.ses.onOutput(TRUST_TEXT);
  h.ses.answerTrust("no");
  assert.equal(h.drafts.length, 1);
  assert.ok(h.drafts[0].images && h.drafts[0].images.length === 1, "the pasted screenshot is gone");
});
