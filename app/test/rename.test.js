const test = require("node:test"), assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { moveOldData } = require("../lib/rename");
const setup = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "hok-rename-")); const old = path.join(d, "Obsidian Learning"); fs.mkdirSync(path.join(old, "wallpapers"), { recursive: true }); fs.writeFileSync(path.join(old, "config.json"), '{"vault":"/v"}'); fs.writeFileSync(path.join(old, "wallpapers", "a.mp4"), "x"); return { d, old, now: path.join(d, "Hok") }; };

test("the first launch as Hok moves the old folder over", () => {
  const { d, old, now } = setup();
  assert.equal(moveOldData(d, now), "moved");
  assert.equal(fs.readFileSync(path.join(now, "config.json"), "utf8"), '{"vault":"/v"}');
  assert.ok(fs.existsSync(path.join(now, "wallpapers", "a.mp4")));
  assert.ok(!fs.existsSync(old));
});
test("an open old app is copied from, not moved, and its lock is left behind", () => {
  const { d, old, now } = setup();
  fs.symlinkSync("host-123", path.join(old, "SingletonLock"));   // dangling, as Chromium leaves it
  assert.equal(moveOldData(d, now), "copied");
  assert.ok(fs.existsSync(path.join(now, "config.json")) && fs.existsSync(path.join(old, "config.json")));
  assert.throws(() => fs.lstatSync(path.join(now, "SingletonLock")));
});
test("Hok's own settings are never overwritten", () => {
  const { d, now } = setup();
  fs.mkdirSync(now); fs.writeFileSync(path.join(now, "config.json"), '{"vault":"/mine"}');
  assert.equal(moveOldData(d, now), "already has settings");
  assert.equal(fs.readFileSync(path.join(now, "config.json"), "utf8"), '{"vault":"/mine"}');
});
test("a test profile elsewhere never takes the real folder", () => {
  const { d, old } = setup();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "hok-profile-"));
  assert.equal(moveOldData(d, other), "custom profile");
  assert.ok(fs.existsSync(path.join(old, "config.json")));
});
