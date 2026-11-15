// Updates from GitHub releases (15 Nov, Edison: "users who already have the app can just update it directly instead
// of having to reinstall", with "discrete like T3 code": a small icon at the sidebar's foot, shown only when there is
// one). electron-updater's Mac path (Squirrel.Mac) needs an app signed with an Apple developer ID, and Hok is signed
// ad hoc, so on a Mac Hok swaps the bundle itself: download the release's .zip, unpack it with ditto, check its version,
// then after Hok quits a small script moves the new Hok.app into place and opens it. Anywhere it can't do that (Windows,
// Linux, a Hok run from the disk image or from a translocated copy, a release with no Mac .zip) the icon opens the
// release page instead.
const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const LATEST = "https://api.github.com/repos/edisonshui/hok/releases/latest";

// "hok-v0.2.0", "flash-v0.1.0" and "v0.2.0" all name 0.2.0.
const versionOf = (tag) => { const m = String(tag || "").match(/(\d+)\.(\d+)\.(\d+)/); return m ? m.slice(1).map(Number) : null; };
function newer(a, b) {
  const x = versionOf(a), y = versionOf(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
// The Mac .zip: one for both chips first, then this Mac's chip.
function macZip(assets, arch) {
  const zips = (assets || []).filter((a) => /\.zip$/i.test(a.name) && /mac|darwin/i.test(a.name));
  return zips.find((a) => /universal/i.test(a.name)) || zips.find((a) => a.name.includes(arch)) || null;
}
// The running Hok.app, when it can be replaced in place.
function bundle(execPath, platform) {
  if (platform !== "darwin") return null;
  const app = path.resolve(execPath, "../../..");
  if (!/\.app$/.test(app) || app.startsWith("/Volumes/") || app.includes("/AppTranslocation/")) return null;
  try { fs.accessSync(path.dirname(app), fs.constants.W_OK); } catch { return null; }
  return app;
}
const run = (cmd, args) => new Promise((done, fail) => execFile(cmd, args, (e, out, err) => (e ? fail(new Error(String(err || e.message).trim())) : done(String(out).trim()))));

function make({ net, version, execPath, platform, arch, dir, url = LATEST, onChange }) {
  let found = null;    // { version, page, zip } once a newer release is seen
  let state = "none";  // none | ready | downloading | installing | failed
  let swap = null;     // { from, to } once the new bundle is unpacked, run at quit
  const app = bundle(execPath, platform);
  const tell = (extra = {}) => onChange({ state, version: found && found.version, inPlace: !!(app && found && found.zip), ...extra });

  async function check() {
    if (state === "downloading" || state === "installing") return;
    try {
      const res = await net.fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Hok-updater" } });
      if (!res.ok) return;
      const rel = await res.json();
      if (rel.draft || rel.prerelease || !newer(rel.tag_name, version)) return;
      const zip = macZip(rel.assets, arch);
      found = { version: versionOf(rel.tag_name).join("."), page: rel.html_url, zip: zip && zip.browser_download_url };
      if (state === "none") state = "ready";
      tell();
    } catch { /* offline: try again later */ }
  }

  // Download and unpack. True when the new Hok is ready to swap in at quit; "page" when the release page was opened.
  async function install(openPage) {
    if (!found) return false;
    if (swap) return true;   // unpacked already; a quit was called off, so it waits for the next one
    if (!app || !found.zip) { openPage(found.page); return "page"; }
    state = "downloading"; tell({ got: 0 });
    try {
      const work = path.join(dir, `update-${found.version}`);
      fs.rmSync(work, { recursive: true, force: true });
      fs.mkdirSync(work, { recursive: true });
      const zip = path.join(work, "Hok.zip"), res = await net.fetch(found.zip, { headers: { "User-Agent": "Hok-updater" } });
      if (!res.ok) throw new Error(`the download answered ${res.status}`);
      const total = Number(res.headers.get("content-length")) || 0;
      let got = 0, last = 0;
      const body = Readable.fromWeb(res.body);
      body.on("data", (c) => { got += c.length; if (Date.now() - last > 250) { last = Date.now(); tell({ got, total }); } });
      await pipeline(body, fs.createWriteStream(zip));
      const out = path.join(work, "app");
      await run("/usr/bin/ditto", ["-x", "-k", zip, out]);
      const name = fs.readdirSync(out).find((f) => f.endsWith(".app"));
      if (!name) throw new Error("the download had no app in it");
      const fresh = path.join(out, name);
      const v = await run("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", path.join(fresh, "Contents", "Info.plist")]);
      if (v !== found.version) throw new Error(`the download is version ${v}, not ${found.version}`);
      fs.rmSync(zip, { force: true });
      swap = { from: fresh, to: app };
      state = "installing"; tell();
      return true;
    } catch (e) {
      state = "failed"; tell({ error: e.message });
      state = "ready";
      return false;
    }
  }

  // At quit: wait for this process to end, move the new bundle in, keep the old one if the move fails, open Hok.
  function swapAtQuit() {
    if (!swap) return false;
    const script = path.join(dir, "swap.sh");
    fs.writeFileSync(script, `#!/bin/bash
pid="$1"; old="$2"; new="$3"; bak="$old.before-update"
for i in $(seq 1 600); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
kill -0 "$pid" 2>/dev/null && exit 1
rm -rf "$bak"
if mv "$old" "$bak" && mv "$new" "$old"; then
  rm -rf "$bak"
  xattr -dr com.apple.quarantine "$old" 2>/dev/null
else
  [ -e "$old" ] || mv "$bak" "$old"
fi
open "$old"
`, { mode: 0o755 });
    spawn("/bin/bash", [script, String(process.pid), swap.to, swap.from], { detached: true, stdio: "ignore" }).unref();
    swap = null;
    return true;
  }

  return { check, install, swapAtQuit, status: () => ({ state, version: found && found.version, inPlace: !!(app && found && found.zip) }) };
}

module.exports = { make, newer, versionOf, macZip, bundle };
