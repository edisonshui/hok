// The close-out flow (0a26006): arm, run, queue behind a running close-out,
// and the guards that keep a done or unknown subject out of it.
const test = require("node:test");
const assert = require("node:assert");
const { createCloseout } = require("../lib/session");

const drain = () => new Promise((r) => setImmediate(r));
function fakeClock() {
  let t = 0;
  const timers = new Set();
  return {
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

function make() {
  const c = fakeClock();
  const h = { clock: c, events: [], runs: [], resolvers: [] };
  h.subjects = { cs124: { slug: "cs124", status: "active" }, phys: { slug: "phys", status: "paused" }, old: { slug: "old", status: "done" } };
  h.co = createCloseout({
    setTimeout: c.setTimeout, clearTimeout: c.clearTimeout,
    subject: (slug) => h.subjects[slug] || null,
    closeOut: (slug) => { h.runs.push(slug); return new Promise((r) => h.resolvers.push(r)); },
    onEvent: (kind, payload) => h.events.push([kind, payload]),
  });
  h.st = h.co.state;
  return h;
}

test("the first click arms; the arm falls off after 4 seconds", async () => {
  const h = make();
  h.co.request("cs124");
  assert.equal(h.st.armed, "cs124");
  assert.deepEqual(h.runs, []);
  await h.clock.tick(4100);
  assert.equal(h.st.armed, null);
  h.co.request("cs124"); // the window passed, so this click arms again
  assert.equal(h.st.armed, "cs124");
  assert.deepEqual(h.runs, []);
});

test("a second click inside the window runs the close-out", async () => {
  const h = make();
  h.co.request("cs124");
  h.co.request("cs124");
  await drain();
  assert.deepEqual(h.runs, ["cs124"]);
  assert.equal(h.st.closing, "cs124");
  assert.equal(h.co.pending("cs124"), true);
  h.resolvers[0]({ ok: true, text: "done" });
  await drain();
  assert.equal(h.st.closing, null);
  assert.deepEqual(h.events.find(([k]) => k === "finished"), ["finished", { slug: "cs124", result: { ok: true, text: "done" } }]);
});

test("close-outs run one at a time; a second waits its turn", async () => {
  const h = make();
  h.co.request("cs124"); h.co.request("cs124");
  await drain();
  h.co.request("phys"); h.co.request("phys");
  await drain();
  assert.deepEqual(h.runs, ["cs124"]);
  assert.deepEqual(h.st.queue, ["phys"]);
  assert.ok(h.events.some(([k]) => k === "queued-behind"));
  h.resolvers[0]({ ok: true, text: "" });
  await drain();
  assert.deepEqual(h.runs, ["cs124", "phys"]);
  h.resolvers[1]({ ok: false, text: "no claude" });
  await drain();
  assert.equal(h.st.closing, null);
  assert.deepEqual(h.st.queue, []);
});

test("a done or unknown subject, or one already pending, is not closed again", async () => {
  const h = make();
  h.co.request("old");
  h.co.request("old");
  h.co.request("ghost");
  h.co.request("ghost");
  await drain();
  assert.deepEqual(h.runs, []);
  h.co.request("cs124"); h.co.request("cs124");
  await drain();
  h.co.request("cs124"); h.co.request("cs124"); // already closing
  await drain();
  assert.deepEqual(h.runs, ["cs124"]);
});

test("canClose: live subjects yes, done ones only while their close-out is pending", async () => {
  const h = make();
  assert.equal(h.co.canClose(h.subjects.cs124), true);
  assert.equal(h.co.canClose(h.subjects.old), false);
  assert.equal(h.co.canClose(null), false);
  h.co.request("cs124"); h.co.request("cs124");
  await drain();
  h.subjects.cs124.status = "done"; // the record moved while the run finishes
  assert.equal(h.co.canClose(h.subjects.cs124), true);
});
