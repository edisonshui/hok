// The Questions engine (lib/questions.js) against a stand-in tutor (fixtures/fake-tutor.js): what each tool is sent,
// what is saved, and the chat's life (archive, a lesson, a move). No real tutor runs.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { questions, titleOf, readLine } = require("../lib/questions");

const FAKE = path.join(__dirname, "fixtures", "fake-tutor.js");
function setup(host = "claude") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ol-q-")), log = path.join(root, "calls.jsonl"), sent = [];
  const h = { host };
  const Q = questions({
    root, host: () => h.host, prompt: () => "BE BRIEF",
    command: (args) => ({ file: process.execPath, args: [FAKE, ...args] }),
    env: () => ({ ...process.env, FAKE_LOG: log }),
    send: (channel, payload) => sent.push([channel, payload]),
  });
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  const done = (id) => new Promise((resolve) => { const t = setInterval(() => { if (!Q.get(id).running) { clearInterval(t); resolve(Q.get(id)); } }, 10); });
  return { Q, root, h, calls, done, sent };
}
const arg = (call, flag) => call.args[call.args.indexOf(flag) + 1];

test("a chat is named by its first message, cut at a word", () => {
  assert.strictEqual(titleOf("  Why is  the sky blue? "), "Why is the sky blue?");
  const long = titleOf("What makes up good taste in design, and how do you train it over a long time?");
  assert.ok(long.length <= 61 && long.endsWith("…") && !long.includes("  "), long);
});

test("Claude Code: the first message makes the chat, the second resumes it", async () => {
  const { Q, calls, done, sent } = setup();
  assert.deepStrictEqual(Q.ask(null, "   "), { error: "empty" });
  const { id } = Q.ask(null, "Why is the sky blue?");
  assert.deepStrictEqual(Q.ask(id, "again"), { error: "busy", id });
  let c = await done(id);
  assert.deepStrictEqual(c.messages.map((m) => [m.role, m.text]), [["you", "Why is the sky blue?"], ["tutor", "Hello there."]]);
  assert.strictEqual(c.started, true);
  assert.ok(sent.some(([ch, p]) => ch === "q:delta" && p.text.startsWith("Hello")), "the reply streams");
  Q.ask(id, "And at sunset?"); c = await done(id);
  const [first, second] = calls();
  assert.strictEqual(arg(first, "--session-id"), id);
  assert.strictEqual(arg(second, "--resume"), id);
  assert.ok(first.args.includes("--safe-mode") && arg(first, "--tools") === "" && arg(first, "--system-prompt-snapshot") === "off");
  assert.strictEqual(arg(first, "--append-system-prompt"), "BE BRIEF");
  assert.strictEqual(JSON.parse(second.stdin).message.content.at(-1).text, "And at sunset?");
});

test("Codex: exec in a read-only empty folder, then resume by its thread id with the instructions again", async () => {
  const { Q, calls, done, root } = setup("codex");
  const { id } = Q.ask(null, "Hi");
  let c = await done(id);
  assert.strictEqual(c.codexId, "11111111-aaaa-4bbb-8ccc-222222222222");
  assert.strictEqual(c.started, false, "no Claude Code conversation exists");
  assert.strictEqual(c.messages.at(-1).text, "Codex here.");
  Q.ask(id, "Again"); c = await done(id);
  const [first, second] = calls();
  assert.deepStrictEqual(first.args.slice(0, 1), ["exec"]);
  assert.strictEqual(arg(first, "-s"), "read-only");
  assert.strictEqual(arg(first, "-C"), path.join(root, "run"));
  assert.strictEqual(arg(first, "-c"), 'developer_instructions="BE BRIEF"');
  assert.ok(first.args.includes("--ignore-user-config"));
  assert.deepStrictEqual(second.args.slice(0, 3), ["exec", "resume", c.codexId]);
  assert.match(second.stdin, /^<app_instructions>\nBE BRIEF\n<\/app_instructions>\n\nAgain$/);
  assert.strictEqual(c.messages.at(-1).text, "Codex again.");
});

