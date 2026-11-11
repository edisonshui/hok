// Records a motion in the real app, one exact frame at a time, into a video.
//
//   node scripts/record.mjs <out-dir> [frames]
//
// Playwright opens the app in Electron. The motion clock goes manual, and each
// frame steps it 1/60 s, waits for the paint, and saves a screenshot. ffmpeg
// joins the frames into <out-dir>/video.mp4 at 60 fps. Because the clock never
// follows real time here, two recordings of the same scene match frame for frame.
import { _electron as electron } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] || "recording");
const frames = Number(process.argv[3] || 90);
const FPS = 60;

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;   // set by some agent tools; it stops Electron opening a window

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "frames"), { recursive: true });

// Its own profile folder: a Flash already open would otherwise hold the
// single-instance lock and close this copy. The real config is copied in so
// the same vault shows.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "flash-record-"));
const realConfig = path.join(os.homedir(), "Library", "Application Support", "Flash", "config.json");
if (fs.existsSync(realConfig)) fs.copyFileSync(realConfig, path.join(profile, "config.json"));
const app = await electron.launch({ args: [appDir, `--user-data-dir=${profile}`], env });
const page = await app.firstWindow();
await page.waitForLoadState("load");
await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
await page.waitForTimeout(1500);   // let the first screen paint before the clock stops

// The proof scene: a card arrives on a spring, is sent somewhere else halfway
// (it keeps its speed, no jump), and the real panel behind it eases back.
await page.evaluate(() => {
  const { clock, spring } = window.motion;
  clock.manual();
  const card = document.createElement("div");
  card.textContent = "Check · polar area";
  Object.assign(card.style, {
    position: "fixed", left: "50%", top: "50%", width: "320px", padding: "20px 24px",
    margin: "-40px 0 0 -160px", borderRadius: "14px", background: "#FBFCFD",
    boxShadow: "0 12px 40px rgba(0,0,0,.18)", font: "600 15px Figtree, system-ui",
    color: "#1F2328", zIndex: 9999, opacity: 0,
  });
  document.body.appendChild(card);
  const panel = document.querySelector("main") || document.body;
  let y = 120, s = 0.94, o = 0;
  const paint = () => {
    card.style.transform = `translateY(${y}px) scale(${s})`;
    card.style.opacity = String(o);
    panel.style.filter = `blur(${(o * 3).toFixed(2)}px)`;
  };
  window.__ySpring = spring(120, { to: 0, feel: "settle", onUpdate: (v) => { y = v; paint(); } });
  spring(0.94, { to: 1, feel: "settle", onUpdate: (v) => { s = v; paint(); } });
  spring(0, { to: 1, feel: "snappy", onUpdate: (v) => { o = v; paint(); } });
});

const nextPaint = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
for (let i = 0; i < frames; i++) {
  if (i === 24) await page.evaluate(() => window.__ySpring.to(-90));   // interrupt mid-flight
  await page.evaluate((ms) => window.motion.clock.step(ms), 1000 / FPS);
  await nextPaint();
  await page.screenshot({ path: path.join(outDir, "frames", `f${String(i).padStart(4, "0")}.png`) });
}
await app.close();

execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS),
  "-i", path.join(outDir, "frames", "f%04d.png"),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
  path.join(outDir, "video.mp4")]);
console.log(`${frames} frames -> ${path.join(outDir, "video.mp4")}`);
