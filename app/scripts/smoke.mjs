// A friend's first run, on whatever system this runs on: empty settings, the setup screen, Make a new vault, Home,
// Settings. Saves a still of each step and fails if the page throws, the vault is not made, or Home does not draw.
// It needs a starter vault (scripts/make-starter-vault.js). No tutor is started.
//
//   node scripts/smoke.mjs [outdir]        on Linux without a screen: xvfb-run -a node scripts/smoke.mjs
//
// SMOKE_PRE names one more script to load into the main process first (used on the Mac to keep the window unseen).
import { _electron as electron } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
const app_dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] || "smoke-out"); fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ol-smoke-")), profile = path.join(tmp, "profile"), parent = path.join(tmp, "docs");
fs.mkdirSync(profile); fs.mkdirSync(parent); fs.writeFileSync(path.join(profile, "config.json"), JSON.stringify({ vault: null, theme: process.env.SMOKE_THEME || "light" }));
// The stand-in tutor (smoke-main.cjs): answers "auth status" as signed in, and nothing else.
const bin = path.join(tmp, "bin"); fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, "claude"), "#!/bin/sh\ncase \"$1\" in auth) echo '{\"loggedIn\":true}';; *) echo '0.0.0 (smoke stand-in)';; esac\n", { mode: 0o755 });
fs.writeFileSync(path.join(bin, "claude.cmd"), "@echo off\r\nif \"%1\"==\"auth\" (echo {\"loggedIn\":true}) else (echo 0.0.0)\r\n");
const env = { ...process.env, SMOKE_PARENT: parent, SMOKE_BIN: process.env.SMOKE_REAL_TUTOR ? "" : bin }; delete env.ELECTRON_RUN_AS_NODE;
const pre = [process.env.SMOKE_PRE, path.join(app_dir, "scripts", "smoke-main.cjs")].filter(Boolean).flatMap((f) => ["-r", f]);
const app = await electron.launch({ args: [...pre, app_dir, `--user-data-dir=${profile}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])], env });
const fail = []; const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fail.push(what); };
try {
  const page = await app.firstWindow(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const text = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  const press = (sel) => page.evaluate((sel) => { const b = document.querySelector(sel); if (!b) throw new Error("no " + sel); b.click(); }, sel);   // a click the page makes itself, so it works in an unseen window too
  const shot = (n) => page.screenshot({ path: path.join(out, `${process.platform}-${n}.png`) });
  await page.waitForSelector(".setup", { timeout: 30000 }); await page.waitForTimeout(1500); await shot("1-setup");
  const setup = await text(); console.log("setup says:", setup.slice(0, 500));
  check(/Make a new vault/.test(setup), "setup offers Make a new vault");
  check(!/Python 3 is not installed/.test(setup), "Python 3 found and runs");
  check(/Documents/.test(setup), "setup offers Documents for the new vault");
  await press('[data-act="vault-where"][data-arg="other"]'); await page.waitForTimeout(800);   // the stubbed folder dialog answers with the test's folder, never the real Documents
  await press('[data-act="make-vault"]');
  await page.waitForSelector(".sidebar [data-arg=\"home\"]", { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(3000); await shot("2-home");
  const home = await text(); console.log("home says:", home.slice(0, 300));
  const vault = path.join(parent, "Learning vault");
  check(fs.existsSync(path.join(vault, ".claude", "hooks", "learn-status.py")), "the new vault was made");
  check(/What do you want to learn/.test(home), "Home drew from the new vault's records (learn-status.py ran)");
  check(await page.evaluate(() => document.documentElement.classList.contains("glass") && !!document.querySelector("#wall canvas, #wall video")), "the glass and its wallpaper are drawn");
  await press('[data-act="settings"]'); await page.waitForTimeout(1200); await shot("3-settings");
  await page.keyboard.press("Escape"); await press('.sidebar [data-arg="system"]'); await page.waitForTimeout(1500); await shot("4-skills");
  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
} catch (e) { check(false, "the run finished: " + e.message.split("\n")[0]); }
await app.close().catch(() => {});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail.length ? `${fail.length} failed` : "all passed", "· stills in", out);
process.exit(fail.length ? 1 : 0);