test("switching tools hands the chat so far to the one that hasn't seen it", async () => {
  const { Q, h, calls, done } = setup("claude");
  const { id } = Q.ask(null, "My number is 47");
  await done(id);
  h.host = "codex";
  Q.ask(id, "What is my number?"); await done(id);
  h.host = "claude";
  Q.ask(id, "Back again"); await done(id);
  const [, codexTurn, claudeTurn] = calls();
  assert.match(codexTurn.stdin, /<earlier_in_this_chat>\nLearner: My number is 47\n\nTutor: Hello there\.\n<\/earlier_in_this_chat>\n\nWhat is my number\?/);
  assert.strictEqual(arg(claudeTurn, "--resume"), id, "Claude Code still has its own conversation");
  assert.doesNotMatch(JSON.parse(claudeTurn.stdin).message.content.at(-1).text, /earlier_in_this_chat/);
});

test("a screenshot travels as an image to Claude Code and as a file to Codex", async () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const a = setup("claude"), b = setup("codex");
  const one = a.Q.ask(null, "", [{ type: "image/png", bytes: png }]);
  let c = await a.done(one.id);
  assert.strictEqual(c.title, "A screenshot");
  const content = JSON.parse(a.calls()[0].stdin).message.content;
  assert.deepStrictEqual([content[0].type, content[0].source.media_type, content[0].source.data], ["image", "image/png", png.toString("base64")]);
  const two = b.Q.ask(null, "What is this?", [{ type: "image/png", bytes: png }]);
  c = await b.done(two.id);
  const file = arg(b.calls()[0], "-i");
  assert.ok(fs.existsSync(file) && fs.readFileSync(file).equals(png));
  assert.strictEqual(b.Q.imagePath(two.id, path.basename(file)), file);
  assert.strictEqual(b.Q.imagePath(two.id, "../chats/x.json"), null, "only its own screenshots are served");
  assert.deepStrictEqual(a.Q.ask(null, "", [{ type: "text/html", bytes: png }]), { error: "empty" }, "only images count");
});

test("Stop keeps what was written; a failed turn says why", async () => {
  for (const host of ["claude", "codex"]) {
    const { Q, done } = setup(host);
    const { id } = Q.ask(null, "SLOW please");
    await new Promise((r) => setTimeout(r, 300));
    Q.stop(id);
    let c = await done(id);
    assert.strictEqual(c.messages.at(-1).stopped, true, host);
    assert.ok(c.messages.at(-1).text.length > 0, host);
    Q.ask(id, "FAIL now"); c = await done(id);
    assert.match(c.messages.at(-1).error, host === "codex" ? /usage limit/ : /Credit balance/, host);
  }
});

test("archive, a lesson, a move, and Not now", async () => {
  const { Q, root, done } = setup();
  const { id } = Q.ask(null, "Polar integrals?");
  await done(id);
  Q.archive(id, true);
  assert.deepStrictEqual([Q.list().length, Q.list(true).length, Q.list(true)[0].archived], [0, 1, true]);
  Q.ask(id, "one more"); await done(id);
  assert.strictEqual(Q.list().length, 1, "writing to an archived chat brings it back");
  const { file } = Q.mark(id, { lesson: "MATH 241 polar integrals" });
  assert.strictEqual(file, path.join(root, "handoff", `${id}.md`));
  assert.match(fs.readFileSync(file, "utf8"), /\*\*Learner:\*\* Polar integrals\?\n\n\*\*Tutor:\*\* Hello there\./);
  assert.deepStrictEqual([Q.list().length, Q.list(true)[0].lesson], [0, "MATH 241 polar integrals"]);
  Q.ask(id, "still here?"); await done(id);
  assert.strictEqual(Q.list().length, 0, "a chat that became a lesson stays archived");
  const other = Q.ask(null, "Recursion?"); await done(other.id);
  Q.mark(other.id, { moved: "../etc" });
  assert.strictEqual(Q.get(other.id).moved, undefined, "a move names a subject's slug, nothing else");
  Q.mark(other.id, { moved: "cs124-recursion" });
  assert.deepStrictEqual([Q.get(other.id).moved, Q.get(other.id).archived], ["cs124-recursion", true]);
  Q.mark(other.id, { offer: "no" });
  assert.strictEqual(Q.get(other.id).offer, "no");
  assert.strictEqual(Q.get("not-an-id"), null);
});

test("readLine ignores what it doesn't know", () => {
  const t = { text: "", started: false, result: null };
  assert.strictEqual(readLine(t, "not json"), false);
  assert.strictEqual(readLine(t, JSON.stringify({ type: "rate_limit_event" })), false);
  assert.strictEqual(readLine(t, JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hm" } } })), false);
  assert.strictEqual(t.text, "", "thinking never reaches the reply");
});
