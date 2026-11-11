// A stand-in for `claude -p` and `codex exec` in the Questions tests: it answers in the tool's own JSON events and
// records each call (its arguments and what came in on stdin) to FAKE_LOG, so a test can check what the app sent.
// A message containing SLOW waits until it is killed; one containing FAIL ends in an error.
const fs = require("fs");
const args = process.argv.slice(2);
let stdin = "";
process.stdin.on("data", (d) => { stdin += d; });
process.stdin.on("end", () => {
  fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, stdin }) + "\n");
  const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  if (args[0] === "exec") {
    const resumed = args[1] === "resume";
    out({ type: "thread.started", thread_id: resumed ? args[2] : "11111111-aaaa-4bbb-8ccc-222222222222" });
    out({ type: "turn.started" });
    if (/FAIL/.test(stdin)) { out({ type: "turn.failed", error: { message: "usage limit reached" } }); return; }
    if (/SLOW/.test(stdin)) { out({ type: "item.completed", item: { id: "i0", type: "agent_message", text: "Partly there" } }); return setInterval(() => {}, 1000); }
    out({ type: "item.completed", item: { id: "i0", type: "agent_message", text: resumed ? "Codex again." : "Codex here." } });
    out({ type: "turn.completed", usage: {} });
    return;
  }
  out({ type: "system", subtype: "init", session_id: "x" });
  if (/FAIL/.test(stdin)) { out({ type: "result", subtype: "error_during_execution", is_error: true, result: "Credit balance is too low" }); return; }
  const say = (t) => out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: t } } });
  out({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "text" } } });
  say("Hello ");
  setTimeout(() => {   // a real reply streams over time, so the app's 40 ms batching has a chunk to send
    say("there.");
    if (/SLOW/.test(stdin)) return setInterval(() => {}, 1000);
    out({ type: "result", subtype: "success", is_error: false, result: "Hello there." });
  }, 80);
});
